import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UpdateTenantDto } from './dto/tenants.dto';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @ApiOperation({ summary: 'Organizations I belong to' })
  async list(@CurrentTenant() ctx: TenantContext) {
    return this.tenants.listForUser(ctx.user.id);
  }

  @Get('current')
  @ApiOperation({ summary: 'Active organization profile + settings' })
  async current(@CurrentTenant() ctx: TenantContext) {
    return this.tenants.getCurrent(ctx);
  }

  @Patch('current')
  @RequirePermissions('tenant:manage')
  @ApiOperation({ summary: 'Update active organization profile' })
  async update(@CurrentTenant() ctx: TenantContext, @Body() dto: UpdateTenantDto) {
    return this.tenants.updateCurrent(ctx, dto as Record<string, string>);
  }

  @Post()
  @ApiOperation({ summary: 'Create an additional organization (creator becomes owner)' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateTenantDto) {
    return this.tenants.createAdditional(ctx, dto);
  }
}
