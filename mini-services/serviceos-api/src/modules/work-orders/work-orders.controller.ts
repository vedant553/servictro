import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { WorkOrdersService } from './work-orders.service';
import { FieldExecutionService } from './field-execution.service';
import { ReportsService } from './reports.service';
import {
  AcknowledgementDto, AssignTechnicianDto, CompleteWorkDto, ConvertRequestDto,
  CreateWorkOrderDto, MeasurementDto, ObservationDto, PartUsageDto, SaveChecklistDto, TransitionDto,
  UpdateWorkOrderDto,
} from './dto/work-orders.dto';

class WorkOrderIdDto {
  @IsUUID('all')
  id!: string;
}

class ReportIdDto {
  @IsUUID('all')
  id!: string;
}

class RequestIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('work-orders')
@ApiBearerAuth()
@Controller('work-orders')
@RequirePermissions('work_orders:read')
export class WorkOrdersController {
  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly fieldExecution: FieldExecutionService,
    private readonly reports: ReportsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Work order list — technicians automatically see only their own jobs' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('siteId') siteId?: string,
    @Query('assetId') assetId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('overdue') overdue?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workOrders.list(ctx, { status, customerId, siteId, assetId, assignedTo, overdue, search, cursor, limit });
  }

  @Get('my')
  @ApiOperation({ summary: 'My assigned jobs (technician job pack view)' })
  async myJobs(
    @CurrentTenant() ctx: TenantContext,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workOrders.myJobs(ctx, { status, cursor, limit });
  }

  @Post()
  @RequirePermissions('work_orders:write')
  @ApiOperation({ summary: 'Create a work order directly' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateWorkOrderDto) {
    return this.workOrders.create(ctx, dto as unknown as Record<string, unknown>);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Work order detail — full execution state' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto) {
    return this.workOrders.get(ctx, params.id);
  }

  @Patch(':id')
  @RequirePermissions('work_orders:write')
  @ApiOperation({ summary: 'Update schedule window / scope of an open work order' })
  async update(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: UpdateWorkOrderDto) {
    return this.workOrders.updateOpen(ctx, params.id, dto as unknown as Record<string, unknown>);
  }

  @Post(':id/assignments')
  @RequirePermissions('work_orders:assign')
  @ApiOperation({ summary: 'Assign a technician (Workflow C)' })
  async assign(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: AssignTechnicianDto) {
    return this.workOrders.assign(ctx, params.id, dto);
  }

  @Post(':id/transitions')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({
    summary: 'State transition with server-side guards (checklist completeness, approvals, reasons)',
  })
  async transition(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: TransitionDto) {
    return this.workOrders.transition(ctx, params.id, dto);
  }

  @Post(':id/checklist')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({ summary: 'Save checklist results (measurement validation, authorized exceptions)' })
  async saveChecklist(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: SaveChecklistDto) {
    return this.fieldExecution.saveChecklist(ctx, params.id, dto.items);
  }

  @Post(':id/measurements')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({ summary: 'Record a typed measurement' })
  async addMeasurement(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: MeasurementDto) {
    return this.fieldExecution.addMeasurement(ctx, params.id, dto);
  }

  @Post(':id/observations')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({ summary: 'Add a technician observation/finding/action' })
  async addObservation(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: ObservationDto) {
    return this.fieldExecution.addObservation(ctx, params.id, dto);
  }

  @Post(':id/parts')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({ summary: 'Record spare parts used' })
  async addParts(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: PartUsageDto) {
    return this.fieldExecution.addPartsUsage(ctx, params.id, dto);
  }

  @Post(':id/completion')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({ summary: 'Record the work performed summary' })
  async complete(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: CompleteWorkDto) {
    return this.fieldExecution.recordCompletionSummary(ctx, params.id, dto.completionSummary);
  }

  @Post(':id/acknowledgement')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({ summary: 'Capture customer acknowledgement (not a safety certificate)' })
  async acknowledge(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto, @Body() dto: AcknowledgementDto) {
    return this.fieldExecution.captureAcknowledgement(ctx, params.id, dto);
  }

  @Post(':id/service-reports')
  @RequirePermissions('work_orders:execute')
  @ApiOperation({ summary: 'Generate the versioned service report PDF' })
  async generateReport(@CurrentTenant() ctx: TenantContext, @Param() params: WorkOrderIdDto) {
    return this.reports.generate(ctx, params.id);
  }

  @Post('reports/:id/approve')
  @RequirePermissions('work_orders:review')
  @ApiOperation({ summary: 'Reviewer approval of the report' })
  async approveReport(@CurrentTenant() ctx: TenantContext, @Param() params: ReportIdDto) {
    return this.reports.approve(ctx, params.id);
  }

  @Post('reports/:id/publish')
  @RequirePermissions('reports:publish')
  @ApiOperation({ summary: 'Publish the report (immutable, download link available)' })
  async publishReport(@CurrentTenant() ctx: TenantContext, @Param() params: ReportIdDto) {
    return this.reports.publish(ctx, params.id);
  }
}

@ApiTags('service-requests')
@ApiBearerAuth()
@Controller('service-requests')
@RequirePermissions('requests:convert')
export class RequestConversionController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post(':id/convert')
  @ApiOperation({ summary: 'Convert an accepted request into a work order (single transaction)' })
  async convert(@CurrentTenant() ctx: TenantContext, @Param() params: RequestIdDto, @Body() dto: ConvertRequestDto) {
    return this.workOrders.convertRequest(ctx, params.id, dto as unknown as Record<string, unknown>);
  }
}
