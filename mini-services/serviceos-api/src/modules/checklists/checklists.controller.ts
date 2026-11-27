import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { ChecklistsService } from './checklists.service';
import { CreateTemplateDto, CreateTemplateVersionDto, UpdateTemplateStatusDto } from './dto/checklists.dto';

class TemplateIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('checklists')
@ApiBearerAuth()
@Controller('checklist-templates')
@RequirePermissions('checklists:read')
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get()
  @ApiOperation({ summary: 'List active checklist templates' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('family') family?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.checklists.list(ctx, { family, cursor, limit });
  }

  @Post()
  @RequirePermissions('checklists:manage')
  @ApiOperation({ summary: 'Create a template with its first immutable version' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateTemplateDto) {
    return this.checklists.create(ctx, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Template with all versions (newest first)' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: TemplateIdDto) {
    return this.checklists.get(ctx, params.id);
  }

  @Post(':id/versions')
  @RequirePermissions('checklists:manage')
  @ApiOperation({ summary: 'Append a new immutable definition version' })
  async createVersion(
    @CurrentTenant() ctx: TenantContext,
    @Param() params: TemplateIdDto,
    @Body() dto: CreateTemplateVersionDto,
  ) {
    return this.checklists.createVersion(ctx, params.id, dto.definition);
  }

  @Patch(':id')
  @RequirePermissions('checklists:manage')
  @ApiOperation({ summary: 'Archive a template' })
  async archive(
    @CurrentTenant() ctx: TenantContext,
    @Param() params: TemplateIdDto,
    @Body() _dto: UpdateTemplateStatusDto,
  ) {
    return this.checklists.archive(ctx, params.id);
  }
}
