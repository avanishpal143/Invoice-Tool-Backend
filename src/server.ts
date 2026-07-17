import { env } from './config/env';
import { logger } from './config/logger';
import { createApp } from './app';
import prisma from './lib/prisma';

async function main() {
  // Verify DB connection before starting
  await prisma.$connect();
  logger.info('Database connected');

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`🦊 Devlofox CRM API running on http://localhost:${env.PORT}`);
    logger.info(`   Environment: ${env.NODE_ENV}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
