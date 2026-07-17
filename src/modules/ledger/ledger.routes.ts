import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import prisma from '../../lib/prisma';

const router = Router();
router.use(authenticate, requireRole(['ADMIN', 'MANAGER']));

// ─── Paginated ledger list ────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { clientId, month, year, paymentStatus, page = '1', limit = '25' } = req.query as Record<string, string>;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where: any = {};
  if (clientId) where.clientId = parseInt(clientId);
  if (month) where.month = parseInt(month);
  if (year) where.year = parseInt(year);
  if (paymentStatus) where.paymentStatus = paymentStatus;

  const [rows, total] = await Promise.all([
    prisma.ledger.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      include: {
        client: { select: { id: true, clientName: true, clientCode: true } },
        invoice: { select: { id: true, invoiceNo: true, status: true } },
      },
    }),
    prisma.ledger.count({ where }),
  ]);

  res.json({ success: true, data: rows, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

// ─── Monthly summary grid ─────────────────────────────────────
// Returns: { clientId, clientName, clientCode, jan, feb, ..., dec, total }[]
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  const { year = String(new Date().getFullYear()) } = req.query as Record<string, string>;
  const y = parseInt(year);

  // Raw aggregation: sum of payments per client per month for the given year
  const rows = await prisma.ledger.groupBy({
    by: ['clientId', 'month'],
    where: {
      year: y,
      paymentStatus: { in: ['PAID', 'PARTIAL'] },
      paymentDate: { not: null },
    },
    _sum: { amount: true },
    orderBy: { clientId: 'asc' },
  });

  // Get all clients that appear in results
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, clientName: true, clientCode: true },
  });

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const summary = clients.map((client) => {
    const clientRows = rows.filter((r) => r.clientId === client.id);
    const monthTotals: Record<string, number> = {};
    let total = 0;
    MONTHS.forEach((m, i) => {
      const row = clientRows.find((r) => r.month === i + 1);
      const val = row?._sum?.amount ? parseFloat(row._sum.amount.toString()) : 0;
      monthTotals[m] = val;
      total += val;
    });
    return { clientId: client.id, clientName: client.clientName, clientCode: client.clientCode, ...monthTotals, total };
  });

  res.json({ success: true, data: summary, meta: { year: y } });
});

export default router;
