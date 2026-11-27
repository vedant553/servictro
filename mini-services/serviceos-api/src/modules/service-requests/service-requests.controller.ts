import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { ServiceRequestsService } from './service-requests.service';
import {
  AcceptRequestDto, CreateServiceRequestDto, RejectRequestDto, TriageRequestDto,
} from './dto/service-requests.dto';

class RequestIdDto {
  @IsUUID('all')
  id!: string;
}

class RequestInformationDto {
  note!: string;
}

@ApiTags('service-requests')
@ApiBearerAuth()
@Controller('service-requests')
@RequirePermissions('requests:read')
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'Request inbox (status/severity/customer/asset filters)' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('customerId') customerId?: string,
    @Query('assetId') assetId?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.requests.list(ctx, { status, severity, customerId, assetId, search, cursor, limit });
  }

  @Post()
  @RequirePermissions('requests:write')
  @ApiOperation({ summary: 'Register a complaint (Workflow B)' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateServiceRequestDto) {
    return this.requests.create(ctx, dto as unknown as Record<string, unknown>);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Request detail with entitlement, duplicates and linked work orders' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: RequestIdDto) {
    return this.requests.get(ctx, params.id);
  }

  @Post(':id/triage')
  @RequirePermissions('requests:triage')
  @ApiOperation({ summary: 'Triage: adjust severity/category, mark reviewed' })
  async triage(@CurrentTenant() ctx: TenantContext, @Param() params: RequestIdDto, @Body() dto: TriageRequestDto) {
    return this.requests.triage(ctx, params.id, dto);
  }

  @Post(':id/accept')
  @RequirePermissions('requests:triage')
  @ApiOperation({ summary: 'Accept the request for service action' })
  async accept(@CurrentTenant() ctx: TenantContext, @Param() params: RequestIdDto, @Body() dto: AcceptRequestDto) {
    return this.requests.accept(ctx, params.id, dto.note);
  }

  @Post(':id/request-information')
  @RequirePermissions('requests:triage')
  @ApiOperation({ summary: 'Mark awaiting customer information' })
  async requestInformation(
    @CurrentTenant() ctx: TenantContext,
    @Param() params: RequestIdDto,
    @Body() dto: RequestInformationDto,
  ) {
    return this.requests.requestInformation(ctx, params.id, dto.note);
  }

  @Post(':id/reject')
  @RequirePermissions('requests:triage')
  @ApiOperation({ summary: 'Reject with mandatory reason' })
  async reject(@CurrentTenant() ctx: TenantContext, @Param() params: RequestIdDto, @Body() dto: RejectRequestDto) {
    return this.requests.reject(ctx, params.id, dto.reason);
  }

  @Patch(':id/close')
  @RequirePermissions('requests:triage')
  @ApiOperation({ summary: 'Close the request' })
  async close(@CurrentTenant() ctx: TenantContext, @Param() params: RequestIdDto) {
    return this.requests.close(ctx, params.id);
  }
}
