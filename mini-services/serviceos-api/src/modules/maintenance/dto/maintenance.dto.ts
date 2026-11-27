import { IsArray, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ASSET_FAMILIES, RECURRENCE_FREQUENCIES } from '@serviceos/contracts';

export class PlanAssetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  assetId!: string;
}

export class CreatePlanDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Linked AMC contract' })
  @IsOptional()
  @IsUUID('all')
  contractId?: string;

  @ApiProperty({ example: 'PM-SHAKTI-Q' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  planCode!: string;

  @ApiProperty({ example: 'Shakti Pune — quarterly LT panel PM' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: ASSET_FAMILIES })
  @IsIn(ASSET_FAMILIES as unknown as string[])
  assetFamily!: string;

  @ApiProperty({
    description: 'Recurrence rule',
    example: { frequency: 'quarter', interval: 1 },
  })
  @IsObject()
  recurrence!: Record<string, unknown>;

  @ApiProperty({ example: '2026-04-01' })
  @IsISO8601()
  startDate!: string;

  @ApiPropertyOptional({ example: '2029-03-31' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({ example: 90, description: 'Generation horizon in days' })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  horizonDays?: number;

  @ApiPropertyOptional({ example: 14, description: 'Lead window for draft work orders' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  leadDays?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Checklist template to snapshot on generated work orders' })
  @IsOptional()
  @IsUUID('all')
  checklistTemplateId?: string;

  @ApiProperty({ type: [PlanAssetDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanAssetDto)
  assets!: PlanAssetDto[];
}

export class UpdatePlanDto {
  @ApiPropertyOptional({ enum: ['draft', 'active', 'paused', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'active', 'paused', 'archived'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  horizonDays?: number;

  @ApiPropertyOptional({ description: 'Optimistic concurrency check' })
  @IsOptional()
  expectedVersion?: number;
}

export const RECURRENCE_FREQUENCIES_LIST = RECURRENCE_FREQUENCIES;
