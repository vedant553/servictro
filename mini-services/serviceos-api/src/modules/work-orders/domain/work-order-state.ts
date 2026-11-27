import { WorkOrderStatus } from '@serviceos/contracts';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * Work order state machine (ADR-017; Tech Spec §12.2 diagram made explicit).
 *
 *   draft → ready → scheduled → in_progress → pending_review → completed → closed
 *                ↘ on_hold ↙ (from scheduled/in_progress, returns to scheduled)
 *   cancelled: reachable from any non-terminal open state with a reason.
 *
 * Guards (Tech Spec §12.3 invariants) are enforced in the service before
 * calling assertWorkOrderTransition: required checklist items complete, time
 * window present for scheduling, reviewer approval before completion, and
 * customer acknowledgement + published report before closure.
 */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['pending_review', 'on_hold', 'cancelled'],
  on_hold: ['scheduled', 'cancelled'],
  pending_review: ['completed', 'in_progress', 'cancelled'],
  completed: ['closed', 'pending_review'],
  closed: [],
  cancelled: [],
};

export const WORK_ORDER_OPEN_STATUSES: WorkOrderStatus[] = [
  'draft', 'ready', 'scheduled', 'in_progress', 'on_hold', 'pending_review', 'completed',
];

export function assertWorkOrderTransition(from: WorkOrderStatus, to: WorkOrderStatus): void {
  if (from === to) {
    throw new DomainError('WORK_ORDER_SAME_STATE', `Work order is already ${from}`, 409);
  }
  if (!WORK_ORDER_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError(
      'WORK_ORDER_INVALID_TRANSITION',
      `Cannot move a work order from ${from} to ${to}`,
      409,
    );
  }
}

/** Statuses in which field execution (checklist/readings) may be captured. */
export const EXECUTION_STATUSES: WorkOrderStatus[] = ['scheduled', 'in_progress', 'on_hold'];

/** Checklist completion rule: every required item needs a definite outcome. */
export function checklistComplete(
  definition: { items: Array<{ key: string; required: boolean }> },
  results: Map<string, { outcome: string; exceptionReason?: string | null }>,
): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const item of definition.items) {
    if (!item.required) continue;
    const result = results.get(item.key);
    const definite = result && ['pass', 'fail', 'not_applicable'].includes(result.outcome);
    const exception = result?.outcome === 'exception' && Boolean(result.exceptionReason);
    if (!definite && !exception) missing.push(item.key);
  }
  return { complete: missing.length === 0, missing };
}
