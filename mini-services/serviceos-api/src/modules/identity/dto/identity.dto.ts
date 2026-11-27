import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES } from '@serviceos/contracts';

export class InviteDto {
  @ApiProperty({ example: 'rahul.mehta@gridnova-systems.example' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES as unknown as string[])
  role!: string;

  @ApiPropertyOptional({ example: 'Senior Service Engineer' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class UpdateMembershipDto {
  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES as unknown as string[])
  role?: string;

  @ApiPropertyOptional({ enum: ['active', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: string;

  @ApiPropertyOptional({ example: 'LT panels, HT switchgear, VCB' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  skills?: string;
}

export class MembershipParams {
  @IsUUID('all')
  userId!: string;
}
