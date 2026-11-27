import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-events')
@RequirePermissions('audit:read')
export class AuditController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get()
  @ApiOperation({ summary: 'Append-only audit trail (filter by resource/actor/action)' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const page = parsePageQuery({ cursor, limit });
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      tx.auditEvent.findMany({
        where: {
          ...(resourceType ? { resourceType } : {}),
          ...(resourceId ? { resourceId } : {}),
          ...(actorUserId ? { actorUserId } : {}),
          ...(action ? { action } : {}),
        },
        orderBy: { occurredAt: 'desc' },
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      }),
    );
    return pageResult(rows, page.limit);
  }
}
