import './common/config/load-env-file';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';
import { WorkerRunner } from './worker/worker-runner';
import { logger } from './common/logging/logger';

/**
 * ServiceOS background worker entrypoint. Runs the transactional-outbox
 * dispatcher, preventive-maintenance generation and renewal reminders as a
 * separate process from the API (same codebase — Tech Spec §3.1).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  const runner = app.get(WorkerRunner);
  await runner.start();
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  logger.info({ pid: process.pid }, 'serviceos-worker started');
}

void bootstrap();
