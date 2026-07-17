import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

declare global {
  // allow global var in dev to prevent multiple instances during hot-reload
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV === 'development') {
  // Log slow queries in dev
  (prisma as any).$on('query', (e: { query: string; duration: number }) => {
    if (e.duration > 200) {
      logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
    }
  });
  global.__prisma = prisma;
}

export default prisma;
