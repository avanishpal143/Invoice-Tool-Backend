import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../../lib/prisma';
import { allocateInvoiceNumber } from '../../lib/invoiceCounter';
import type { CreateInvoiceInput, UpdateInvoiceInput, RecordPaymentInput } from './invoices.schema';

// ─── Helpers ──────────────────────────────────────────────────

function toNum(d: Decimal | number | string): number {
  return typeof d === 'object' ? parseFloat(d.toString()) : Number(d);
}

async function getDefaultGstPercent(): Promise<number> {
  const settings = await prisma.companySettings.findUnique({ where: { id: 1 } });
  return toNum(settings?.gstPercent ?? 18);
}

// ─── Create invoice ───────────────────────────────────────────

export async function createInvoice(input: CreateInvoiceInput, createdById: number) {
  const gstPercent = input.taxOverride !== undefined ? input.taxOverride : await getDefaultGstPercent();
  const year = new Date(input.invoiceDate).getFullYear();

  return prisma.$transaction(async (tx) => {
    const invoiceNo = await allocateInvoiceNumber(year);

    // Compute line amounts
    const items = input.items.map((item) => ({
      ...item,
      amount: item.qty * item.rate,
    }));
    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const discount = input.discount ?? 0;
    const taxBase = subtotal - discount;
    const tax = gstPercent > 0 ? Math.round((taxBase * gstPercent) / 100 * 100) / 100 : 0;
    const total = taxBase + tax;

    const invoice = await tx.invoice.create({
      data: {
        invoiceNo,
        clientId:    input.clientId,
        invoiceDate: new Date(input.invoiceDate),
        dueDate:     new Date(input.dueDate),
        status:      'DRAFT',
        subtotal,
        discount,
        tax,
        total,
        notes:       input.notes,
        createdById,
        items: {
          create: items,
        },
      },
      include: { items: true, client: true },
    });

    // Create initial ledger row
    const invoiceDate = new Date(input.invoiceDate);
    await tx.ledger.create({
      data: {
        clientId:     input.clientId,
        invoiceId:    invoice.id,
        service:      invoice.client.activeServices ?? undefined,
        month:        invoiceDate.getMonth() + 1,
        year:         invoiceDate.getFullYear(),
        amount:       total,
        paymentStatus:'PENDING',
        balanceDue:   total,
      },
    });

    return invoice;
  });
}

// ─── Update invoice ───────────────────────────────────────────

export async function updateInvoice(id: number, input: UpdateInvoiceInput, updatedById: number) {
  const existing = await prisma.invoice.findUnique({ where: { id }, include: { items: true } });
  if (!existing) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  if (existing.status === 'VOID') throw Object.assign(new Error('VOID_INVOICE'), { code: 'VOID_INVOICE' });

  const gstPercent = input.taxOverride !== undefined ? input.taxOverride : await getDefaultGstPercent();

  return prisma.$transaction(async (tx) => {
    const items = input.items?.map((item) => ({ ...item, amount: item.qty * item.rate }));
    const subtotal = items ? items.reduce((s, i) => s + i.amount, 0) : toNum(existing.subtotal);
    const discount = input.discount !== undefined ? input.discount : toNum(existing.discount);
    const taxBase = subtotal - discount;
    const tax = gstPercent > 0 ? Math.round((taxBase * gstPercent) / 100 * 100) / 100 : toNum(existing.tax);
    const total = taxBase + tax;

    if (items) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    }

    const invoice = await tx.invoice.update({
      where: { id },
      data: {
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : undefined,
        dueDate:     input.dueDate ? new Date(input.dueDate) : undefined,
        discount,
        tax,
        subtotal,
        total,
        notes:       input.notes,
        updatedById,
        items:       items ? { create: items } : undefined,
      },
      include: { items: true, client: true },
    });

    // Sync ledger balance
    await tx.ledger.updateMany({
      where: { invoiceId: id, paymentStatus: 'PENDING' },
      data:  { amount: total, balanceDue: total },
    });

    return invoice;
  });
}

// ─── Status transitions ───────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT:    ['ISSUED', 'VOID'],
  ISSUED:   ['PAID', 'PARTIAL', 'OVERDUE', 'VOID'],
  PARTIAL:  ['PAID', 'OVERDUE', 'VOID'],
  OVERDUE:  ['PAID', 'PARTIAL', 'VOID'],
  PAID:     [],
  VOID:     [],
};

export async function transitionStatus(id: number, newStatus: string, updatedById: number) {
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });

  const allowed = VALID_TRANSITIONS[invoice.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw Object.assign(
      new Error(`Cannot transition from ${invoice.status} to ${newStatus}`),
      { code: 'INVALID_TRANSITION' }
    );
  }

  return prisma.invoice.update({
    where: { id },
    data:  { status: newStatus as any, updatedById },
    include: { items: true, client: true },
  });
}

// ─── Record payment ───────────────────────────────────────────

export async function recordPayment(invoiceId: number, input: RecordPaymentInput) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { ledger: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (!invoice) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (invoice.status === 'VOID') throw Object.assign(new Error('VOID_INVOICE'), { code: 'VOID_INVOICE' });
    if (invoice.status === 'PAID') throw Object.assign(new Error('ALREADY_PAID'), { code: 'ALREADY_PAID' });

    const lastLedger = invoice.ledger[0];
    const previousBalance = lastLedger ? toNum(lastLedger.balanceDue) : toNum(invoice.total);

    if (input.amount > previousBalance + 0.01) {
      throw Object.assign(
        new Error(`Payment amount (${input.amount}) exceeds balance due (${previousBalance})`),
        { code: 'AMOUNT_EXCEEDS_BALANCE' }
      );
    }

    const newBalance = Math.max(0, previousBalance - input.amount);
    const paymentStatus = newBalance <= 0.01 ? 'PAID' : 'PARTIAL';

    // Insert ledger payment row
    const ledgerRow = await tx.ledger.create({
      data: {
        clientId:     invoice.clientId,
        invoiceId,
        service:      lastLedger?.service ?? undefined,
        month:        new Date(input.date).getMonth() + 1,
        year:         new Date(input.date).getFullYear(),
        amount:       input.amount,
        paymentDate:  new Date(input.date),
        mode:         input.mode as any,
        paymentStatus: paymentStatus as any,
        balanceDue:   newBalance,
        notes:        input.notes,
      },
    });

    // Update invoice status
    const newInvoiceStatus = paymentStatus === 'PAID' ? 'PAID' : 'PARTIAL';
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: newInvoiceStatus as any },
    });

    // Update client totalPaid
    await tx.client.update({
      where: { id: invoice.clientId },
      data: { totalPaid: { increment: input.amount } },
    });

    return { ledgerRow, newStatus: newInvoiceStatus, balanceDue: newBalance };
  });
}
