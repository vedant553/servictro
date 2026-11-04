/**
 * ServiceOS design system — single source of truth for semantic styling of
 * domain enums (Tech Spec §7). Every status ships with a human label, a badge
 * tone and an icon; status is NEVER conveyed by colour alone (a11y rule).
 *
 * These maps are presentation-only; authority lives in @serviceos/contracts.
 */
import {
  REQUEST_STATUSES,
  WORK_ORDER_STATUSES,
  SEVERITIES,
  PRIORITIES,
  CONTRACT_TYPES,
  CONTRACT_STATUSES,
  RENEWAL_STATUSES,
  PLAN_STATUSES,
  PLANNED_VISIT_STATUSES,
  ASSET_FAMILIES,
  ASSET_STATUSES,
  ROLES,
  REQUEST_SOURCES,
  REQUEST_CATEGORIES,
  WORK_ORDER_TYPES,
  ACKNOWLEDGEMENT_METHODS,
  REPORT_STATUSES,
  ASSIGNMENT_STATUSES,
  CHECKLIST_OUTCOMES,
  type RequestStatus,
  type WorkOrderStatus,
  type Severity,
  type Priority,
  type ContractType,
  type ContractStatus,
  type RenewalStatus,
  type PlanStatus,
  type PlannedVisitStatus,
  type AssetFamily,
  type AssetStatus,
  type Role,
  type RequestSource,
  type RequestCategory,
  type WorkOrderType,
  type AcknowledgementMethod,
  type ReportStatus,
  type AssignmentStatus,
  type ChecklistOutcome,
} from "@serviceos/contracts";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

export interface EnumStyle {
  label: string;
  tone: Tone;
}

const s = (label: string, tone: Tone): EnumStyle => ({ label, tone });

/* ---------- Service requests ---------- */
export const REQUEST_STATUS_STYLE: Record<RequestStatus, EnumStyle> = {
  new: s("New", "info"),
  triaged: s("Triaged", "accent"),
  accepted: s("Accepted", "success"),
  needs_information: s("Info needed", "warning"),
  converted: s("Converted", "success"),
  rejected: s("Rejected", "danger"),
  closed: s("Closed", "neutral"),
};

/* ---------- Work orders ---------- */
export const WORK_ORDER_STATUS_STYLE: Record<WorkOrderStatus, EnumStyle> = {
  draft: s("Draft", "neutral"),
  ready: s("Ready", "info"),
  scheduled: s("Scheduled", "accent"),
  in_progress: s("In progress", "info"),
  on_hold: s("On hold", "warning"),
  pending_review: s("Pending review", "warning"),
  completed: s("Completed", "success"),
  closed: s("Closed", "neutral"),
  cancelled: s("Cancelled", "danger"),
};

export const SEVERITY_STYLE: Record<Severity, EnumStyle> = {
  low: s("Low", "neutral"),
  medium: s("Medium", "info"),
  high: s("High", "warning"),
  critical: s("Critical", "danger"),
};

export const PRIORITY_STYLE: Record<Priority, EnumStyle> = {
  low: s("Low", "neutral"),
  normal: s("Normal", "info"),
  high: s("High", "warning"),
  urgent: s("Urgent", "danger"),
};

export const WORK_ORDER_TYPE_STYLE: Record<WorkOrderType, EnumStyle> = {
  breakdown: s("Breakdown", "danger"),
  preventive: s("Preventive", "success"),
  installation: s("Installation", "info"),
  commissioning: s("Commissioning", "info"),
  inspection: s("Inspection", "accent"),
  retrofit: s("Retrofit", "accent"),
};

export const ASSIGNMENT_STATUS_STYLE: Record<AssignmentStatus, EnumStyle> = {
  offered: s("Offered", "warning"),
  accepted: s("Accepted", "success"),
  rejected: s("Rejected", "danger"),
  active: s("Active", "info"),
  completed: s("Completed", "neutral"),
};

export const REPORT_STATUS_STYLE: Record<ReportStatus, EnumStyle> = {
  draft: s("Draft", "neutral"),
  pending_review: s("Pending review", "warning"),
  approved: s("Approved", "success"),
  published: s("Published", "success"),
  superseded: s("Superseded", "neutral"),
};

export const CHECKLIST_OUTCOME_STYLE: Record<ChecklistOutcome, EnumStyle> = {
  pass: s("Pass", "success"),
  fail: s("Fail", "danger"),
  not_applicable: s("N/A", "neutral"),
  not_checked: s("Not checked", "neutral"),
  exception: s("Exception", "warning"),
};

export const ACK_METHOD_STYLE: Record<AcknowledgementMethod, EnumStyle> = {
  signature: s("Signature", "success"),
  name_confirmation: s("Name confirmation", "info"),
  not_signed: s("Not signed", "warning"),
};

/* ---------- Contracts & maintenance ---------- */
export const CONTRACT_TYPE_STYLE: Record<ContractType, EnumStyle> = {
  warranty: s("Warranty", "info"),
  amc: s("AMC", "success"),
  service: s("Service", "accent"),
};

export const CONTRACT_STATUS_STYLE: Record<ContractStatus, EnumStyle> = {
  draft: s("Draft", "neutral"),
  active: s("Active", "success"),
  expired: s("Expired", "danger"),
  terminated: s("Terminated", "danger"),
  renewed: s("Renewed", "info"),
};

export const RENEWAL_STATUS_STYLE: Record<RenewalStatus, EnumStyle> = {
  not_due: s("Not due", "neutral"),
  due_soon: s("Due soon", "warning"),
  in_progress: s("In progress", "info"),
  renewed: s("Renewed", "success"),
  lost: s("Lost", "danger"),
};

export const PLAN_STATUS_STYLE: Record<PlanStatus, EnumStyle> = {
  draft: s("Draft", "neutral"),
  active: s("Active", "success"),
  paused: s("Paused", "warning"),
  archived: s("Archived", "neutral"),
};

export const PLANNED_VISIT_STATUS_STYLE: Record<PlannedVisitStatus, EnumStyle> = {
  planned: s("Planned", "neutral"),
  scheduled: s("Scheduled", "accent"),
  completed: s("Completed", "success"),
  skipped: s("Skipped", "warning"),
  cancelled: s("Cancelled", "danger"),
};

/* ---------- Assets ---------- */
export const ASSET_FAMILY_STYLE: Record<AssetFamily, EnumStyle> = {
  lt_panel: s("LT Panel", "accent"),
  ht_switchgear: s("HT Switchgear", "info"),
  vcb_panel: s("VCB Panel", "info"),
  rmu: s("RMU", "accent"),
  pcc: s("PCC", "neutral"),
  mcc: s("MCC", "neutral"),
  apfc: s("APFC", "accent"),
  busduct: s("Busduct", "neutral"),
  transformer: s("Transformer", "info"),
  other: s("Other", "neutral"),
};

export const ASSET_STATUS_STYLE: Record<AssetStatus, EnumStyle> = {
  active: s("In service", "success"),
  inactive: s("Out of service", "warning"),
  decommissioned: s("Decommissioned", "neutral"),
};

/* ---------- Identity ---------- */
export const ROLE_STYLE: Record<Role, EnumStyle> = {
  owner: s("Owner", "danger"),
  admin: s("Admin", "info"),
  service_manager: s("Service manager", "accent"),
  coordinator: s("Coordinator", "info"),
  technician: s("Technician", "success"),
  contract_admin: s("Contract admin", "accent"),
  auditor: s("Auditor", "neutral"),
};

/* ---------- Intake ---------- */
export const REQUEST_SOURCE_LABEL: Record<RequestSource, string> = {
  phone: "Phone",
  email: "Email",
  portal: "Portal",
  whatsapp: "WhatsApp",
  walk_in: "Walk-in",
  internal: "Internal",
};

export const REQUEST_CATEGORY_LABEL: Record<RequestCategory, string> = {
  breakdown: "Breakdown",
  tripping: "Tripping",
  overheating: "Overheating",
  abnormal_sound: "Abnormal sound",
  preventive_visit: "Preventive visit",
  inspection: "Inspection",
  retrofit: "Retrofit",
  spares: "Spares",
  documentation: "Documentation",
  other: "Other",
};

/* ---------- Enum option lists for selects ---------- */
export const enumOptions = <T extends string>(values: readonly T[], labels?: Record<T, string>) =>
  values.map((v) => ({ value: v, label: labels?.[v] ?? v }));

export const severityOptions = enumOptions(SEVERITIES, {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
});
export const priorityOptions = enumOptions(PRIORITIES, {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
});
export const requestStatusOptions = enumOptions(
  REQUEST_STATUSES,
  Object.fromEntries(REQUEST_STATUSES.map((v) => [v, REQUEST_STATUS_STYLE[v].label])) as Record<RequestStatus, string>,
);
export const workOrderStatusOptions = enumOptions(
  WORK_ORDER_STATUSES,
  Object.fromEntries(WORK_ORDER_STATUSES.map((v) => [v, WORK_ORDER_STATUS_STYLE[v].label])) as Record<WorkOrderStatus, string>,
);
export const assetFamilyOptions = enumOptions(
  ASSET_FAMILIES,
  Object.fromEntries(ASSET_FAMILIES.map((v) => [v, ASSET_FAMILY_STYLE[v].label])) as Record<AssetFamily, string>,
);
export const roleOptions = enumOptions(
  ROLES,
  Object.fromEntries(ROLES.map((v) => [v, ROLE_STYLE[v].label])) as Record<Role, string>,
);
export const requestSourceOptions = enumOptions(REQUEST_SOURCES, REQUEST_SOURCE_LABEL);
export const requestCategoryOptions = enumOptions(REQUEST_CATEGORIES, REQUEST_CATEGORY_LABEL);
export const workOrderTypeOptions = enumOptions(
  WORK_ORDER_TYPES,
  Object.fromEntries(WORK_ORDER_TYPES.map((v) => [v, WORK_ORDER_TYPE_STYLE[v].label])) as Record<WorkOrderType, string>,
);
export const ackMethodOptions = enumOptions(ACKNOWLEDGEMENT_METHODS, {
  signature: "Signature on report",
  name_confirmation: "Verbal name confirmation",
  not_signed: "Not signed",
});
