import pino from 'pino';

/**
 * Structured JSON logger (Tech Spec §18.1): timestamp, severity, service,
 * requestId, tenantId (internal) — never payloads, tokens or personal data.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE_NAME ?? 'serviceos-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token'],
    censor: '[redacted]',
  },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
