/**
 * Servictro web console — API response types.
 * These mirror the NestJS API DTO/response shapes exactly (docs/API.md).
 * Money is bigint minor units serialized as string; timestamps are ISO UTC.
 */
import type {
  Role,
  MembershipStatus,
  InvitationStatus,
  CustomerStatus,
  SiteStatus,
  AssetFamily,
  AssetStatus,
  AssetSpecification,
  RequestSource,
  RequestCategory,
  Severity,
  RequestStatus,
  WorkOrderStatus,
  WorkOrderType,
  Priority,
  AssignmentStatus,
  ReportStatus,
  ChecklistDefinition,
  ChecklistOutcome,
  AcknowledgementMethod,
  ContractType,
  ContractStatus,
  CoverageType,
  RenewalStatus,
  RecurrenceRule,
  PlanStatus,
  PlannedVisitStatus,
  NotificationCategory,
  AssetDocumentType,
} from "@serviceos/contracts";

/* ---------- Auth & identity ---------- */

export interface Membership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: Role;
  status: MembershipStatus;
  permissions: string[];
}

export interface AuthSession {
  accessToken: string;
  expiresInMinutes: number;
  user: { id: string; email: string; displayName: string };
  memberships: Membership[];
  selectedTenantId: string;
}

export interface TeamMember {
  tenantId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  title: string | null;
  skills: string[];
  invitedBy: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; displayName: string; email: string };
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: Role;
  status: InvitationStatus;
  title: string | null;
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
}

/* ---------- Tenants ---------- */

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  timezone: string;
  locale: string;
  currencyCode: string;
  status: string;
  plan: string;
  settings: {
    slaResponseMinutes?: Record<string, number>;
    slaResolutionMinutes?: Record<string, number>;
    [k: string]: unknown;
  };
  createdAt: string;
}

/* ---------- CRM ---------- */

export interface Address {
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Customer {
  id: string;
  accountCode: string;
  legalName: string;
  segment: string | null;
  status: CustomerStatus;
  siteCount: number;
  contactCount: number;
  contractCount: number;
  billingAddress?: Address | null;
  notes?: string | null;
  createdAt: string;
  version?: number;
}

export interface CustomerContact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
}

export interface Site {
  id: string;
  siteCode: string;
  name: string;
  status: SiteStatus;
  address: Address | null;
  timezone: string;
  accessInstructions?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  customer: { id: string; legalName: string; accountCode: string };
  version?: number;
  createdAt: string;
}

/* ---------- Assets ---------- */

export interface Asset {
  id: string;
  assetCode: string;
  serialNumber: string | null;
  assetFamily: AssetFamily;
  manufacturer: string | null;
  model: string | null;
  status: AssetStatus;
  commissioningDate: string | null;
  specification: AssetSpecification | null;
  notes?: string | null;
  site: { id: string; name: string; siteCode: string; customer: { id: string; legalName: string; accountCode: string } };
  version?: number;
  createdAt: string;
}

export interface AssetDocumentLink {
  id: string;
  documentType: AssetDocumentType;
  title: string;
  revision: string | null;
  attachment: { id: string; originalName: string; contentType: string; sizeBytes: string; downloadUrl: string } | null;
  createdAt: string;
}

export interface AssetTimelineEntry {
  occurredAt: string;
  kind: string;
  title: string;
  detail?: string | null;
  workOrderNo?: string | null;
  reportId?: string | null;
}

export interface QrPayload {
  assetCode: string;
  qrDataUrl: string;
}

/* ---------- Files ---------- */

export interface Attachment {
  id: string;
  ownerType: string | null;
  ownerId: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: string;
  checksumSha256: string;
  status: string;
  downloadUrl: string;
  createdAt: string;
}

/* ---------- Service requests ---------- */

export interface CoverageContract {
  contractId: string;
  contractNo: string;
  contractType: ContractType;
  coverageType: CoverageType;
  endDate: string;
  daysRemaining: number;
}

export interface ServiceRequest {
  id: string;
  requestNo: string;
  customerId: string;
  siteId: string;
  assetId: string | null;
  contactId: string | null;
  source: RequestSource;
  category: RequestCategory;
  subject: string;
  description: string;
  severity: Severity;
  status: RequestStatus;
  preferredVisitAt: string | null;
  firstResponseAt: string | null;
  triagedAt: string | null;
  acceptedAt: string | null;
  rejectedReason: string | null;
  convertedAt: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; legalName: string; accountCode: string };
  site: { id: string; name: string; siteCode: string; address: Address | null };
  asset: { id: string; assetCode: string; serialNumber: string | null; assetFamily: AssetFamily; manufacturer: string | null; model: string | null } | null;
  workOrders: Array<{ id: string; workOrderNo: string; status: WorkOrderStatus; title: string }>;
  coverage: { covered: boolean; contracts: CoverageContract[] } | null;
  possibleDuplicates?: Array<{ id: string; requestNo: string; subject: string; createdAt: string }>;
}

/* ---------- Work orders ---------- */

export interface WorkOrderAssignment {
  id: string;
  userId: string;
  assignmentRole: string;
  status: AssignmentStatus;
  offeredAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  user: { id: string; displayName: string; email: string };
}

export interface WorkOrderEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorUserId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface ChecklistResultItem {
  itemKey: string;
  outcome: ChecklistOutcome;
  value?: number | null;
  unit?: string | null;
  note?: string | null;
  exceptionReason?: string | null;
  recordedAt?: string;
}

export interface WorkOrderMeasurement {
  id: string;
  measurementKey: string;
  measuredValue: number;
  unit: string;
  phase: string | null;
  instrumentId: string | null;
  calibrationReference: string | null;
  note: string | null;
  createdAt: string;
}

export interface WorkOrderObservation {
  id: string;
  text: string;
  kind: string;
  createdAt: string;
  userId: string | null;
}

export interface WorkOrderPartUsage {
  id: string;
  partCode: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  serialOrBatch: string | null;
  note: string | null;
  createdAt: string;
}

export interface WorkOrderReport {
  id: string;
  version: number;
  status: ReportStatus;
  summary: string;
  generatedAt: string;
  approvedAt: string | null;
  approvedByName: string | null;
  publishedAt: string | null;
  acknowledgement?: {
    method: AcknowledgementMethod;
    acknowledgedByName: string;
    acknowledgedByRole: string | null;
    notSignedReason: string | null;
  } | null;
  downloadUrl?: string | null;
}

export interface WorkOrder {
  id: string;
  workOrderNo: string;
  requestId: string | null;
  customerId: string;
  siteId: string;
  assetId: string | null;
  title: string;
  description: string | null;
  type: WorkOrderType;
  status: WorkOrderStatus;
  priority: Priority;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  slaPolicy: {
    basis: string;
    severity?: Severity;
    contractNo?: string;
    responseMinutes: number;
    resolutionMinutes: number;
  } | null;
  checklistTemplateVersionId: string | null;
  requiredSkills: string[];
  completionSummary: string | null;
  cancelledReason: string | null;
  completedAt: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; legalName: string; accountCode: string };
  site: { id: string; name: string; siteCode: string; address: Address | null; accessInstructions?: string | null; timezone: string };
  asset: {
    id: string;
    assetCode: string;
    serialNumber: string | null;
    assetFamily: AssetFamily;
    manufacturer: string | null;
    model: string | null;
    specification?: AssetSpecification | null;
    commissioningDate?: string | null;
  } | null;
  request?: { id: string; requestNo: string; subject: string; status: RequestStatus } | null;
  checklistTemplateVersion?: {
    id: string;
    templateId: string;
    version: number;
    definition: ChecklistDefinition;
    template?: { name: string; templateKey: string };
  } | null;
  checklistResults?: ChecklistResultItem[];
  measurements?: WorkOrderMeasurement[];
  observations?: WorkOrderObservation[];
  partsUsage?: WorkOrderPartUsage[];
  assignments?: WorkOrderAssignment[];
  events?: WorkOrderEvent[];
  serviceReports?: WorkOrderReport[];
  plannedVisit?: { id: string; dueAt: string; planId: string } | null;
}

/* ---------- Contracts ---------- */

export interface ServiceContract {
  id: string;
  contractNo: string;
  contractType: ContractType;
  status: ContractStatus;
  renewalStatus: RenewalStatus;
  renewalNotes?: string | null;
  startDate: string;
  endDate: string;
  daysRemaining: number | null;
  currencyCode: string;
  amountMinor: string | null;
  responseTargetMinutes?: number | null;
  resolutionTargetMinutes?: number | null;
  includedVisitsPerYear?: number | null;
  terms?: string | null;
  version?: number;
  customer: { id: string; legalName: string; accountCode: string };
  /** List returns flat rows; detail returns join rows with nested asset. */
  assets?: Array<{
    assetId?: string;
    id?: string;
    assetCode?: string;
    assetFamily?: AssetFamily;
    coverageType: CoverageType;
    includedVisits?: number | null;
    asset?: { id: string; assetCode: string; serialNumber: string | null; assetFamily: AssetFamily; status: string };
  }>;
  maintenancePlans?: Array<{ id: string; planCode: string; name: string; status: string }>;
  createdAt: string;
}

/* ---------- Checklists ---------- */

export interface ChecklistTemplate {
  id: string;
  templateKey: string;
  name: string;
  assetFamily: AssetFamily;
  activeVersion: number;
  status: string;
  itemCount: number;
  latestVersionId: string;
  createdAt?: string;
}

export interface ChecklistTemplateDetail extends ChecklistTemplate {
  versions: Array<{
    id: string;
    version: number;
    definition: ChecklistDefinition;
    createdAt: string;
  }>;
}

/* ---------- Maintenance ---------- */

export interface MaintenancePlan {
  id: string;
  planCode: string;
  name: string;
  assetFamily: AssetFamily;
  recurrence: RecurrenceRule;
  startDate: string;
  endDate: string | null;
  horizonDays: number;
  leadDays: number;
  status: PlanStatus;
  checklistTemplateId?: string | null;
  version?: number;
  contract?: { id: string; contractNo: string; contractType: ContractType; endDate: string } | null;
  assets?: Array<{ id: string; assetCode: string; assetFamily: AssetFamily; site: { name: string } }>;
  nextVisitDueAt?: string | null;
  createdAt: string;
}

export interface PlannedVisit {
  id: string;
  planId: string;
  assetId: string;
  dueAt: string;
  status: PlannedVisitStatus;
  workOrderId: string | null;
  generationKey: string;
  completedAt: string | null;
  plan: { id: string; planCode: string; name: string };
  asset: { id: string; assetCode: string; assetFamily: AssetFamily; site: { name: string } };
}

export interface PlanPreviewVisit {
  dueAt: string;
  assetId: string;
  assetCode: string;
}

/* ---------- Notifications ---------- */

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ---------- Audit ---------- */

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  actorName?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  reason: string | null;
  requestId: string | null;
  ipHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/* ---------- Analytics ---------- */

export interface AnalyticsOverview {
  generatedAt: string;
  requests: {
    open: number;
    byStatus: Record<string, number>;
    newAwaitingTriage: number;
  };
  workOrders: {
    open: number;
    overdue: number;
    completedLast30Days: number;
    averageResolutionHours: number | null;
    slaAttainmentPercent: number | null;
  };
  maintenance: { upcomingPm30Days: number };
  contracts: { expiringWithin90Days: number };
  assets: { activeTotal: number; mandatoryFieldsComplete: number | null };
  technicianWorkload: Array<{ userId: string; displayName: string; openJobs: number }>;
}

export interface AnalyticsServiceVolume {
  windowDays: number;
  volume: Array<{ day: string; requests: number; workOrders: number; closed: number }>;
}

/* ---------- Mobile sync (technician PWA) ---------- */

export interface JobPackJob extends WorkOrder {
  checklistDefinition?: ChecklistDefinition | null;
}

/** Bounded, incremental job pack (audit DATA-07). */
export interface JobPack {
  syncedAt: string;
  since: string | null;
  /** Pass as `since` on the next call; equals syncedAt when hasMore=false. */
  nextSince: string;
  hasMore: boolean;
  limit: number;
  jobs: JobPackJob[];
}

export interface SyncPushResult {
  results: Array<{
    operationId: string;
    result: "accepted" | "duplicate" | "conflict" | "rejected" | "pending";
    originalResult?: string;
    serverVersion?: number;
    serverReceivedAt: string;
    error?: string;
  }>;
}

export interface SyncStatusResult {
  cursor: string | null;
  lastSyncAt: string | null;
  lastOperations: Array<{
    operationId: string;
    entityId: string;
    result: string;
    receivedAt: string;
  }>;
  summary: {
    accepted: number;
    conflicts: number;
    rejected: number;
    duplicates: number;
  };
}
