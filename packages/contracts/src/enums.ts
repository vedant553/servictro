/**
 * ServiceOS shared contracts — API-safe enums and types only.
 * Consumed by the web console and the NestJS API. Never import server-only
 * code here (Tech Spec §5: share contracts, not backend entities).
 */

// ---------------------------------------------------------------------------
// Identity & tenancy
// ---------------------------------------------------------------------------

export const TENANT_STATUSES = ['active', 'suspended', 'closed'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'revoked'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const ROLES = [
  'owner',
  'admin',
  'service_manager',
  'coordinator',
  'technician',
  'contract_admin',
  'auditor',
] as const;
export type Role = (typeof ROLES)[number];

// ---------------------------------------------------------------------------
// CRM / assets
// ---------------------------------------------------------------------------

export const CUSTOMER_STATUSES = ['active', 'inactive', 'archived'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const SITE_STATUSES = ['active', 'inactive'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

/** First-release asset families (electrical OEM wedge — Blueprint §3). */
export const ASSET_FAMILIES = [
  'lt_panel',
  'ht_switchgear',
  'vcb_panel',
  'rmu',
  'pcc',
  'mcc',
  'apfc',
  'busduct',
  'transformer',
  'other',
] as const;
export type AssetFamily = (typeof ASSET_FAMILIES)[number];

export const ASSET_STATUSES = ['active', 'inactive', 'decommissioned'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_DOCUMENT_TYPES = [
  'single_line_diagram',
  'ga_drawing',
  'test_certificate',
  'om_manual',
  'commissioning_report',
  'warranty_certificate',
  'nameplate_photo',
  'other',
] as const;
export type AssetDocumentType = (typeof ASSET_DOCUMENT_TYPES)[number];

/** Versioned JSONB payload validated at the API boundary (Tech Spec §11.4). */
export interface AssetSpecification {
  schemaVersion: number;
  electrical?: {
    ratedVoltageV?: number;
    phaseCount?: number;
    ratedFrequencyHz?: number;
    ratedCurrentA?: number;
    shortCircuitWithstandKa?: number;
    insulationMedium?: string;
    breakingCapacityKa?: number;
    voltageClassKv?: number;
  };
  construction?: {
    ipRating?: string;
    busbarMaterial?: 'copper' | 'aluminium' | string;
    incomerType?: string;
    outgoingFeederCount?: number;
    enclosureForm?: string;
  };
  documentation?: {
    drawingRevision?: string;
  };
  notes?: string;
}

// ---------------------------------------------------------------------------
// Service desk
// ---------------------------------------------------------------------------

export const REQUEST_SOURCES = ['phone', 'email', 'portal', 'whatsapp', 'walk_in', 'internal'] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const REQUEST_STATUSES = [
  'new',
  'triaged',
  'accepted',
  'needs_information',
  'converted',
  'rejected',
  'closed',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_CATEGORIES = [
  'breakdown',
  'tripping',
  'overheating',
  'abnormal_sound',
  'preventive_visit',
  'inspection',
  'retrofit',
  'spares',
  'documentation',
  'other',
] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Work management
// ---------------------------------------------------------------------------

export const WORK_ORDER_TYPES = [
  'breakdown',
  'preventive',
  'installation',
  'commissioning',
  'inspection',
  'retrofit',
] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export const WORK_ORDER_STATUSES = [
  'draft',
  'ready',
  'scheduled',
  'in_progress',
  'on_hold',
  'pending_review',
  'completed',
  'closed',
  'cancelled',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ASSIGNMENT_STATUSES = ['offered', 'accepted', 'rejected', 'active', 'completed'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const WORK_ORDER_EVENT_TYPES = [
  'created',
  'status_changed',
  'assigned',
  'unassigned',
  'checklist_saved',
  'observation_added',
  'measurement_added',
  'parts_recorded',
  'report_generated',
  'report_published',
  'acknowledgement_captured',
  'note_added',
] as const;
export type WorkOrderEventType = (typeof WORK_ORDER_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Checklists / field execution
// ---------------------------------------------------------------------------

export const CHECKLIST_ITEM_TYPES = ['check', 'measurement', 'informational'] as const;
export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPES)[number];

export const CHECKLIST_OUTCOMES = ['pass', 'fail', 'not_applicable', 'not_checked', 'exception'] as const;
export type ChecklistOutcome = (typeof CHECKLIST_OUTCOMES)[number];

/** Immutable, versioned checklist definition (validated at the API boundary). */
export interface ChecklistDefinition {
  schemaVersion: number;
  items: Array<{
    key: string;
    label: string;
    type: ChecklistItemType;
    required: boolean;
    instructions?: string;
    unit?: string;
    minValue?: number;
    maxValue?: number;
  }>;
}

export const ACKNOWLEDGEMENT_METHODS = ['signature', 'name_confirmation', 'not_signed'] as const;
export type AcknowledgementMethod = (typeof ACKNOWLEDGEMENT_METHODS)[number];

// ---------------------------------------------------------------------------
// Contracts & maintenance
// ---------------------------------------------------------------------------

export const CONTRACT_TYPES = ['warranty', 'amc', 'service'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated', 'renewed'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const COVERAGE_TYPES = ['full', 'labour_only', 'inspection_only', 'parts_only'] as const;
export type CoverageType = (typeof COVERAGE_TYPES)[number];

export const RENEWAL_STATUSES = ['not_due', 'due_soon', 'in_progress', 'renewed', 'lost'] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export const RECURRENCE_FREQUENCIES = ['week', 'month', 'quarter', 'half_year', 'year'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  dayOfMonth?: number;
}

export const PLAN_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLANNED_VISIT_STATUSES = [
  'planned',
  'scheduled',
  'completed',
  'skipped',
  'cancelled',
] as const;
export type PlannedVisitStatus = (typeof PLANNED_VISIT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Files, notifications, reports
// ---------------------------------------------------------------------------

export const ATTACHMENT_STATUSES = ['pending', 'available', 'quarantined', 'deleted'] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const REPORT_STATUSES = ['draft', 'pending_review', 'approved', 'published', 'superseded'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const NOTIFICATION_CATEGORIES = [
  'request_created',
  'request_assigned_triage',
  'work_order_assigned',
  'work_order_status',
  'sla_at_risk',
  'pm_due',
  'amc_renewal',
  'report_published',
  'membership',
  'system',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// API envelope (Tech Spec §10.4)
// ---------------------------------------------------------------------------

export interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string };
}

export interface ApiListEnvelope<T> extends ApiEnvelope<T[]> {
  page?: { nextCursor: string | null; hasMore: boolean };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; reason: string }>;
  };
  meta: { requestId: string };
}
