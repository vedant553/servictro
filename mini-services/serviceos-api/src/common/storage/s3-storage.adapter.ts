import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { StoragePort } from './storage.port';
import { EnvToken, type Env } from '../config/env';

/**
 * Production storage adapter (ADR-010, audit INFRA-01): private Amazon S3
 * bucket with SSE (AES256 or KMS when STORAGE_S3_KMS_KEY_ID is set) and
 * presigned GET URLs — the same TTL/trust model as the local adapter's HMAC
 * URLs. Credentials come from the standard AWS provider chain (IAM role in
 * production, env vars in CI).
 *
 * The bucket must be private with public access blocked (enforced by the
 * Terraform module — infra/terraform/s3.tf).
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string;
  private readonly forcePathStyle: boolean;
  private readonly kmsKeyId?: string;
  /** Lazily constructed — the provider is always instantiated by Nest, but the client is only built when this adapter is actually selected (driver=s3). */
  private clientInstance?: S3Client;

  constructor(@Inject(EnvToken) env: Env) {
    this.bucket = env.storageS3Bucket;
    this.region = env.storageS3Region;
    this.endpoint = env.storageS3Endpoint;
    this.forcePathStyle = env.storageS3ForcePathStyle;
    this.kmsKeyId = env.storageS3KmsKeyId || undefined;
  }

  private get client(): S3Client {
    if (!this.clientInstance) {
      if (!this.region || !this.bucket) {
        throw new Error('S3 storage driver selected but STORAGE_S3_REGION/STORAGE_S3_BUCKET are not configured');
      }
      this.clientInstance = new S3Client({
        region: this.region,
        ...(this.endpoint ? { endpoint: this.endpoint } : {}),
        ...(this.forcePathStyle ? { forcePathStyle: true } : {}),
      });
    }
    return this.clientInstance;
  }

  async put(objectKey: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: data,
        ContentType: contentType,
        ServerSideEncryption: this.kmsKeyId ? 'aws:kms' : 'AES256',
        ...(this.kmsKeyId ? { SSEKMSKeyId: this.kmsKeyId } : {}),
      }),
    );
  }

  async read(objectKey: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    const body = res.Body;
    if (!body) throw new Error(`S3 object ${objectKey} has no body`);
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  openStream(objectKey: string): NodeJS.ReadableStream {
    // Streams start lazily so callers can pipe without awaiting.
    const client = this.client;
    const bucket = this.bucket;
    return new Readable({
      read() {
        void (async () => {
          try {
            const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
            const body = res.Body;
            if (!body) {
              this.push(null);
              return;
            }
            for await (const chunk of body as AsyncIterable<Uint8Array>) this.push(Buffer.from(chunk));
            this.push(null);
          } catch (error) {
            this.destroy(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      },
    });
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return false;
      throw error;
    }
  }

  async signDownloadUrl(objectKey: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        // Content-Disposition mirrors the local driver's sanitized attachment.
        ResponseContentDisposition: 'attachment',
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `s3 bucket ${this.bucket} configured` };
  }
}
