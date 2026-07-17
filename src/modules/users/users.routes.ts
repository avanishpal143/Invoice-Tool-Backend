import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import bcrypt from 'bcryptjs';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /users/me — smoke-test endpoint, any authenticated role
router.get('/me', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
  });
  res.json({ success: true, data: user });
});

// GET /users — Admin only
router.get('/', requireRole(['ADMIN']), async (req, res) => {
  const { role, status, page = '1', limit = '25' } = req.query as Record<string, string>;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const where: any = {};
  if (role) where.role = role;
  if (status) where.status = status;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({ success: true, data: users, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'MANAGER', 'SALES']),
});

// POST /users — Admin only
router.post('/', requireRole(['ADMIN']), validate(createUserSchema), async (req, res) => {
  const { name, email, password, role } = req.body;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    res.status(409).json({ success: false, error: { code: 'EMAIL_TAKEN', message: 'Email already in use.' } });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: 'CREATE', entityType: 'user', entityId: String(user.id), afterValue: { name, email, role } },
  });

  res.status(201).json({ success: true, data: user });
});

// GET /users/:id — Admin only
router.get('/:id', requireRole(['ADMIN']), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: parseInt(req.params.id) },
    select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
  });
  if (!user) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }); return; }
  res.json({ success: true, data: user });
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'SALES']).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

// PATCH /users/:id — Admin only
router.patch('/:id', requireRole(['ADMIN']), validate(updateUserSchema), async (req, res) => {
  const targetId = parseInt(req.params.id);

  // Admin cannot deactivate themselves
  if (req.body.status === 'INACTIVE' && targetId === req.user!.id) {
    res.status(400).json({ success: false, error: { code: 'SELF_DEACTIVATE', message: 'You cannot deactivate your own account.' } });
    return;
  }

  const before = await prisma.user.findUnique({ where: { id: targetId }, select: { name: true, role: true, status: true } });
  if (!before) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } }); return; }

  const user = await prisma.user.update({
    where: { id: targetId },
    data: req.body,
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  await prisma.auditLog.create({
    data: { userId: req.user!.id, action: 'UPDATE', entityType: 'user', entityId: String(targetId), beforeValue: before, afterValue: req.body },
  });

  res.json({ success: true, data: user });
});

export default router;
