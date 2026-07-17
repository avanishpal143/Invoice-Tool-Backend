import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { logger } from '../config/logger';

type EntityType = 'invoice' | 'client' | 'lead' | 'user' | 'settings' | 'ledger';

interface AuditRoute {
  entityType: EntityType;
  /** Extract the entity ID from the request (e.g. req.params.id) */
  getEntityId: (req: Request) => string | undefined;
  /** Fetch the current state of the entity before mutation */
  fetchEntity: (id: string) => Promise<Record<string, unknown> | null>;
}

const ROUTE_MAP: Record<string, AuditRoute> = {
  invoices: {
    entityType: 'invoice',
    getEntityId: (req) => req.params.id,
    fetchEntity: async (id) =>
      prisma.invoice.findUnique({
        where: { id: parseInt(id) },
        include: { items: true },
      }) as unknown as Record<string, unknown>,
  },
  clients: {
    entityType: 'client',
    getEntityId: (req) => req.params.id,
    fetchEntity: async (id) =>
      prisma.client.findUnique({ where: { id: parseInt(id) } }) as unknown as Record<string, unknown>,
  },
  leads: {
    entityType: 'lead',
    getEntityId: (req) => req.params.id,
    fetchEntity: async (id) =>
      prisma.lead.findUnique({ where: { id: parseInt(id) } }) as unknown as Record<string, unknown>,
  },
  users: {
    entityType: 'user',
    getEntityId: (req) => req.params.id,
    fetchEntity: async (id) =>
      prisma.user.findUnique({
        where: { id: parseInt(id) },
        select: { id: true, name: true, email: true, role: true, status: true },
      }) as unknown as Record<string, unknown>,
  },
};

function getRouteConfig(req: Request): AuditRoute | null {
  const segments = req.path.split('/').filter(Boolean);
  // segments[0] is the module name (invoices, clients, etc.)
  const module = segments[0];
  return ROUTE_MAP[module] ?? null;
}

function deriveAction(method: string, path: string): string {
  if (method === 'DELETE') return 'DELETE';
  if (method === 'POST') {
    if (path.includes('/void')) return 'VOID';
    if (path.includes('/issue')) return 'ISSUE';
    if (path.includes('/payments')) return 'PAYMENT';
    if (path.includes('/notes')) return 'ADD_NOTE';
    if (path.includes('/convert')) return 'CONVERT';
    return 'CREATE';
  }
  if (method === 'PATCH') return 'UPDATE';
  return method;
}

/**
 * Auto audit-log middleware.
 *
 * For PATCH and DELETE requests to tracked entities:
 * - Captures the "before" state before the handler runs
 * - Writes an audit_log row after the response finishes
 *
 * Apply to each router AFTER authenticate but BEFORE handlers:
 *   router.use(authenticate, auditLog)
 */
export function auditLog(req: Request, res: Response, next: NextFunction): void {
  const MUTATING_METHODS = ['POST', 'PATCH', 'DELETE'];
  if (!MUTATING_METHODS.includes(req.method)) return next();

  const config = getRouteConfig(req);
  if (!config) return next();

  const entityId = config.getEntityId(req);
  const action = deriveAction(req.method, req.path);

  let beforeValue: Record<string, unknown> | null = null;

  const captureAndWrite = async () => {
    // Capture before-state for PATCH and DELETE
    if ((req.method === 'PATCH' || req.method === 'DELETE') && entityId) {
      try {
        beforeValue = await config.fetchEntity(entityId);
      } catch {
        // entity may not exist — that's fine
      }
    }

    res.on('finish', async () => {
      if (res.statusCode >= 400) return; // don't log failed operations

      let afterValue: Record<string, unknown> | null = null;
      if (req.method !== 'DELETE' && entityId) {
        try {
          afterValue = await config.fetchEntity(entityId);
        } catch { /* ignore */ }
      }

      // For POSTs (creates), try to get the entity ID from the response body
      const responseEntityId = entityId ?? (res.locals.createdId ? String(res.locals.createdId) : undefined);

      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user?.id ?? null,
            action,
            entityType: config.entityType,
            entityId: responseEntityId ?? null,
            beforeValue: beforeValue as any,
            afterValue: afterValue as any,
          },
        });
      } catch (err) {
        logger.error('Failed to write audit log', err);
      }
    });

    next();
  };

  captureAndWrite().catch((err) => {
    logger.error('Audit middleware error', err);
    next();
  });
}
