import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { StoragePort } from './storage.port';
import { EnvToken, type Env } from '../config/env';

/**
 * Development storage adapter (ADR-010): private local directory, opaque
 * tenant-namespaced keys, HMAC-signed short-lived download URLs — mirroring
 * the production S3 presigned-URL semantics without cloud credentials.
 *
 * NEVER valid in production: loadEnv() rejects STORAGE_DRIVER=local when
 * NODE_ENV=production (audit SEC-07).
 */
@Injectable()
export class LocalDiskStorageAdapter implements StoragePort {
  private readonly baseDir: string;
  private readonly signingKey: string;

  constructor(@Inject(EnvToken) env: Env) {
    this.baseDir = resolve(process.cwd(), env.storageLocalDir);
    this.signingKey = env.jwtAccessSecret;
  }

  private pathFor(objectKey: string): string {
    const safe = normalize(objectKey).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = join(this.baseDir, safe);
    if (!full.startsWith(this.baseDir)) throw new Error('Invalid object key');
    return full;
  }

  async put(objectKey: string, data: Buffer, _contentType: string): Promise<void> {
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async read(objectKey: string): Promise<Buffer> {
    return readFile(this.pathFor(objectKey));
  }

  openStream(objectKey: string): NodeJS.ReadableStream {
    return createReadStream(this.pathFor(objectKey));
  }

  async remove(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await stat(this.pathFor(objectKey));
      return true;
    } catch {
      return false;
    }
  }

  async signDownloadUrl(objectKey: string, ttlSeconds: number): Promise<string> {
    return this.signDownloadPath(objectKey, '', ttlSeconds);
  }

  /**
   * Signed URL: base64url(`objectKey|tenantId|expiry`) + HMAC. Authorizes a
   * download without a session for TTL seconds — the same trust model as an
   * S3 presigned GET (Tech Spec §13.3: short expiry, opaque, never logged).
   *
   * Origin-relative path: resolves against whichever origin the client is
   * using — the sandbox gateway, a preview domain or the production API host.
   * Absolute URLs would break under any of the three.
   */
  signDownloadPath(objectKey: string, tenantId: string, ttlSeconds: number): string {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const payload = `${objectKey}|${tenantId}|${expiresAt}`;
    const sig = createHmac('sha256', this.signingKey).update(payload).digest('base64url');
    const token = Buffer.from(payload, 'utf8').toString('base64url');
    return `/api/v1/files/download/${token}?sig=${sig}`;
  }

  /** Verify a signed download token. Returns null when invalid/expired. */
  verifyDownloadToken(token: string, sig: string): { objectKey: string; tenantId: string } | null {
    try {
      const payload = Buffer.from(token, 'base64url').toString('utf8');
      const expected = createHmac('sha256', this.signingKey).update(payload).digest('base64url');
      if (expected !== sig) return null;
      const [objectKey, tenantId, expiresAt] = payload.split('|');
      if (!objectKey || !tenantId || Number(expiresAt) < Date.now()) return null;
      return { objectKey, tenantId };
    } catch {
      return null;
    }
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
