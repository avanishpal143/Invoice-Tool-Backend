import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { logger } from './config/logger';
import { apiLimiter } from './middleware/rateLimiter';

// Route modules
import authRoutes     from './modules/auth/auth.routes';
import usersRoutes    from './modules/users/users.routes';
import clientsRoutes  from './modules/clients/clients.routes';
import invoicesRoutes from './modules/invoices/invoices.routes';
import ledgerRoutes   from './modules/ledger/ledger.routes';
import settingsRoutes from './modules/settings/settings.routes';
import leadsRoutes     from './modules/leads/leads.routes';
import remindersRoutes from './modules/reminders/reminders.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import auditRoutes     from './modules/audit/audit.routes';
import importRoutes    from './modules/import/import.routes';

export function createApp() {
  const app = express();

  // ─── Security middleware ──────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true, // allow cookies
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // ─── Body parsing ─────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ─── Request logging ──────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // ─── Static uploads ───────────────────────────────────────────
  app.use('/uploads', express.static(env.UPLOADS_DIR));

  // ─── Global rate limit ────────────────────────────────────────
  app.use('/api', apiLimiter);

  // ─── Routes ───────────────────────────────────────────────────
  app.use('/api/v1/auth',     authRoutes);
  app.use('/api/v1/users',    usersRoutes);
  app.use('/api/v1/clients',  clientsRoutes);
  app.use('/api/v1/invoices', invoicesRoutes);
  app.use('/api/v1/ledger',   ledgerRoutes);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/leads',     leadsRoutes);
  app.use('/api/v1/reminders', remindersRoutes);
  app.use('/api/v1/dashboard', dashboardRoutes);
  app.use('/api/v1/audit-log', auditRoutes);
  app.use('/api/v1/import',    importRoutes);

  // ─── Health check ─────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ─── 404 handler ──────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
  });

  // ─── Global error handler ─────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', err);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' },
    });
  });

  return app;
}
