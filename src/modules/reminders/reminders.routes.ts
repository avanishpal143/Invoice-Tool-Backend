import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import prisma from '../../lib/prisma';

const router = Router();
router.use(authenticate, requireRole(['ADMIN', 'MANAGER']));

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const now   = new Date();
  const in7   = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Batch-update genuinely overdue invoices
  await prisma.invoice.updateMany({
    where: {
      status:   { in: ['ISSUED', 'PARTIAL'] },
      dueDate:  { lt: now },
    },
    data: { status: 'OVERDUE' },
  });

  const [overdue, dueSoon] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: 'OVERDUE' },
      orderBy: { dueDate: 'asc' },
      take: 20,
      include: { client: { select: { id: true, clientName: true, clientCode: true } } },
    }),
    prisma.invoice.findMany({
      where: {
        status:  { in: ['ISSUED', 'PARTIAL'] },
        dueDate: { gte: now, lte: in7 },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
      include: { client: { select: { id: true, clientName: true, clientCode: true } } },
    }),
  ]);

  res.json({ success: true, data: { overdue, dueSoon } });
});

export default router;
