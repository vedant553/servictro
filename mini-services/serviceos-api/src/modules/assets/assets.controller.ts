import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { AssetsService } from './assets.service';
import { AssetDocumentLinkDto, CreateAssetDto, UpdateAssetDto } from './dto/assets.dto';

class AssetIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('assets')
@ApiBearerAuth()
@Controller('assets')
@RequirePermissions('assets:read')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @ApiOperation({ summary: 'Asset register — search by code/serial/manufacturer, filter by family/site/customer' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('search') search?: string,
    @Query('family') family?: string,
    @Query('siteId') siteId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.assets.list(ctx, { search, family, siteId, customerId, status, cursor, limit });
  }

  @Post()
  @RequirePermissions('assets:write')
  @ApiOperation({ summary: 'Register an installed asset (Workflow A)' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateAssetDto) {
    return this.assets.create(ctx, dto as unknown as Record<string, unknown>);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Asset identity, specs, documents, coverage, counts' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: AssetIdDto) {
    return this.assets.get(ctx, params.id);
  }

  @Patch(':id')
  @RequirePermissions('assets:write')
  @ApiOperation({ summary: 'Update asset (optimistic concurrency)' })
  async update(@CurrentTenant() ctx: TenantContext, @Param() params: AssetIdDto, @Body() dto: UpdateAssetDto) {
    return this.assets.update(ctx, params.id, dto as Record<string, unknown>);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Complete service history for the asset' })
  async timeline(@CurrentTenant() ctx: TenantContext, @Param() params: AssetIdDto) {
    return this.assets.timeline(ctx, params.id);
  }

  @Get(':id/qr')
  @RequirePermissions('assets:qr:print')
  @ApiOperation({ summary: 'QR code (SVG) + scan URL for the asset label' })
  async qr(@CurrentTenant() ctx: TenantContext, @Param() params: AssetIdDto) {
    return this.assets.qr(ctx, params.id);
  }

  @Post(':id/documents')
  @RequirePermissions('assets:write')
  @ApiOperation({ summary: 'Link an uploaded attachment as a typed asset document' })
  async linkDocument(
    @CurrentTenant() ctx: TenantContext,
    @Param() params: AssetIdDto,
    @Body() dto: AssetDocumentLinkDto,
  ) {
    return this.assets.linkDocument(ctx, params.id, dto);
  }
}
