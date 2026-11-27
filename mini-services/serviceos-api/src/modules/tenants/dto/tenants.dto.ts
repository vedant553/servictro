import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
const LOCALES = ['en-IN', 'en-US', 'en-GB'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'AED', 'GBP', 'SGD'];

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'GridNova Systems Pvt. Ltd.' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ example: 'GridNova Systems Private Limited' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @ApiPropertyOptional({ enum: TIMEZONES, description: 'IANA timezone name' })
  @IsOptional()
  @IsIn(TIMEZONES)
  timezone?: string;

  @ApiPropertyOptional({ enum: LOCALES })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: string;

  @ApiPropertyOptional({ example: 'INR', description: 'ISO-4217 currency code' })
  @IsOptional()
  @IsString()
  @IsIn(CURRENCIES)
  currencyCode?: string;
}

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsIn(TIMEZONES)
  timezone?: string;

  @IsOptional()
  @IsIn(LOCALES)
  locale?: string;

  @IsOptional()
  @IsIn(CURRENCIES)
  currencyCode?: string;
}
