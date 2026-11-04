/** Central defaults — single place to change product-wide constants. */
export const Defaults = {
  storageLocalDir: '../../data/uploads',
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  /** SLA defaults per severity (minutes) — tenant-overridable via settings. */
  slaResponseMinutes: { low: 480, medium: 240, high: 120, critical: 60 } as Record<string, number>,
  slaResolutionMinutes: { low: 4320, medium: 2880, high: 1440, critical: 480 } as Record<string, number>,
  /** renewal reminder horizon in days before contract end */
  renewalHorizons: [90, 60, 30],
  /** PM generation: only create draft work orders within lead window */
  pmLeadDays: 14,
  /** Signed download URL validity (seconds) */
  signedUrlTtlSeconds: 300,
  /** Technician job-pack sync (audit DATA-07): bounded page + incremental cursor */
  jobPackDefaultLimit: 100,
  jobPackMaxLimit: 200,
  /** Outbox claim lease (seconds) — crash recovery for claimed-but-unprocessed events */
  outboxLeaseSeconds: 120,
  /** Multipart hard ceiling for the interceptor; the service enforces MAX_UPLOAD_MB */
  uploadInterceptorMaxBytes: 32 * 1024 * 1024,
} as const;
