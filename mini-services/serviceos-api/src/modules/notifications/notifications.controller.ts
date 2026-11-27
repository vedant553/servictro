import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/tenant/tenant-context';
import { TenantDbService } from '../../common/tenant/tenant-db.service';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { parsePageQuery, pageResult } from '../../common/pagination/pagination';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@RequirePermissions('notifications:read')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly tenantDb: TenantDbService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications (paginated)' })
  async list(
    @CurrentTenant() ctx: { tenantId: string; user: { id: string } },
    @Query('unread') unread?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const page = parsePageQuery({ cursor, limit });
    const rows = await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.notifications.listForUser(tx, ctx.tenantId, ctx.user.id, unread === 'true', page.limit, page.cursor),
    );
    return pageResult(rows, page.limit);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count my unread notifications' })
  async unreadCount(@CurrentTenant() ctx: { tenantId: string; user: { id: string } }) {
    const count = await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.notifications.unreadCount(tx, ctx.tenantId, ctx.user.id),
    );
    return { count };
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  async markRead(@CurrentTenant() ctx: { tenantId: string; user: { id: string } }, @Param('id') id: string) {
    const ok = await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.notifications.markRead(tx, ctx.tenantId, ctx.user.id, id),
    );
    return { success: ok };
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  async markAllRead(@CurrentTenant() ctx: { tenantId: string; user: { id: string } }) {
    const count = await this.tenantDb.run(ctx.tenantId, (tx) =>
      this.notifications.markAllRead(tx, ctx.tenantId, ctx.user.id),
    );
    return { marked: count };
  }
}
