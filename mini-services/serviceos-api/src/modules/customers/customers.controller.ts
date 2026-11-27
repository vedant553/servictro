import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentTenant, type TenantContext } from '../../common/tenant/tenant-context';
import { RequirePermissions } from '../../common/auth/require-permissions.decorator';
import { CustomersService } from './customers.service';
import { CreateContactDto, CreateCustomerDto, UpdateCustomerDto } from './dto/customers.dto';

class CustomerIdDto {
  @IsUUID('all')
  id!: string;
}

class ContactIdDto {
  @IsUUID('all')
  id!: string;
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@RequirePermissions('customers:read')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers (search, filter, cursor pagination)' })
  async list(
    @CurrentTenant() ctx: TenantContext,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    return this.customers.list(ctx, { search, status, cursor, limit, sort });
  }

  @Get('duplicates')
  @ApiOperation({ summary: 'Likely duplicates for a prospective customer name' })
  async duplicates(@CurrentTenant() ctx: TenantContext, @Query('legalName') legalName: string) {
    return this.customers.duplicates(ctx, legalName);
  }

  @Post()
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Create a customer account' })
  async create(@CurrentTenant() ctx: TenantContext, @Body() dto: CreateCustomerDto) {
    return this.customers.create(ctx, dto as unknown as Record<string, unknown>);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer with contacts, sites and counts' })
  async get(@CurrentTenant() ctx: TenantContext, @Param() params: CustomerIdDto) {
    return this.customers.get(ctx, params.id);
  }

  @Patch(':id')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Update customer (optimistic concurrency)' })
  async update(@CurrentTenant() ctx: TenantContext, @Param() params: CustomerIdDto, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(ctx, params.id, dto as unknown as Record<string, unknown>);
  }

  @Delete(':id')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Archive a customer (soft delete)' })
  async archive(@CurrentTenant() ctx: TenantContext, @Param() params: CustomerIdDto) {
    return this.customers.softDelete(ctx, params.id);
  }

  @Post(':id/contacts')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Add a customer contact' })
  async createContact(
    @CurrentTenant() ctx: TenantContext,
    @Param() params: CustomerIdDto,
    @Body() dto: CreateContactDto,
  ) {
    return this.customers.createContact(ctx, params.id, dto as unknown as Record<string, unknown>);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions('customers:write')
  @ApiOperation({ summary: 'Remove a customer contact' })
  async deleteContact(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') customerId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.customers.deleteContact(ctx, customerId, contactId);
  }
}
