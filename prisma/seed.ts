import { PrismaClient, Role, LeadSource, LeadStatus, InvoiceStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Company Settings ────────────────────────────────────────
  await prisma.companySettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      companyName: 'Devlofox Technologies LLP',
      addressLine1: 'B-12, Sector 63',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pincode: '201301',
      phone: '+91-9876543210',
      email: 'hello@devlofox.com',
      website: 'https://devlofox.com',
      invoicePrefix: 'INV',
      invoiceStartNumber: 127,
      defaultPaymentTermsDays: 30,
      gstPercent: 18,
    },
  });

  // ─── Users ───────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin@123', 12);
  const managerHash = await bcrypt.hash('Manager@123', 12);
  const salesHash = await bcrypt.hash('Sales@123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@devlofox.com' },
    update: {},
    create: { name: 'Root Admin', email: 'admin@devlofox.com', passwordHash: adminHash, role: Role.ADMIN },
  });

  const manager1 = await prisma.user.upsert({
    where: { email: 'manager1@devlofox.com' },
    update: {},
    create: { name: 'Priya Sharma', email: 'manager1@devlofox.com', passwordHash: managerHash, role: Role.MANAGER },
  });

  const manager2 = await prisma.user.upsert({
    where: { email: 'manager2@devlofox.com' },
    update: {},
    create: { name: 'Rahul Gupta', email: 'manager2@devlofox.com', passwordHash: managerHash, role: Role.MANAGER },
  });

  const sales1 = await prisma.user.upsert({
    where: { email: 'sales1@devlofox.com' },
    update: {},
    create: { name: 'Aman Verma', email: 'sales1@devlofox.com', passwordHash: salesHash, role: Role.SALES },
  });

  const sales2 = await prisma.user.upsert({
    where: { email: 'sales2@devlofox.com' },
    update: {},
    create: { name: 'Neha Singh', email: 'sales2@devlofox.com', passwordHash: salesHash, role: Role.SALES },
  });

  const sales3 = await prisma.user.upsert({
    where: { email: 'sales3@devlofox.com' },
    update: {},
    create: { name: 'Karan Mehta', email: 'sales3@devlofox.com', passwordHash: salesHash, role: Role.SALES },
  });

  // ─── Clients ─────────────────────────────────────────────────
  const clientsData = [
    { clientCode: 'DFX-001', clientName: 'Anil Kumar', businessName: 'AK Enterprises', phone: '9876500001', email: 'anil@akenterprises.in', city: 'Delhi', packageAmount: 12000 },
    { clientCode: 'DFX-002', clientName: 'Sunita Rao', businessName: 'SunBright Solutions', phone: '9876500002', email: 'sunita@sunbright.in', city: 'Gurgaon', packageAmount: 18000 },
    { clientCode: 'DFX-003', clientName: 'Mohit Jain', businessName: 'Jain & Co.', phone: '9876500003', email: 'mohit@jainco.in', city: 'Noida', packageAmount: 8500 },
    { clientCode: 'DFX-004', clientName: 'Pooja Dubey', businessName: 'Dubey Designers', phone: '9876500004', email: 'pooja@dubeydesign.in', city: 'Faridabad', packageAmount: 22000 },
    { clientCode: 'DFX-005', clientName: 'Rajesh Nair', businessName: 'Nair Tech Hub', phone: '9876500005', email: 'rajesh@nairtech.in', city: 'Delhi', packageAmount: 15000 },
  ];

  const clients = [];
  for (const c of clientsData) {
    const client = await prisma.client.upsert({
      where: { clientCode: c.clientCode },
      update: {},
      create: {
        ...c,
        leadSource: LeadSource.REFERRAL,
        activeServices: 'Web Design, SEO',
        startDate: new Date('2025-01-01'),
        nextDueDate: new Date('2026-08-01'),
        status: 'ACTIVE',
        packageAmount: c.packageAmount,
      },
    });
    clients.push(client);
  }

  // ─── Leads ───────────────────────────────────────────────────
  const leadStatuses: LeadStatus[] = [LeadStatus.NEW, LeadStatus.WARM, LeadStatus.HOLD, LeadStatus.REFUSED, LeadStatus.CONVERTED];
  const leadSources: LeadSource[] = [LeadSource.META_ADS, LeadSource.ORGANIC, LeadSource.REFERRAL, LeadSource.ADS];
  const salesUsers = [sales1, sales2, sales3];

  for (let i = 1; i <= 20; i++) {
    const existing = await prisma.lead.findFirst({ where: { contactNumber: `98765${String(i).padStart(5, '0')}` } });
    if (existing) continue;

    await prisma.lead.create({
      data: {
        source: leadSources[i % leadSources.length],
        date: new Date(Date.now() - i * 3 * 24 * 60 * 60 * 1000),
        name: `Lead Contact ${i}`,
        contactNumber: `98765${String(i).padStart(5, '0')}`,
        email: `lead${i}@example.com`,
        businessInfo: `Business ${i} — SME in Delhi NCR`,
        requiredService: i % 2 === 0 ? 'Web Design' : 'Digital Marketing',
        status: leadStatuses[i % leadStatuses.length],
        dealValue: (i * 5000),
        contactedById: salesUsers[i % salesUsers.length].id,
        nextCall: new Date(Date.now() + i * 24 * 60 * 60 * 1000),
        proposalSent: i % 3 === 0,
        remarks: `Initial notes for lead ${i}`,
      },
    });
  }

  // ─── Invoice counter ─────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  await prisma.invoiceCounter.upsert({
    where: { year: currentYear },
    update: {},
    create: { year: currentYear, lastSeq: 127 },
  });

  // ─── Invoices ─────────────────────────────────────────────────
  const invoiceStatuses: InvoiceStatus[] = [
    InvoiceStatus.DRAFT,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PAID,
    InvoiceStatus.PARTIAL,
    InvoiceStatus.OVERDUE,
    InvoiceStatus.VOID,
    InvoiceStatus.PAID,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIAL,
    InvoiceStatus.OVERDUE,
  ];

  for (let i = 0; i < 10; i++) {
    const client = clients[i % clients.length];
    const seq = String(128 + i).padStart(4, '0');
    const invoiceNo = `INV-${currentYear}-${seq}`;
    const existing = await prisma.invoice.findUnique({ where: { invoiceNo } });
    if (existing) continue;

    const subtotal = client.packageAmount ? Number(client.packageAmount) : 10000;
    const tax = Math.round(subtotal * 0.18);
    const total = subtotal + tax;
    const status = invoiceStatuses[i];
    const invoiceDate = new Date(Date.now() - (10 - i) * 7 * 24 * 60 * 60 * 1000);
    const dueDate = new Date(invoiceDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo,
        clientId: client.id,
        invoiceDate,
        dueDate,
        status,
        subtotal,
        tax,
        total,
        notes: 'Thank you for your business.',
        createdById: admin.id,
        items: {
          create: [
            { description: 'Web Design & Development', qty: 1, rate: subtotal * 0.6, amount: subtotal * 0.6 },
            { description: 'Monthly SEO & Marketing', qty: 1, rate: subtotal * 0.4, amount: subtotal * 0.4 },
          ],
        },
      },
    });

    const paymentDate = status === InvoiceStatus.PAID ? new Date() : null;
    const balanceDue = status === InvoiceStatus.PAID ? 0 : status === InvoiceStatus.PARTIAL ? total * 0.5 : total;

    await prisma.ledger.create({
      data: {
        clientId: client.id,
        invoiceId: invoice.id,
        service: 'Web Design, SEO',
        month: invoiceDate.getMonth() + 1,
        year: invoiceDate.getFullYear(),
        amount: total,
        paymentDate,
        paymentStatus: status === InvoiceStatus.PAID ? 'PAID' : status === InvoiceStatus.PARTIAL ? 'PARTIAL' : 'PENDING',
        balanceDue,
        notes: status === InvoiceStatus.PAID ? 'Paid via UPI' : null,
      },
    });
  }

  // Update invoice counter to reflect seeded invoices
  await prisma.invoiceCounter.update({
    where: { year: currentYear },
    data: { lastSeq: 137 },
  });

  console.log('✅ Seed complete!');
  console.log('');
  console.log('Demo credentials:');
  console.log('  Admin:   admin@devlofox.com    / Admin@123');
  console.log('  Manager: manager1@devlofox.com / Manager@123');
  console.log('  Sales:   sales1@devlofox.com   / Sales@123');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
