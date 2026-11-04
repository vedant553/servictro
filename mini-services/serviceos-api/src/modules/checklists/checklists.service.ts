import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { Errors, DomainError } from '../../common/errors/domain.error';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import { ChecklistDefinitionSchema } from './domain/checklist-definition.schema';
import type { TenantContext } from '../../common/tenant/tenant-context';

/**
 * Versioned checklist templates (ADR-018). A template points at its
 * active_version; every version's definition is immutable after creation, so
 * work orders always reference the exact procedure they executed.
 */
@Injectable()
export class ChecklistsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: TenantContext, query: { family?: string; cursor?: string; limit?: string }) {
    const page = parsePageQuery(query);
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.checklistTemplate.findMany({
        where: {
          status: 'active',
          ...(query.family ? { assetFamily: query.family as never } : {}),
        },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      }),
    );
    return pageResult(
      rows.map((t) => ({
        id: t.id,
        templateKey: t.templateKey,
        name: t.name,
        assetFamily: t.assetFamily,
        activeVersion: t.activeVersion,
        status: t.status,
        itemCount: (t.versions[0]?.definition as { items?: unknown[] } | undefined)?.items?.length ?? 0,
        latestVersionId: t.versions[0]?.id ?? null,
      })),
      page.limit,
    );
  }

  async get(ctx: TenantContext, id: string) {
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const template = await tx.checklistTemplate.findFirst({
        where: { id },
        include: { versions: { orderBy: { version: 'desc' } } },
      });
      if (!template) throw Errors.notFound('Checklist template');
      return template;
    });
  }

  async create(ctx: TenantContext, dto: { templateKey: string; name: string; assetFamily: string; definition: Record<string, unknown> }) {
    const definition = this.validateDefinition(dto.definition);
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const clash = await tx.checklistTemplate.findFirst({ where: { templateKey: dto.templateKey } });
      if (clash) throw Errors.duplicate('template key');
      const template = await tx.checklistTemplate.create({
        data: {
          templateKey: dto.templateKey,
          name: dto.name,
          assetFamily: dto.assetFamily as never,
          activeVersion: 1,
        },
      });
      const version = await tx.checklistTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          definition: definition as Prisma.InputJsonValue,
          approvedById: ctx.user.id,
          approvedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'checklist_template.created',
        resourceType: 'checklist_template',
        resourceId: template.id,
        requestId: ctx.requestId,
        metadata: { templateKey: dto.templateKey, version: 1 },
      });
      return { ...template, versions: [version] };
    });
  }

  /** New immutable version; existing work orders keep their snapshot. */
  async createVersion(ctx: TenantContext, templateId: string, definitionInput: Record<string, unknown>) {
    const definition = this.validateDefinition(definitionInput);
    return this.tenantDb.run(ctx.tenantId, async (tx) => {
      const template = await tx.checklistTemplate.findFirst({ where: { id: templateId, status: 'active' } });
      if (!template) throw Errors.notFound('Checklist template');
      const version = await tx.checklistTemplateVersion.create({
        data: {
          templateId,
          version: template.activeVersion + 1,
          definition: definition as Prisma.InputJsonValue,
          approvedById: ctx.user.id,
          approvedAt: new Date(),
        },
      });
      await tx.checklistTemplate.update({ where: { id: templateId }, data: { activeVersion: version.version } });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'checklist_template.version_created',
        resourceType: 'checklist_template',
        resourceId: templateId,
        requestId: ctx.requestId,
        metadata: { version: version.version },
      });
      return version;
    });
  }

  async archive(ctx: TenantContext, templateId: string) {
    await this.tenantDb.run(ctx.tenantId, async (tx) => {
      const template = await tx.checklistTemplate.findFirst({ where: { id: templateId } });
      if (!template) throw Errors.notFound('Checklist template');
      await tx.checklistTemplate.update({ where: { id: templateId }, data: { status: 'archived' } });
      await this.audit.record(tx, {
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.id,
        action: 'checklist_template.archived',
        resourceType: 'checklist_template',
        resourceId: templateId,
        requestId: ctx.requestId,
      });
    });
    return { success: true };
  }

  private validateDefinition(input: Record<string, unknown>): Record<string, unknown> {
    const parsed = ChecklistDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      const details = parsed.error.issues.slice(0, 8).map((i) => ({
        field: i.path.join('.') || 'definition',
        reason: i.message,
      }));
      throw new DomainError('CHECKLIST_DEFINITION_INVALID', 'Checklist definition failed schema v1 validation', 422, details);
    }
    return parsed.data as Record<string, unknown>;
  }
}
