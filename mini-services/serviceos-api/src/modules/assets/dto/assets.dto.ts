import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ASSET_FAMILIES, ASSET_STATUSES } from '@serviceos/contracts';

/**
 * The specification object is validated with zod (versioned JSONB boundary,
 * Tech Spec §11.4) inside the service; the DTO carries it as a loose object.
 */
export class CreateAssetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  siteId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Parent asset for hierarchy' })
  @IsOptional()
  @IsUUID('all')
  parentAssetId?: string;

  @ApiProperty({ example: 'AST-000123', description: 'Tenant-unique asset code (auto-generated when omitted)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  assetCode?: string;

  @ApiPropertyOptional({ example: 'SG-2024-PT-0789' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  serialNumber?: string;

  @ApiProperty({ enum: ASSET_FAMILIES })
  @IsIn(ASSET_FAMILIES as unknown as string[])
  assetFamily!: string;

  @ApiPropertyOptional({ example: 'GridNova Systems' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'ASG-415-LT-12F' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({ example: '2026-03-15', description: 'Commissioning date (YYYY-MM-DD)' })
  @IsOptional()
  @IsISO8601()
  commissioningDate?: string;

  @ApiPropertyOptional({
    description: 'Family-specific technical attributes (validated against schema v1)',
    example: {
      schemaVersion: 1,
      electrical: { ratedVoltageV: 415, phaseCount: 3, ratedCurrentA: 1600, shortCircuitWithstandKa: 50 },
      construction: { ipRating: 'IP54', busbarMaterial: 'copper', incomerType: 'ACB', outgoingFeederCount: 12 },
    },
  })
  @IsOptional()
  specification?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateAssetDto {
  @ApiPropertyOptional({ enum: ASSET_STATUSES })
  @IsOptional()
  @IsIn(ASSET_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  serialNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  manufacturer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({ example: '2026-03-15' })
  @IsOptional()
  @IsISO8601()
  commissioningDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  specification?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Optimistic concurrency check' })
  @IsOptional()
  expectedVersion?: number;
}

export class AssetDocumentLinkDto {
  @ApiProperty({ format: 'uuid', description: 'Uploaded attachment id' })
  @IsUUID('all')
  attachmentId!: string;

  @ApiProperty({ enum: ['single_line_diagram', 'ga_drawing', 'test_certificate', 'om_manual', 'commissioning_report', 'warranty_certificate', 'nameplate_photo', 'other'] })
  @IsString()
  documentType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Rev C' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  revision?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export { ValidateNested };
