import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import prisma from '../../lib/prisma';

const router = Router();
router.use(authenticate, requireRole(['ADMIN', 'MANAGER']));

// ─── KPIs ─────────────────────────────────────────────────────
router.get('/kpis', async (_req: Request, res: Response): Promise<void> => {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [
    leadsThisMonth,
    leadsConverted,
    totalLeads,
    paidInvoices,
    outstandingResult,
    totalClients,
    totalInvoices,
  ] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.lead.count({ where: { status: 'CONVERTED', updatedAt: { gte: start, lte: end } } }),
    prisma.lead.count(),
    prisma.invoice.aggregate({
      _sum: { total: true },
      where: { status: 'PAID', updatedAt: { gte: start, lte: end } },
    }),
    prisma.ledger.aggregate({
      _sum: { balanceDue: true },
      where: { paymentStatus: { in: ['PENDING', 'PARTIAL'] } },
    }),
    prisma.client.count({ where: { status: 'ACTIVE' } }),
    prisma.invoice.count(),
  ]);

  const conversionRate = totalLeads > 0
    ? Math.round((leadsConverted / totalLeads) * 100)
    : 0;

  res.json({
    success: true,
    data: {
      leadsThisMonth,
      leadsConverted,
      conversionRate,
      revenueThisMonth:  parseFloat(paidInvoices._sum.total?.toString() ?? '0'),
      outstandingDues:   parseFloat(outstandingResult._sum.balanceDue?.toString() ?? '0'),
      totalClients,
      totalInvoices,
    },
  });
});

// ─── Charts ───────────────────────────────────────────────────
router.get('/charts', async (_req: Request, res: Response): Promise<void> => {
  const now  = new Date();
  const year = now.getFullYear();

  // (a) Revenue by month — last 12 months of PAID invoices
  const revenueRows = await prisma.$queryRaw<{ month: number; year: number; revenue: number }[]>`
    SELECT
      MONTH(updatedAt) AS month,
      YEAR(updatedAt)  AS year,
      SUM(total)       AS revenue
    FROM invoices
    WHERE status = 'PAID'
      AND updatedAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
    GROUP BY YEAR(updatedAt), MONTH(updatedAt)
    ORDER BY YEAR(updatedAt), MONTH(updatedAt)
  `;

  // Build a full 12-slot array
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const revenueByMonth = Array.from({ length: 12 }, (_, i) => {
    const m = ((now.getMonth() - 11 + i + 12) % 12) + 1;
    const y = m > now.getMonth() + 1 ? year - 1 : year;
    const row = revenueRows.find(r => r.month === m && r.year === y);
    return { name: MONTH_NAMES[m - 1], revenue: row ? parseFloat(String(row.revenue)) : 0 };
  });

  // (b) Leads by source
  const leadsBySource = await prisma.lead.groupBy({
    by: ['source'],
    _count: { _all: true },
  });

  // (c) Invoices by status
  const invoicesByStatus = await prisma.invoice.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  res.json({
    success: true,
    data: {
      revenueByMonth,
      leadsBySource: leadsBySource.map(r => ({ name: r.source, value: r._count._all })),
      invoicesByStatus: invoicesByStatus.map(r => ({ name: r.status, value: r._count._all })),
    },
  });
});

// ─── Recent activity ──────────────────────────────────────────
router.get('/activity', async (req: Request, res: Response): Promise<void> => {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { user: { select: { id: true, name: true, role: true } } },
  });

  res.json({ success: true, data: logs });
});

export default router;
