import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLogger';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  recordPaymentSchema,
} from './invoices.schema';
import * as invoiceService from './invoices.service';
import { renderInvoicePdf, renderInvoiceHtml } from '../../pdf/pdfRenderer';
import { buildInvoiceHtml } from '../../pdf/invoiceTemplate';
import prisma from '../../lib/prisma';
import { logger } from '../../config/logger';

const router = Router();
router.use(authenticate, requireRole(['ADMIN', 'MANAGER']));
router.use(auditLog);

// ─── List & filter ────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { clientName, invoiceNo, status, from, to, page = '1', limit = '25' } = req.query as Record<string, string>;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where: any = {};
  if (status) where.status = status;
  if (invoiceNo) where.invoiceNo = { contains: invoiceNo };
  if (from || to) {
    where.invoiceDate = {};
    if (from) where.invoiceDate.gte = new Date(from);
    if (to) where.invoiceDate.lte = new Date(to);
  }
  if (clientName) where.client = { clientName: { contains: clientName } };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, clientName: true, clientCode: true } },
        items: true,
        createdBy: { select: { id: true, name: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  res.json({ success: true, data: invoices, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

// ─── Create invoice ───────────────────────────────────────────
router.post('/', validate(createInvoiceSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const invoice = await invoiceService.createInvoice(req.body, req.user!.id);
    res.locals.createdId = invoice.id;
    res.status(201).json({ success: true, data: invoice });
  } catch (err: any) {
    logger.error('Create invoice error', err);
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

// ─── Get invoice detail ───────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      items: true,
      ledger: { orderBy: { createdAt: 'asc' } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
    },
  });

  if (!invoice) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } });
    return;
  }
  res.json({ success: true, data: invoice });
});

// ─── Update invoice ───────────────────────────────────────────
router.patch('/:id', validate(updateInvoiceSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const invoice = await invoiceService.updateInvoice(parseInt(req.params.id), req.body, req.user!.id);
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'VOID_INVOICE' ? 422 : 500;
    res.status(status).json({ success: false, error: { code: err.code ?? 'SERVER_ERROR', message: err.message } });
  }
});

// ─── Issue (DRAFT → ISSUED) ───────────────────────────────────
router.post('/:id/issue', async (req: Request, res: Response): Promise<void> => {
  try {
    const invoice = await invoiceService.transitionStatus(parseInt(req.params.id), 'ISSUED', req.user!.id);
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    const status = err.code === 'NOT_FOUND' ? 404 : 422;
    res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
  }
});

// ─── Void invoice ─────────────────────────────────────────────
router.post('/:id/void', async (req: Request, res: Response): Promise<void> => {
  try {
    const invoice = await invoiceService.transitionStatus(parseInt(req.params.id), 'VOID', req.user!.id);
    res.json({ success: true, data: invoice });
  } catch (err: any) {
    const status = err.code === 'NOT_FOUND' ? 404 : 422;
    res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
  }
});

// ─── Hard delete (Admin only) ─────────────────────────────────
router.delete('/:id', requireRole(['ADMIN']), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { items: true, ledger: true } });

  if (!invoice) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } });
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Write audit log BEFORE deleting
    await tx.auditLog.create({
      data: {
        userId:      req.user!.id,
        action:      'DELETE',
        entityType:  'invoice',
        entityId:    String(id),
        beforeValue: invoice as any,
      },
    });

    await tx.ledger.deleteMany({ where: { invoiceId: id } });
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.delete({ where: { id } });
  });

  res.status(204).send();
});

// ─── Record payment ───────────────────────────────────────────
router.post('/:id/payments', validate(recordPaymentSchema), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await invoiceService.recordPayment(parseInt(req.params.id), req.body);
    res.json({ success: true, data: result });
  } catch (err: any) {
    const statusMap: Record<string, number> = { NOT_FOUND: 404, VOID_INVOICE: 422, ALREADY_PAID: 422, AMOUNT_EXCEEDS_BALANCE: 422 };
    const status = statusMap[err.code] ?? 500;
    res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
  }
});

// ─── PDF download ─────────────────────────────────────────────
router.get('/:id/pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true, items: true, createdBy: { select: { name: true } } },
    });
    if (!invoice) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } }); return; }

    const settings = await prisma.companySettings.findUnique({ where: { id: 1 } });
    const html = buildInvoiceHtml(invoice as any, settings as any);
    const buffer = await renderInvoicePdf(html);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNo}.pdf"`);
    res.send(buffer);
  } catch (err) {
    logger.error('PDF generation error', err);
    res.status(500).json({ success: false, error: { code: 'PDF_ERROR', message: 'Failed to generate PDF.' } });
  }
});

// ─── HTML preview ─────────────────────────────────────────────
router.get('/:id/preview', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true, items: true, createdBy: { select: { name: true } } },
    });
    if (!invoice) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } }); return; }

    const settings = await prisma.companySettings.findUnique({ where: { id: 1 } });
    const html = buildInvoiceHtml(invoice as any, settings as any);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    logger.error('Preview error', err);
    res.status(500).json({ success: false, error: { code: 'PREVIEW_ERROR', message: 'Failed to generate preview.' } });
  }
});

export default router;
