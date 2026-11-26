import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'priya.sharma@gridnova-systems.example' })
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 10, example: 'NotARealPassword1!' })
  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Priya Sharma' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ example: 'GridNova Systems Pvt. Ltd.', description: 'Organization to create (ignored when invitationToken is present)' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  organizationName!: string;

  @ApiPropertyOptional({ description: 'Invitation token when joining an existing organization' })
  @IsOptional()
  @IsString()
  invitationToken?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'priya.sharma@gridnova-systems.example' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'NotARealPassword1!' })
  @IsString()
  password!: string;
}

export class SwitchTenantDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  tenantId!: string;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  invitationToken!: string;
}
