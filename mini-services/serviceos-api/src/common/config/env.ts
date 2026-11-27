import { Defaults } from './defaults';
import { DomainError } from '../errors/domain.error';

export interface Env {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string;
  databaseMigrateUrl: string;
  /** Least-privilege role for the background worker (ADR-014). */
  databaseWorkerUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  appUrl: string;
  apiPublicUrl: string;
  apiGatewayPort: string;
  corsOrigins: string[];
  storageDriver: 'local' | 's3';
  storageLocalDir: string;
  storageS3Bucket: string;
  storageS3Region: string;
  storageS3Endpoint: string;
  storageS3ForcePathStyle: boolean;
  storageS3KmsKeyId: string;
  maxUploadMb: number;
  /** Malware scanning mode: signature (built-in), clamav (production daemon) or disabled (dev/test only). */
  malwareScanner: 'signature' | 'clamav' | 'disabled';
  clamdHost: string;
  clamdPort: number;
  workerPollMs: number;
  enableSwagger: boolean;
  /** Express `trust proxy` setting — required for correct client IPs behind the gateway/ALB. */
  trustProxy: string;
  /** Rate limiting master switch ('off' is a documented test seam only). */
  rateLimiting: 'on' | 'off';
  throttleTtlMs: number;
  throttleLimit: number;
  authThrottleLimit: number;
}

function required(name: string, devDefault?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (devDefault !== undefined && process.env.NODE_ENV !== 'production') return devDefault;
  throw new DomainError('CONFIG_MISSING', `Required environment variable ${name} is not set`, 500);
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) throw new DomainError('CONFIG_INVALID', `${name} must be a non-negative number`, 500);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

/**
 * Loads and validates runtime configuration. Fails fast on missing secrets in
 * production; provides documented development defaults otherwise (never real
 * credentials — see docs/SECURITY.md).
 *
 * Production-only invariants enforced here (audit SEC-07):
 *  - ephemeral local file storage cannot be used in production (S3 required);
 *  - malware scanning cannot be disabled in production.
 */
export function loadEnv(): Env {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as Env['nodeEnv'];
  const appUrl = required('APP_URL', 'http://localhost:3000').replace(/\/$/, '');
  const corsRaw = process.env.CORS_ORIGINS ?? appUrl;

  const storageDriver = (process.env.STORAGE_DRIVER ?? 'local') as Env['storageDriver'];
  const malwareScanner = (process.env.MALWARE_SCANNER ?? 'signature') as Env['malwareScanner'];

  if (nodeEnv === 'production') {
    if (storageDriver !== 's3') {
      throw new DomainError(
        'CONFIG_INVALID',
        'STORAGE_DRIVER=local is ephemeral local-disk storage and must not be used in production — configure STORAGE_DRIVER=s3 with a private bucket (docs/DEPLOYMENT.md)',
        500,
      );
    }
    if (malwareScanner === 'disabled') {
      throw new DomainError(
        'CONFIG_INVALID',
        'MALWARE_SCANNER=disabled is not permitted in production — configure signature or clamav scanning',
        500,
      );
    }
  }
  if (storageDriver === 's3') {
    // Required S3 settings must exist whenever the S3 driver is selected.
    required('STORAGE_S3_BUCKET');
    required('STORAGE_S3_REGION');
  }

  return {
    nodeEnv,
    port: num('PORT', 4000),
    databaseUrl: required('DATABASE_URL', 'postgresql://serviceos_app:serviceos_app_dev@127.0.0.1:5433/serviceos'),
    databaseMigrateUrl: required('DATABASE_MIGRATE_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/serviceos'),
    databaseWorkerUrl: required('DATABASE_WORKER_URL', 'postgresql://serviceos_worker:serviceos_worker_dev@127.0.0.1:5433/serviceos'),
    jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me'),
    jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me'),
    accessTokenTtlMinutes: num('ACCESS_TOKEN_TTL_MINUTES', 15),
    refreshTokenTtlDays: num('REFRESH_TOKEN_TTL_DAYS', 30),
    appUrl,
    apiPublicUrl: (process.env.API_PUBLIC_URL ?? appUrl).replace(/\/$/, ''),
    apiGatewayPort: process.env.API_GATEWAY_PORT ?? '',
    corsOrigins: corsRaw
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    storageDriver,
    storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? Defaults.storageLocalDir,
    storageS3Bucket: process.env.STORAGE_S3_BUCKET ?? '',
    storageS3Region: process.env.STORAGE_S3_REGION ?? '',
    storageS3Endpoint: (process.env.STORAGE_S3_ENDPOINT ?? '').replace(/\/$/, ''),
    storageS3ForcePathStyle: bool('STORAGE_S3_FORCE_PATH_STYLE', false),
    storageS3KmsKeyId: process.env.STORAGE_S3_KMS_KEY_ID ?? '',
    maxUploadMb: num('MAX_UPLOAD_MB', 25),
    malwareScanner,
    clamdHost: process.env.CLAMD_HOST ?? '127.0.0.1',
    clamdPort: num('CLAMD_PORT', 3310),
    workerPollMs: num('WORKER_POLL_MS', 3000),
    enableSwagger: process.env.ENABLE_SWAGGER === 'true' || nodeEnv !== 'production',
    trustProxy: process.env.TRUST_PROXY ?? 'loopback',
    rateLimiting: (process.env.RATE_LIMITING ?? (nodeEnv === 'test' ? 'off' : 'on')) as Env['rateLimiting'],
    throttleTtlMs: num('THROTTLE_TTL_MS', 60_000),
    throttleLimit: num('THROTTLE_LIMIT', 300),
    authThrottleLimit: num('AUTH_THROTTLE_LIMIT', 10),
  };
}

export const EnvToken = 'ENV';
export { Defaults };
