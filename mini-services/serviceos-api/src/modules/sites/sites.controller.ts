import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { SitesService } from './sites.service';
import { CreateSiteDto, UpdateSiteDto } from './dto/sites.dto';

class SiteIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('sites')
@ApiBearerAuth()
@Controller('sites')
@RequirePermissions('sites:read')
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @ApiOperation({ summary: 'List sites (filter by customer, search)' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sites.list(ctx, { customerId, search, cursor, limit });
  }

  @Post()
  @RequirePermissions('sites:write')
  @ApiOperation({ summary: 'Create a site under a customer' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateSiteDto) {
    return this.sites.create(ctx, dto as unknown as Record<string, unknown>);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Site profile with its assets' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: SiteIdDto) {
    return this.sites.get(ctx, params.id);
  }

  @Patch(':id')
  @RequirePermissions('sites:write')
  @ApiOperation({ summary: 'Update site (optimistic concurrency)' })
  async update(@CurrentTenant() ctx: TenantContext, @Param() params: SiteIdDto, @Body() dto: UpdateSiteDto) {
    return this.sites.update(ctx, params.id, dto as Record<string, unknown>);
  }
}
