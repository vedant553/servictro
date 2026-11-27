import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { ContractsService } from './contracts.service';
import { CreateContractDto, RenewContractDto, UpdateContractDto } from './dto/contracts.dto';

class ContractIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('contracts')
@ApiBearerAuth()
@Controller('service-contracts')
@RequirePermissions('contracts:read')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @ApiOperation({ summary: 'Warranty/AMC register (filter by customer/type/status/renewal)' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('customerId') customerId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('renewalStatus') renewalStatus?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contracts.list(ctx, { customerId, type, status, renewalStatus, cursor, limit });
  }

  @Get('renewals')
  @ApiOperation({ summary: 'Contracts expiring within a horizon (default 90 days)' })
  async renewals(@CurrentTenant() ctx: TenantContext, @Query('days') days?: string) {
    const d = days && Number(days) > 0 && Number(days) <= 365 ? Number(days) : 90;
    return this.contracts.expiringSoon(ctx, d);
  }

  @Post()
  @RequirePermissions('contracts:manage')
  @ApiOperation({ summary: 'Create a warranty/AMC contract with covered assets' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateContractDto) {
    return this.contracts.create(ctx, dto as unknown as Record<string, unknown>);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Contract detail with coverage and plans' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: ContractIdDto) {
    return this.contracts.get(ctx, params.id);
  }

  @Patch(':id')
  @RequirePermissions('contracts:manage')
  @ApiOperation({ summary: 'Update contract status/renewal fields' })
  async update(@CurrentTenant() ctx: TenantContext, @Param() params: ContractIdDto, @Body() dto: UpdateContractDto) {
    return this.contracts.update(ctx, params.id, dto as Record<string, unknown>);
  }

  @Post(':id/renew')
  @RequirePermissions('contracts:manage')
  @ApiOperation({ summary: 'Renew: preserves the old term, creates the new one' })
  async renew(@CurrentTenant() ctx: TenantContext, @Param() params: ContractIdDto, @Body() dto: RenewContractDto) {
    return this.contracts.renew(ctx, params.id, dto);
  }
}
