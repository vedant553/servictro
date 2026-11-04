/**
 * Storage port (ADR-010): one interface, two implementations.
 *  - LocalDiskStorageAdapter  → private on-disk storage + HMAC signed URLs
 *    (development / this sandbox; equivalent semantics to S3 presigned URLs).
 *  - S3StorageAdapter         → private bucket + presigned GET URLs
 *    (production; requires AWS credentials via the standard provider chain).
 *
 * Object keys are opaque and tenant-namespaced; never contain customer PII or
 * original file names (Tech Spec §13.3).
 */
export interface StoragePort {
  /** Persist bytes at the given opaque key. */
  put(objectKey: string, data: Buffer, contentType: string): Promise<void>;

  /** Read object bytes (small objects: QRs, report metadata). */
  read(objectKey: string): Promise<Buffer>;

  /** Stream object bytes (large reports/drawings). */
  openStream(objectKey: string): NodeJS.ReadableStream;

  /** Delete object bytes. */
  remove(objectKey: string): Promise<void>;

  /** True when the object exists. */
  exists(objectKey: string): Promise<boolean>;

  /**
   * Short-lived signed download URL for the object. Local driver: HMAC path
   * served by /api/v1/files/download; S3 driver: presigned GET URL served
   * directly by the bucket (same trust model, same TTL).
   */
  signDownloadUrl(objectKey: string, ttlSeconds: number): Promise<string>;

  /** Adapter health probe used by /health/ready. */
  health(): Promise<{ ok: boolean; detail?: string }>;
}
