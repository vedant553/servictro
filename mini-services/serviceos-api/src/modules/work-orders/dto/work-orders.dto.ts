import {
  IsArray, IsIn, IsISO8601, IsNumber, IsObject, IsOptional, IsString, IsUUID, Min, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PRIORITIES, SEVERITIES, WORK_ORDER_TYPES, CHECKLIST_OUTCOMES, ACKNOWLEDGEMENT_METHODS } from '@serviceos/contracts';

export class CreateWorkOrderDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Originating service request (optional for direct creation)' })
  @IsOptional()
  @IsUUID('all')
  requestId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  customerId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  siteId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  assetId?: string;

  @ApiProperty({ example: 'Feeder 3 trip — investigate and rectify' })
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ example: 'Customer reports repeated trips; check relay settings and feeder insulation.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiProperty({ enum: WORK_ORDER_TYPES })
  @IsIn(WORK_ORDER_TYPES as unknown as string[])
  type!: string;

  @ApiProperty({ enum: PRIORITIES })
  @IsIn(PRIORITIES as unknown as string[])
  priority!: string;

  @ApiPropertyOptional({ enum: SEVERITIES, description: 'Defaults from the originating request' })
  @IsOptional()
  @IsIn(SEVERITIES as unknown as string[])
  severity?: string;

  @ApiPropertyOptional({ example: '2026-11-02T05:30:00Z' })
  @IsOptional()
  @IsISO8601()
  scheduledStartAt?: string;

  @ApiPropertyOptional({ example: '2026-11-02T09:30:00Z' })
  @IsOptional()
  @IsISO8601()
  scheduledEndAt?: string;

  @ApiPropertyOptional({ example: ['LT panels', 'ACB'], description: 'Required technician skills' })
  @IsOptional()
  @IsArray()
  requiredSkills?: string[];

  @ApiPropertyOptional({ format: 'uuid', description: 'Checklist template to snapshot' })
  @IsOptional()
  @IsUUID('all')
  checklistTemplateId?: string;
}

export class ConvertRequestDto {
  @ApiProperty({ enum: WORK_ORDER_TYPES })
  @IsIn(WORK_ORDER_TYPES as unknown as string[])
  type!: string;

  @ApiProperty({ enum: PRIORITIES })
  @IsIn(PRIORITIES as unknown as string[])
  priority!: string;

  @ApiPropertyOptional({ example: 'Investigate repeated feeder trips; carry relay test kit.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  scopeNote?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  checklistTemplateId?: string;

  @ApiPropertyOptional({ description: 'Override entitlement recommendation with a reason (SR-02)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverageOverrideReason?: string;
}

export class AssignTechnicianDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the technician' })
  @IsUUID('all')
  userId!: string;

  @ApiPropertyOptional({ example: 'lead', description: 'technician | lead' })
  @IsOptional()
  @IsIn(['technician', 'lead'])
  assignmentRole?: string;
}

export class TransitionDto {
  @ApiProperty({ enum: ['ready', 'scheduled', 'in_progress', 'on_hold', 'pending_review', 'completed', 'closed', 'cancelled'] })
  @IsIn(['ready', 'scheduled', 'in_progress', 'on_hold', 'pending_review', 'completed', 'closed', 'cancelled'])
  toStatus!: string;

  @ApiPropertyOptional({ description: 'Mandatory for cancellation; recorded for overrides' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'Optimistic concurrency: current work order version' })
  @IsOptional()
  expectedVersion?: number;
}

export class ChecklistResultItemDto {
  @ApiProperty({ example: 'busbar_temp_c' })
  @IsString()
  itemKey!: string;

  @ApiProperty({ enum: CHECKLIST_OUTCOMES })
  @IsIn(CHECKLIST_OUTCOMES as unknown as string[])
  outcome!: string;

  @ApiPropertyOptional({ description: 'Measured value for measurement items' })
  @IsOptional()
  @IsNumber()
  value?: number;

  @ApiPropertyOptional({ example: '°C' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Mandatory when outcome = exception (authorized skip)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  exceptionReason?: string;
}

export class SaveChecklistDto {
  @ApiProperty({ type: [ChecklistResultItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistResultItemDto)
  items!: ChecklistResultItemDto[];
}

export class MeasurementDto {
  @ApiProperty({ example: 'insulation_resistance_mohm' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  measurementKey!: string;

  @ApiProperty({ example: 550 })
  @IsNumber()
  measuredValue!: number;

  @ApiProperty({ example: 'MΩ' })
  @IsString()
  @MaxLength(20)
  unit!: string;

  @ApiPropertyOptional({ example: 'L-N' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phase?: string;

  @ApiPropertyOptional({ example: 'MEGGER MIT530' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  instrumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  calibrationReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ObservationDto {
  @ApiProperty({ example: 'Discoloured lug on feeder 3 — replaced and torqued.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({ enum: ['observation', 'finding', 'action', 'note'] })
  @IsOptional()
  @IsIn(['observation', 'finding', 'action', 'note'])
  kind?: string;
}

export class PartUsageDto {
  @ApiProperty({ example: 'ACB-TRIP-COIL-415' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  partCode!: string;

  @ApiPropertyOptional({ example: 'ACB trip coil 415V' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional({ example: 'nos' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: 'BATCH-2026-08' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  serialOrBatch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AcknowledgementDto {
  @ApiProperty({ example: 'Anil Deshmukh' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  acknowledgedByName!: string;

  @ApiPropertyOptional({ example: 'Maintenance Manager' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  acknowledgedByRole?: string;

  @ApiProperty({ enum: ACKNOWLEDGEMENT_METHODS })
  @IsIn(ACKNOWLEDGEMENT_METHODS as unknown as string[])
  method!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Signature image attachment' })
  @IsOptional()
  @IsUUID('all')
  signatureAttachmentId?: string;

  @ApiPropertyOptional({ description: 'Mandatory when method = not_signed' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notSignedReason?: string;
}

export class CompleteWorkDto {
  @ApiProperty({ example: 'Found loose lug on feeder 3; replaced, torqued and tested. Feeder healthy on load.' })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  completionSummary!: string;
}

export class UpdateWorkOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES as unknown as string[])
  priority?: string;

  @ApiPropertyOptional({ example: '2026-11-02T05:30:00Z' })
  @IsOptional()
  @IsISO8601()
  scheduledStartAt?: string;

  @ApiPropertyOptional({ example: '2026-11-02T09:30:00Z' })
  @IsOptional()
  @IsISO8601()
  scheduledEndAt?: string;

  @ApiPropertyOptional({ example: ['LT panels', 'ACB'] })
  @IsOptional()
  @IsArray()
  requiredSkills?: string[];

  @ApiPropertyOptional({ description: 'Optimistic concurrency check' })
  @IsOptional()
  expectedVersion?: number;
}

export { IsObject };
