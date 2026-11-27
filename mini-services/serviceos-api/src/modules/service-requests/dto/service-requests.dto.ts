import {
  IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REQUEST_CATEGORIES, REQUEST_SOURCES, SEVERITIES } from '@serviceos/contracts';

export class CreateServiceRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  siteId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Strongly encouraged — asset-first workflow' })
  @IsOptional()
  @IsUUID('all')
  assetId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Customer contact raising the complaint' })
  @IsOptional()
  @IsUUID('all')
  contactId?: string;

  @ApiProperty({ enum: REQUEST_SOURCES })
  @IsIn(REQUEST_SOURCES as unknown as string[])
  source!: string;

  @ApiProperty({ enum: REQUEST_CATEGORIES })
  @IsIn(REQUEST_CATEGORIES as unknown as string[])
  category!: string;

  @ApiProperty({ example: 'LT panel feeder tripping repeatedly' })
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ example: 'Customer reports repeated trip on feeder 3 since Monday; lights flicker before trip.' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ enum: SEVERITIES })
  @IsIn(SEVERITIES as unknown as string[])
  severity!: string;

  @ApiPropertyOptional({ example: '2026-11-02T05:30:00Z' })
  @IsOptional()
  @IsISO8601()
  preferredVisitAt?: string;
}

export class TriageRequestDto {
  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiPropertyOptional({ enum: REQUEST_CATEGORIES })
  @IsOptional()
  @IsIn(REQUEST_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ description: 'Duplicate-of request id, when linking duplicates' })
  @IsOptional()
  @IsUUID('all')
  duplicateOfId?: string;
}

export class RejectRequestDto {
  @ApiProperty({ example: 'Out of scope — contractor damage, not equipment fault' })
  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  reason!: string;
}

export class AcceptRequestDto {
  @ApiPropertyOptional({ example: 'Customer confirmed symptoms over call' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
