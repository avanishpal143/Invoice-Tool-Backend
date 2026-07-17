import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLogger';
import { createClientSchema, updateClientSchema } from './clients.schema';
import prisma from '../../lib/prisma';

const router = Router();
router.use(authenticate, requireRole(['ADMIN', 'MANAGER']));
router.use(auditLog);

// ─── List clients ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { search, status, city, page = '1', limit = '25' } = req.query as Record<string, string>;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where: any = {};
  if (status) where.status = status;
  if (city) where.city = { contains: city };
  if (search) {
    where.OR = [
      { clientName: { contains: search } },
      { businessName: { contains: search } },
      { phone: { contains: search } },
      { clientCode: { contains: search } },
    ];
  }

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
    }),
    prisma.client.count({ where }),
  ]);

  res.json({ success: true, data: clients, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

// ─── Create client ────────────────────────────────────────────
router.post('/', validate(createClientSchema), async (req: Request, res: Response): Promise<void> => {
  const data = req.body;

  // Auto-generate clientCode: DFX-NNN
  const count = await prisma.client.count();
  const clientCode = `DFX-${String(count + 1).padStart(3, '0')}`;

  const client = await prisma.client.create({
    data: {
      ...data,
      clientCode,
      packageAmount: data.packageAmount ?? undefined,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : undefined,
    },
  });

  res.locals.createdId = client.id;
  res.status(201).json({ success: true, data: client });
});

// ─── Get client detail ────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      invoices: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { items: true },
      },
      ledger: { orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });

  if (!client) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } });
    return;
  }

  res.json({ success: true, data: client });
});

// ─── Update client ────────────────────────────────────────────
router.patch('/:id', validate(updateClientSchema), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  const data = req.body;

  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Client not found.' } });
    return;
  }

  const client = await prisma.client.update({
    where: { id },
    data: {
      ...data,
      packageAmount: data.packageAmount ?? undefined,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : undefined,
    },
  });

  res.json({ success: true, data: client });
});

export default router;
