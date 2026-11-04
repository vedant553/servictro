import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { EnvToken, type Env } from '../config/env';

/**
 * ServiceOS rate-limit guard (audit SEC-02).
 *
 * Extends the standard ThrottlerGuard with two production requirements:
 *
 *  1. Tracker selection — authenticated requests are throttled per USER id
 *     (fair across tenants sharing an office NAT/gateway IP); anonymous
 *     endpoints (login/register/refresh) are throttled per client IP.
 *  2. A documented test seam — RATE_LIMITING=off disables the guard so the
 *     integration suite is not throttled; the dedicated rate-limit spec
 *     spawns its own process with RATE_LIMITING=on and tight limits.
 *
 * The express app runs with `trust proxy` (env TRUST_PROXY) so req.ip is the
 * real client address behind the gateway/ALB. Limits are configured on the
 * module (THROTTLE_LIMIT per THROTTLE_TTL_MS); auth endpoints are tightened
 * with @Throttle decorators on the controller.
 */
@Injectable()
export class ServiceThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(EnvToken) private readonly appEnv: Env,
  ) {
    super(options, storageService, reflector);
  }

  /** Disable throttling when RATE_LIMITING=off (test seam — never in production). */
  protected async shouldSkip(): Promise<boolean> {
    return this.appEnv.rateLimiting === 'off';
  }

  /** Throttle authenticated users per user id, anonymous requests per IP. */
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = (req as { user?: { id?: string } }).user;
    if (user?.id) return `user:${user.id}`;
    const ip = (req as { ip?: string }).ip ?? 'unknown';
    return `ip:${ip}`;
  }
}
