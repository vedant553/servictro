"use strict";
/**
 * ServiceOS shared contracts — API-safe enums and types only.
 * Consumed by the web console and the NestJS API. Never import server-only
 * code here (Tech Spec §5: share contracts, not backend entities).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATION_CATEGORIES = exports.REPORT_STATUSES = exports.SCAN_STATUSES = exports.ATTACHMENT_STATUSES = exports.PLANNED_VISIT_STATUSES = exports.PLAN_STATUSES = exports.RECURRENCE_FREQUENCIES = exports.RENEWAL_STATUSES = exports.COVERAGE_TYPES = exports.CONTRACT_STATUSES = exports.CONTRACT_TYPES = exports.ACKNOWLEDGEMENT_METHODS = exports.CHECKLIST_OUTCOMES = exports.CHECKLIST_ITEM_TYPES = exports.WORK_ORDER_EVENT_TYPES = exports.ASSIGNMENT_STATUSES = exports.PRIORITIES = exports.WORK_ORDER_STATUSES = exports.WORK_ORDER_TYPES = exports.REQUEST_CATEGORIES = exports.REQUEST_STATUSES = exports.SEVERITIES = exports.REQUEST_SOURCES = exports.ASSET_DOCUMENT_TYPES = exports.ASSET_STATUSES = exports.ASSET_FAMILIES = exports.SITE_STATUSES = exports.CUSTOMER_STATUSES = exports.ROLES = exports.INVITATION_STATUSES = exports.MEMBERSHIP_STATUSES = exports.USER_STATUSES = exports.TENANT_STATUSES = void 0;
// ---------------------------------------------------------------------------
// Identity & tenancy
// ---------------------------------------------------------------------------
exports.TENANT_STATUSES = ['active', 'suspended', 'closed'];
exports.USER_STATUSES = ['active', 'disabled'];
exports.MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'revoked'];
exports.INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'];
exports.ROLES = [
    'owner',
    'admin',
    'service_manager',
    'coordinator',
    'technician',
    'contract_admin',
    'auditor',
];
// ---------------------------------------------------------------------------
// CRM / assets
// ---------------------------------------------------------------------------
exports.CUSTOMER_STATUSES = ['active', 'inactive', 'archived'];
exports.SITE_STATUSES = ['active', 'inactive'];
/** First-release asset families (electrical OEM wedge — Blueprint §3). */
exports.ASSET_FAMILIES = [
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
];
exports.ASSET_STATUSES = ['active', 'inactive', 'decommissioned'];
exports.ASSET_DOCUMENT_TYPES = [
    'single_line_diagram',
    'ga_drawing',
    'test_certificate',
    'om_manual',
    'commissioning_report',
    'warranty_certificate',
    'nameplate_photo',
    'other',
];
// ---------------------------------------------------------------------------
// Service desk
// ---------------------------------------------------------------------------
exports.REQUEST_SOURCES = ['phone', 'email', 'portal', 'whatsapp', 'walk_in', 'internal'];
exports.SEVERITIES = ['low', 'medium', 'high', 'critical'];
exports.REQUEST_STATUSES = [
    'new',
    'triaged',
    'accepted',
    'needs_information',
    'converted',
    'rejected',
    'closed',
];
exports.REQUEST_CATEGORIES = [
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
];
// ---------------------------------------------------------------------------
// Work management
// ---------------------------------------------------------------------------
exports.WORK_ORDER_TYPES = [
    'breakdown',
    'preventive',
    'installation',
    'commissioning',
    'inspection',
    'retrofit',
];
exports.WORK_ORDER_STATUSES = [
    'draft',
    'ready',
    'scheduled',
    'in_progress',
    'on_hold',
    'pending_review',
    'completed',
    'closed',
    'cancelled',
];
exports.PRIORITIES = ['low', 'normal', 'high', 'urgent'];
exports.ASSIGNMENT_STATUSES = ['offered', 'accepted', 'rejected', 'active', 'completed'];
exports.WORK_ORDER_EVENT_TYPES = [
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
];
// ---------------------------------------------------------------------------
// Checklists / field execution
// ---------------------------------------------------------------------------
exports.CHECKLIST_ITEM_TYPES = ['check', 'measurement', 'informational'];
exports.CHECKLIST_OUTCOMES = ['pass', 'fail', 'not_applicable', 'not_checked', 'exception'];
exports.ACKNOWLEDGEMENT_METHODS = ['signature', 'name_confirmation', 'not_signed'];
// ---------------------------------------------------------------------------
// Contracts & maintenance
// ---------------------------------------------------------------------------
exports.CONTRACT_TYPES = ['warranty', 'amc', 'service'];
exports.CONTRACT_STATUSES = ['draft', 'active', 'expired', 'terminated', 'renewed'];
exports.COVERAGE_TYPES = ['full', 'labour_only', 'inspection_only', 'parts_only'];
exports.RENEWAL_STATUSES = ['not_due', 'due_soon', 'in_progress', 'renewed', 'lost'];
exports.RECURRENCE_FREQUENCIES = ['week', 'month', 'quarter', 'half_year', 'year'];
exports.PLAN_STATUSES = ['draft', 'active', 'paused', 'archived'];
exports.PLANNED_VISIT_STATUSES = [
    'planned',
    'scheduled',
    'completed',
    'skipped',
    'cancelled',
];
// ---------------------------------------------------------------------------
// Files, notifications, reports
// ---------------------------------------------------------------------------
exports.ATTACHMENT_STATUSES = ['pending', 'available', 'quarantined', 'deleted'];
exports.SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'];
exports.REPORT_STATUSES = ['draft', 'pending_review', 'approved', 'published', 'superseded'];
exports.NOTIFICATION_CATEGORIES = [
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
];
//# sourceMappingURL=enums.js.map