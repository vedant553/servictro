import {
  IsArray, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CONTRACT_TYPES, COVERAGE_TYPES } from '@serviceos/contracts';

export class ContractAssetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  assetId!: string;

  @ApiProperty({ enum: COVERAGE_TYPES })
  @IsIn(COVERAGE_TYPES as unknown as string[])
  coverageType!: string;

  @ApiPropertyOptional({ example: 4, description: 'Included visits per year for this asset' })
  @IsOptional()
  @IsInt()
  @Min(0)
  includedVisits?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateContractDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  customerId!: string;

  @ApiPropertyOptional({ description: 'Defaults to auto-generated CTR-YYYY-NNNNNN' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  contractNo?: string;

  @ApiProperty({ enum: CONTRACT_TYPES })
  @IsIn(CONTRACT_TYPES as unknown as string[])
  contractType!: string;

  @ApiProperty({ example: '2026-04-01' })
  @IsISO8601()
  startDate!: string;

  @ApiProperty({ example: '2027-03-31' })
  @IsISO8601()
  endDate!: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsIn(['INR', 'USD', 'EUR', 'AED', 'GBP', 'SGD'])
  currencyCode?: string;

  @ApiPropertyOptional({ example: 1800000, description: 'Amount in minor units (paise)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountMinor?: number;

  @ApiPropertyOptional({ example: 240, description: 'Response SLA target in minutes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  responseTargetMinutes?: number;

  @ApiPropertyOptional({ example: 2880, description: 'Resolution SLA target in minutes' })
  @IsOptional()
  @IsInt()
  @Min(1)
  resolutionTargetMinutes?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(0)
  includedVisitsPerYear?: number;

  @ApiPropertyOptional({ description: 'Free-form terms: exclusions, inclusions…' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  terms?: string;

  @ApiProperty({ type: [ContractAssetDto], description: 'Covered assets' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractAssetDto)
  assets!: ContractAssetDto[];
}

export class RenewContractDto {
  @ApiProperty({ example: '2027-04-01' })
  @IsISO8601()
  startDate!: string;

  @ApiProperty({ example: '2028-03-31' })
  @IsISO8601()
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  amountMinor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class UpdateContractDto {
  @ApiPropertyOptional({ enum: ['draft', 'active', 'terminated'] })
  @IsOptional()
  @IsIn(['draft', 'active', 'terminated'])
  status?: string;

  @ApiPropertyOptional({ enum: ['not_due', 'due_soon', 'in_progress', 'renewed', 'lost'] })
  @IsOptional()
  @IsIn(['not_due', 'due_soon', 'in_progress', 'renewed', 'lost'])
  renewalStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  renewalNotes?: string;

  @ApiPropertyOptional({ description: 'Optimistic concurrency check' })
  @IsOptional()
  expectedVersion?: number;
}
