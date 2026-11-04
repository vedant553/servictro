import { Controller, Get, Inject } from '@nestjs/common';
import { Public, SkipEnvelope } from '../../common/auth/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { STORAGE_PORT } from '../../common/storage/storage.module';
import type { StoragePort } from '../../common/storage/storage.port';
import { EnvToken, type Env } from '../../common/config/env';

@Controller('health')
@Public()
@SkipEnvelope()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(EnvToken) private readonly env: Env,
  ) {}

  /** Liveness: process health only (Tech Spec §3.5). */
  @Get('live')
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Readiness: dependencies healthy (database + configured storage driver). */
  @Get('ready')
  async ready(): Promise<{ status: string; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    // Adapter-aware: local driver probes the directory, S3 driver its config
    // (a full HeadBucket on every probe would be needlessly expensive).
    try {
      const health = await this.storage.health();
      checks.storage = health.ok ? 'ok' : `fail:${health.detail ?? 'unknown'}`;
    } catch {
      checks.storage = 'fail';
    }
    const ok = Object.values(checks).every((c) => c === 'ok');
    return { status: ok ? 'ok' : 'degraded', checks };
  }

  /**
   * Background-worker heartbeat (audit INFRA-07): reports pass freshness.
   * `healthy=false` means the worker has not polled the outbox within
   * 3× its interval — deliveries/reminders are stalled.
   */
  @Get('worker')
  async worker(): Promise<{
    status: string;
    workerId: string | null;
    lastOutboxPollAt: string | null;
    lastPmPassAt: string | null;
    lastRenewalPassAt: string | null;
    outboxPollAgeSeconds: number | null;
    healthy: boolean;
    expectedPollIntervalSeconds: number;
  }> {
    const expectedPollIntervalSeconds = Math.max(Math.floor(this.env.workerPollMs / 1000), 1);
    try {
      const beat = await this.prisma.workerHeartbeat.findUnique({ where: { id: 'singleton' } });
      if (!beat) {
        return {
          status: 'unknown',
          workerId: null,
          lastOutboxPollAt: null,
          lastPmPassAt: null,
          lastRenewalPassAt: null,
          outboxPollAgeSeconds: null,
          healthy: false,
          expectedPollIntervalSeconds,
        };
      }
      const ageSeconds = beat.lastOutboxPollAt
        ? Math.floor((Date.now() - beat.lastOutboxPollAt.getTime()) / 1000)
        : null;
      const healthy = ageSeconds !== null && ageSeconds <= 3 * expectedPollIntervalSeconds;
      return {
        status: healthy ? 'ok' : 'stalled',
        workerId: beat.workerId,
        lastOutboxPollAt: beat.lastOutboxPollAt?.toISOString() ?? null,
        lastPmPassAt: beat.lastPmPassAt?.toISOString() ?? null,
        lastRenewalPassAt: beat.lastRenewalPassAt?.toISOString() ?? null,
        outboxPollAgeSeconds: ageSeconds,
        healthy,
        expectedPollIntervalSeconds,
      };
    } catch {
      return {
        status: 'error',
        workerId: null,
        lastOutboxPollAt: null,
        lastPmPassAt: null,
        lastRenewalPassAt: null,
        outboxPollAgeSeconds: null,
        healthy: false,
        expectedPollIntervalSeconds,
      };
    }
  }
}
