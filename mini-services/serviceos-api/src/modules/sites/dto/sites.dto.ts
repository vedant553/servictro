import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { AddressDto } from '../../customers/dto/customers.dto';

export class CreateSiteDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  customerId!: string;

  @ApiProperty({ example: 'SHAKTI-PUNE-01' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  siteCode!: string;

  @ApiProperty({ example: 'Bhosari Plant — Panel Room 2' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ example: '19.0035' })
  @IsOptional()
  @IsString()
  latitude?: string;

  @ApiPropertyOptional({ example: '73.7873' })
  @IsOptional()
  @IsString()
  longitude?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'Enter via Gate 3; PPE required; escort from maintenance office.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstructions?: string;
}

export class UpdateSiteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;

  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstructions?: string;

  @ApiPropertyOptional({ description: 'Optimistic concurrency check' })
  @IsOptional()
  expectedVersion?: number;
}
