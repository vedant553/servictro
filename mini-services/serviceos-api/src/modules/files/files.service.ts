import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { TenantDbService, type TenantTx } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { LocalDiskStorageAdapter } from '../../common/storage/local-storage.adapter';
import { STORAGE_PORT, MALWARE_SCANNER } from '../../common/storage/storage.module';
import type { StoragePort } from '../../common/storage/storage.port';
import type { MalwareScannerPort } from '../../common/storage/malware-scanner';
import { tenantObjectKey } from '../../common/storage/object-key';
import { EnvToken, Defaults, type Env } from '../../common/config/env';
import type { TenantContext } from '../../common/tenant/tenant-context';
import type { Attachment } from '@prisma/client';

/**
 * File pipeline (Tech Spec §13.2): authorization (role + OBJECT level) →
 * size/MIME validation from file BYTES (never the browser extension) →
 * malware scan (fail-closed) → checksum → opaque tenant-namespaced key →
 * attachment metadata → short-lived signed download URL after authorization.
 *
 * Object-level authorization (audit SEC-04) — a files:read permission alone
 * never grants access to an arbitrary attachment id within the tenant:
 *   - technician: only own uploads, or attachments owned by a work order /
 *     service report of a work order they are actively assigned to;
 *   - other roles (owner/admin/service_manager/coordinator/contract_admin/
 *     auditor): tenant-wide read access, matching their operational scope.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly local: LocalDiskStorageAdapter,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScannerPort,
    @Inject(EnvToken) private readonly env: Env,
  ) {}

  async upload(
    ctx: TenantContext,
    file: { buffer: Buffer; size: number; originalname: string; mimetype: string },
    meta: { ownerType?: string; ownerId?: string },
  ) {
    const maxBytes = this.env.maxUploadMb * 1024 * 1024;
    if (!file || file.size === 0) throw new DomainError('FILE_EMPTY', 'Uploaded file is empty', 422);
    if (file.size > maxBytes) {
      throw new DomainError('FILE_TOO_LARGE', `File exceeds the ${this.env.maxUploadMb} MB limit`, 422);
    }
    const sniffed = sniffMime(file.buffer);
    const declared = file.mimetype;
    if (sniffed && sniffed !== declared) {
      throw new DomainError(
        'FILE_TYPE_MISMATCH',
        `File content does not match its declared type (detected ${sniffed})`,
        422,
      );
    }
    if (!(Defaults.allowedMimeTypes as readonly string[]).includes(declared)) {
      throw new DomainError('FILE_TYPE_NOT_ALLOWED', `Content type ${declared} is not allowed`, 422);
    }

    // Malware scan BEFORE anything is persisted (audit SEC-06). The pipeline
    // fails closed: scanner unavailability rejects the upload.
    const verdict = await this.scanner.scan(file.buffer, file.originalname);
    if (verdict.status === 'infected') {
      await this.auditRejection(ctx, 'file.rejected_malware', {
        signature: verdict.signature,
        contentType: declared,
        sizeBytes: file.size,
      });
      throw new DomainError(
        'FILE_INFECTED',
        `Uploaded file matched a malware signature (${verdict.signature}) and was rejected`,
        422,
      );
    }
    if (verdict.status === 'failed') {
      await this.auditRejection(ctx, 'file.scan_unavailable', {
        reason: verdict.reason.slice(0, 200),
        contentType: declared,
        sizeBytes: file.size,
      });
      throw new DomainError(
        'SCAN_UNAVAILABLE',
        'The malware scanner is unavailable — the upload was rejected (fail-closed). Retry shortly or contact support.',
        503,
      );
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const objectKey = tenantObjectKey(ctx.tenantId);
    await this.storage.put(objectKey, file.buffer, declared);

    // Sanitize the presented filename for storage metadata (never used in
    // Content-Disposition verbatim — Tech Spec §13.3).
    const safeName = sanitizeFilename(file.originalname);

    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          objectKey,
          originalName: safeName,
          contentType: declared,
          sizeBytes: BigInt(file.size),
          checksumSha256: checksum,
          // Scanned synchronously before persistence (see above).
          scanStatus: 'clean',
          status: 'available',
          ownerType: meta.ownerType ?? null,
          ownerId: meta.ownerId ?? null,
          uploadedById: ctx.user.id,
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'file.uploaded',
        resourceType: 'attachment',
        resourceId: attachment.id,
        requestId: ctx.requestId,
        metadata: { contentType: declared, sizeBytes: file.size, checksum },
      });
      return {
        id: attachment.id,
        originalName: attachment.originalName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        checksumSha256: attachment.checksumSha256,
        downloadUrl: await this.signedDownloadUrl(ctx.tenantId, objectKey),
      };
    });
  }

  /** Short-lived signed URL — only after object-level authorization passed. */
  async getDownloadUrl(ctx: TenantContext, attachmentId: string) {
    type Decision =
      | { kind: 'not_found' }
      | { kind: 'denied' }
      | { kind: 'ok'; objectKey: string };

    const decision = await this.tenantDb.run<Decision>(ctx.tenantId, async (tx) => {
      const attachment = await tx.attachment.findFirst({ where: { id: attachmentId, status: 'available' } });
      if (!attachment) return { kind: 'not_found' };
      const allowed = await this.authorizeRead(tx, ctx, attachment);
      if (!allowed) {
        // Audit the denial in the same transaction (committed — no throw here).
        await this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.user.id,
          action: 'file.download_denied',
          resourceType: 'attachment',
          resourceId: attachment.id,
          requestId: ctx.requestId,
          metadata: { ownerType: attachment.ownerType, reason: 'object_level_authorization' },
        });
        return { kind: 'denied' };
      }
      return { kind: 'ok', objectKey: attachment.objectKey };
    });

    if (decision.kind === 'not_found') throw Errors.notFound('File');
    if (decision.kind === 'denied') {
      throw new DomainError(
        'FILE_FORBIDDEN',
        'You do not have access to this file. Technicians can download files they uploaded or files attached to their assigned work orders.',
        403,
      );
    }
    return {
      downloadUrl: await this.signedDownloadUrl(ctx.tenantId, decision.objectKey),
      expiresIn: Defaults.signedUrlTtlSeconds,
    };
  }

  /**
   * Signed-download resolution (local driver). The HMAC token is the
   * authorization (same trust model as an S3 presigned URL) — but the
   * attachment must still be available AND scanned clean.
   */
  async resolveSignedDownload(token: string, sig: string) {
    const verified = this.local.verifyDownloadToken(token, sig);
    if (!verified) throw new DomainError('DOWNLOAD_URL_INVALID', 'Download link is invalid or expired', 401);
    const attachment = await this.tenantDb.run(verified.tenantId, (tx) =>
      tx.attachment.findFirst({ where: { objectKey: verified.objectKey, status: 'available' } }),
    );
    if (!attachment) throw Errors.notFound('File');
    if (attachment.scanStatus !== 'clean') {
      throw new DomainError('FILE_NOT_SCAN_CLEAN', 'This file has not passed malware scanning', 403);
    }
    return {
      stream: this.storage.openStream(verified.objectKey),
      contentType: attachment.contentType,
      originalName: attachment.originalName,
    };
  }

  /** Persist generated report PDFs inside the caller's tenant transaction. */
  async putGenerated(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    bytes: Buffer,
    contentType: string,
    baseName: string,
    ownerType: string,
    ownerId: string,
  ) {
    const objectKey = tenantObjectKey(tenantId);
    await this.storage.put(objectKey, bytes, contentType);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    return tx.attachment.create({
      data: {
        objectKey,
        originalName: baseName,
        contentType,
        sizeBytes: BigInt(bytes.length),
        checksumSha256: checksum,
        // Server-generated PDFs are trusted content (never user bytes).
        scanStatus: 'clean',
        status: 'available',
        ownerType,
        ownerId,
        uploadedById: userId,
      },
    });
  }

  async readObject(objectKey: string): Promise<Buffer> {
    return this.storage.read(objectKey);
  }

  // ---------------------------------------------------------------------------
  // Object-level authorization (audit SEC-04)
  // ---------------------------------------------------------------------------

  /** Authorization decision inside the tenant transaction (fresh assignment state). */
  private async authorizeRead(tx: TenantTx, ctx: TenantContext, attachment: Attachment): Promise<boolean> {
    if (ctx.role !== 'technician') return true; // operational roles: tenant-wide read
    if (attachment.uploadedById === ctx.user.id) return true; // own uploads
    switch (attachment.ownerType) {
      case 'work_order':
        return this.assignedToWorkOrder(tx, ctx, attachment.ownerId ?? '');
      case 'service_report': {
        const report = await tx.serviceReport.findFirst({
          where: { id: attachment.ownerId ?? '' },
          select: { workOrderId: true },
        });
        return report ? this.assignedToWorkOrder(tx, ctx, report.workOrderId) : false;
      }
      default:
        return false; // asset documents, drawings and unowned files: staff-only
    }
  }

  private async assignedToWorkOrder(tx: TenantTx, ctx: TenantContext, workOrderId: string): Promise<boolean> {
    if (!workOrderId) return false;
    const assignment = await tx.workOrderAssignment.findFirst({
      where: {
        workOrderId,
        userId: ctx.user.id,
        status: { in: ['offered', 'accepted', 'active'] },
      },
      select: { id: true },
    });
    return assignment !== null;
  }

  /** Audit a pre-persistence rejection (no attachment row exists yet). */
  private async auditRejection(
    ctx: TenantContext,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.tenantDb
      .run(ctx.tenantId, (tx) =>
        this.audit.record(tx, {
          tenantId: ctx.tenantId,
          actorUserId: ctx.user.id,
          action,
          resourceType: 'attachment',
          resourceId: randomUUID(), // synthetic id — no row was created
          requestId: ctx.requestId,
          metadata,
        }),
      )
      .catch(() => undefined); // audit failure must not mask the security error
  }

  /**
   * Signed download URL. Local driver: origin-relative HMAC path (the sandbox
   * gateway appends its port selector). S3 driver: presigned bucket URL.
   */
  private async signedDownloadUrl(tenantId: string, objectKey: string): Promise<string> {
    if (this.env.storageDriver === 's3') {
      return this.storage.signDownloadUrl(objectKey, Defaults.signedUrlTtlSeconds);
    }
    const path = this.local.signDownloadPath(objectKey, tenantId, Defaults.signedUrlTtlSeconds);
    // Gateway-routed deployments (sandbox) select the API port via a query
    // parameter; production URLs stay clean.
    return this.env.apiGatewayPort ? `${path}&XTransformPort=${this.env.apiGatewayPort}` : path;
  }
}

/** MIME sniffing from magic bytes — the browser extension is never trusted. */
export function sniffMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 4).toString('hex') === '25504446') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  const riff = buffer.subarray(0, 4).toString('ascii');
  const webp = buffer.subarray(8, 12).toString('ascii');
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  // Zip containers cover docx/xlsx — validated additionally by the
  // allowlisted declared type; polyglots are rejected by mismatch above.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'application/zip';
  return null;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 180) || 'file';
}
