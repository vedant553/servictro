import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { MaintenanceService } from './maintenance.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/maintenance.dto';

class PlanIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller()
@RequirePermissions('maintenance:read')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('maintenance-plans')
  @ApiOperation({ summary: 'List maintenance plans' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.maintenance.list(ctx, { status, cursor, limit });
  }

  @Post('maintenance-plans')
  @RequirePermissions('maintenance:manage')
  @ApiOperation({ summary: 'Create a PM plan for a set of assets (Workflow D)' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreatePlanDto) {
    return this.maintenance.create(ctx, dto as unknown as Record<string, unknown>);
  }

  @Get('maintenance-plans/:id')
  @ApiOperation({ summary: 'Plan detail with assets and planned visits' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: PlanIdDto) {
    return this.maintenance.get(ctx, params.id);
  }

  @Patch('maintenance-plans/:id')
  @RequirePermissions('maintenance:manage')
  @ApiOperation({ summary: 'Update plan status/horizon' })
  async update(@CurrentTenant() ctx: TenantContext, @Param() params: PlanIdDto, @Body() dto: UpdatePlanDto) {
    return this.maintenance.update(ctx, params.id, dto as Record<string, unknown>);
  }

  @Post('maintenance-plans/:id/preview')
  @ApiOperation({ summary: 'Preview the visit dates generation would create' })
  async preview(@CurrentTenant() ctx: TenantContext, @Param() params: PlanIdDto) {
    return this.maintenance.preview(ctx, params.id);
  }

  @Post('maintenance-plans/:id/generate')
  @RequirePermissions('maintenance:manage')
  @ApiOperation({ summary: 'Generate planned visits now (idempotent)' })
  async generate(@CurrentTenant() ctx: TenantContext, @Param() params: PlanIdDto) {
    const created = await this.maintenance.generateVisits(
      { tenantId: ctx.tenantId, requestId: ctx.requestId, userId: ctx.user.id },
      params.id,
    );
    return { created };
  }

  @Get('planned-visits')
  @ApiOperation({ summary: 'Due/overdue PM visits queue' })
  async upcomingVisits(
    @CurrentTenant() ctx: TenantContext,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.maintenance.upcomingVisits(ctx, { status, cursor, limit });
  }
}
