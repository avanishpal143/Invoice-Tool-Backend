import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import prisma from '../../lib/prisma';

const router = Router();
router.use(authenticate, requireRole(['ADMIN']));

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const {
    userId, entityType, action, from, to,
    page = '1', limit = '25',
  } = req.query as Record<string, string>;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const where: any = {};

  if (userId)     where.userId     = parseInt(userId);
  if (entityType) where.entityType = entityType;
  if (action)     where.action     = action;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to)   where.createdAt.lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ success: true, data: logs, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

export default router;
