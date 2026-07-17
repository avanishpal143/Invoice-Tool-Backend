import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/requireRole';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLogger';
import { createLeadSchema, updateLeadSchema, addNoteSchema } from './leads.schema';
import prisma from '../../lib/prisma';

const router = Router();
router.use(authenticate);

// ─── Helper: parse nullable date ────────────────────────────
function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ─── List leads ──────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const {
    source, status, contactedById, from, to, search,
    page = '1', limit = '25',
  } = req.query as Record<string, string>;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const where: any = {};

  // SALES: can only see their own leads
  if (req.user!.role === 'SALES') {
    where.contactedById = req.user!.id;
  } else if (contactedById) {
    where.contactedById = parseInt(contactedById);
  }

  if (source) where.source = source;
  if (status) where.status = status;

  if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to)   where.date.lte = new Date(to);
  }

  if (search) {
    where.OR = [
      { name:          { contains: search } },
      { contactNumber: { contains: search } },
      { email:         { contains: search } },
    ];
  }

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip,
      take:     parseInt(limit),
      orderBy:  { createdAt: 'desc' },
      include:  {
        contactedBy:    { select: { id: true, name: true } },
        convertedClient:{ select: { id: true, clientName: true, clientCode: true } },
        _count:         { select: { notes: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  res.json({ success: true, data: leads, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

// ─── Create lead ─────────────────────────────────────────────
router.post('/', validate(createLeadSchema), auditLog, async (req: Request, res: Response): Promise<void> => {
  const data = req.body;
  const lead = await prisma.lead.create({
    data: {
      ...data,
      date:             new Date(data.date),
      lastConversation: parseDate(data.lastConversation),
      nextCall:         parseDate(data.nextCall),
      followUp1:        parseDate(data.followUp1),
      followUp2:        parseDate(data.followUp2),
      followUp3:        parseDate(data.followUp3),
    },
    include: { contactedBy: { select: { id: true, name: true } } },
  });
  res.locals.createdId = lead.id;
  res.status(201).json({ success: true, data: lead });
});

// ─── Get lead detail ──────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      contactedBy:    { select: { id: true, name: true } },
      convertedClient:{ select: { id: true, clientName: true, clientCode: true } },
      notes: {
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, role: true } } },
      },
    },
  });

  if (!lead) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found.' } });
    return;
  }

  // SALES can only see their own leads
  if (req.user!.role === 'SALES' && lead.contactedById !== req.user!.id) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    return;
  }

  res.json({ success: true, data: lead });
});

// ─── Update lead ──────────────────────────────────────────────
router.patch('/:id', validate(updateLeadSchema), auditLog, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  const data = req.body;

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found.' } });
    return;
  }
  if (req.user!.role === 'SALES' && existing.contactedById !== req.user!.id) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    return;
  }

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      ...data,
      date:             data.date            ? new Date(data.date)            : undefined,
      lastConversation: 'lastConversation' in data ? parseDate(data.lastConversation) : undefined,
      nextCall:         'nextCall'         in data ? parseDate(data.nextCall)         : undefined,
      followUp1:        'followUp1'        in data ? parseDate(data.followUp1)        : undefined,
      followUp2:        'followUp2'        in data ? parseDate(data.followUp2)        : undefined,
      followUp3:        'followUp3'        in data ? parseDate(data.followUp3)        : undefined,
    },
    include: { contactedBy: { select: { id: true, name: true } } },
  });

  res.json({ success: true, data: lead });
});

// ─── Delete lead (Admin only) ─────────────────────────────────
router.delete('/:id', requireRole(['ADMIN']), auditLog, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found.' } });
    return;
  }

  await prisma.$transaction([
    prisma.leadNote.deleteMany({ where: { leadId: id } }),
    prisma.lead.delete({ where: { id } }),
  ]);

  res.status(204).send();
});

// ─── Add note ─────────────────────────────────────────────────
router.post('/:id/notes', validate(addNoteSchema), async (req: Request, res: Response): Promise<void> => {
  const leadId = parseInt(req.params.id);

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found.' } });
    return;
  }
  if (req.user!.role === 'SALES' && lead.contactedById !== req.user!.id) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    return;
  }

  // Update lastConversation timestamp
  await prisma.lead.update({
    where: { id: leadId },
    data: { lastConversation: new Date() },
  });

  const note = await prisma.leadNote.create({
    data: { leadId, userId: req.user!.id, note: req.body.note },
    include: { user: { select: { id: true, name: true, role: true } } },
  });

  res.status(201).json({ success: true, data: note });
});

// ─── Convert to Client (Admin / Manager only) ─────────────────
router.post('/:id/convert', requireRole(['ADMIN', 'MANAGER']), async (req: Request, res: Response): Promise<void> => {
  const leadId = parseInt(req.params.id);

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found.' } });
    return;
  }
  if (lead.status === 'CONVERTED') {
    res.status(422).json({ success: false, error: { code: 'ALREADY_CONVERTED', message: 'Lead is already converted.' } });
    return;
  }

  const client = await prisma.$transaction(async (tx) => {
    const count = await tx.client.count();
    const clientCode = `DFX-${String(count + 1).padStart(3, '0')}`;

    const newClient = await tx.client.create({
      data: {
        clientCode,
        clientName:    lead.name,
        phone:         lead.contactNumber,
        email:         lead.email   ?? undefined,
        businessName:  lead.businessInfo?.slice(0, 100) ?? undefined,
        leadSource:    lead.source,
        activeServices:lead.requiredService ?? undefined,
        packageAmount: lead.dealValue ?? undefined,
        status:        'ACTIVE',
      },
    });

    await tx.lead.update({
      where: { id: leadId },
      data: {
        status:           'CONVERTED',
        convertedClientId: newClient.id,
      },
    });

    await tx.auditLog.create({
      data: {
        userId:     req.user!.id,
        action:     'CONVERT',
        entityType: 'lead',
        entityId:   String(leadId),
        afterValue: { clientId: newClient.id, clientCode } as any,
      },
    });

    return newClient;
  });

  res.status(201).json({ success: true, data: client });
});

export default router;
