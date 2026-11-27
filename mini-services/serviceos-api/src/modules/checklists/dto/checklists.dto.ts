import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASSET_FAMILIES } from '@serviceos/contracts';

export class CreateTemplateDto {
  @ApiProperty({ example: 'lt_panel_pm_v1', description: 'Stable lower_snake_case key' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  templateKey!: string;

  @ApiProperty({ example: 'LT Panel — Quarterly Preventive Maintenance' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ enum: ASSET_FAMILIES })
  @IsIn(ASSET_FAMILIES as unknown as string[])
  assetFamily!: string;

  @ApiProperty({
    description: 'Definition (schema v1): ordered items with type/required/unit/min/max. Immutable once saved.',
    example: {
      schemaVersion: 1,
      items: [
        { key: 'visual_inspection', label: 'Visual inspection of enclosure, gaskets, doors', type: 'check', required: true },
        { key: 'busbar_temp_c', label: 'Busbar temperature at full load', type: 'measurement', required: true, unit: '°C', maxValue: 90 },
        { key: 'insulation_resistance_mohm', label: 'Insulation resistance (IR) value', type: 'measurement', required: true, unit: 'MΩ', minValue: 1 },
      ],
    },
  })
  @IsObject()
  definition!: Record<string, unknown>;
}

export class CreateTemplateVersionDto {
  @ApiProperty({ description: 'New immutable definition version' })
  @IsObject()
  definition!: Record<string, unknown>;
}

export class UpdateTemplateStatusDto {
  @ApiPropertyOptional({ enum: ['active', 'archived'] })
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;
}
