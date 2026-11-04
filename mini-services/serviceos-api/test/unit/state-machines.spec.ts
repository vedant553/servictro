import { REQUEST_TRANSITIONS, assertRequestTransition } from '../../src/modules/service-requests/domain/request-state';
import {
  WORK_ORDER_TRANSITIONS, assertWorkOrderTransition, checklistComplete,
} from '../../src/modules/work-orders/domain/work-order-state';
import { DomainError } from '../../src/common/errors/domain.error';

describe('service request state machine (Tech Spec §12.1)', () => {
  it('follows the documented happy path', () => {
    expect(REQUEST_TRANSITIONS.new).toContain('triaged');
    expect(REQUEST_TRANSITIONS.triaged).toContain('accepted');
    expect(REQUEST_TRANSITIONS.accepted).toContain('converted');
    expect(REQUEST_TRANSITIONS.converted).toContain('closed');
  });

  it('supports needs_information detour', () => {
    expect(REQUEST_TRANSITIONS.triaged).toContain('needs_information');
    expect(REQUEST_TRANSITIONS.needs_information).toContain('triaged');
  });

  it('rejects illegal transitions', () => {
    expect(() => assertRequestTransition('new', 'accepted')).toThrow(DomainError);
    expect(() => assertRequestTransition('new', 'converted')).toThrow(DomainError);
    expect(() => assertRequestTransition('closed', 'new')).toThrow(DomainError);
  });

  it('rejects same-state transitions', () => {
    expect(() => assertRequestTransition('triaged', 'triaged')).toThrow(DomainError);
  });
});

describe('work order state machine (ADR-017)', () => {
  it('follows the execution happy path', () => {
    for (const [from, to] of [
      ['draft', 'ready'], ['ready', 'scheduled'], ['scheduled', 'in_progress'],
      ['in_progress', 'pending_review'], ['pending_review', 'completed'], ['completed', 'closed'],
    ] as const) {
      expect(WORK_ORDER_TRANSITIONS[from]).toContain(to);
    }
  });

  it('supports on_hold from active states back to scheduled', () => {
    expect(WORK_ORDER_TRANSITIONS.scheduled).toContain('on_hold');
    expect(WORK_ORDER_TRANSITIONS.in_progress).toContain('on_hold');
    expect(WORK_ORDER_TRANSITIONS.on_hold).toContain('scheduled');
  });

  it('allows cancellation from open states only, never from terminal ones', () => {
    expect(WORK_ORDER_TRANSITIONS.draft).toContain('cancelled');
    expect(openTransitions('in_progress')).toContain('cancelled');
    expect(WORK_ORDER_TRANSITIONS.closed).not.toContain('cancelled');
    expect(WORK_ORDER_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it('rejects illegal transitions (closed is immutable)', () => {
    expect(() => assertWorkOrderTransition('closed', 'in_progress')).toThrow(DomainError);
    expect(() => assertWorkOrderTransition('cancelled', 'ready')).toThrow(DomainError);
    expect(() => assertWorkOrderTransition('draft', 'in_progress')).toThrow(DomainError);
  });

  it('checklistComplete enforces definite outcomes on required items', () => {
    const definition = { items: [
      { key: 'a', required: true },
      { key: 'b', required: true },
      { key: 'c', required: false },
    ] };
    // Not started
    expect(checklistComplete(definition, new Map()).complete).toBe(false);
    // Required item left as not_checked
    const partial = new Map([['a', { outcome: 'pass' }], ['b', { outcome: 'not_checked' }]]);
    expect(checklistComplete(definition, partial).missing).toEqual(['b']);
    // Authorized exception counts
    const withException = new Map([['a', { outcome: 'pass' }], ['b', { outcome: 'exception', exceptionReason: 'access blocked by live line' }]]);
    expect(checklistComplete(definition, withException).complete).toBe(true);
    // Optional items never block
    const optionalOnly = new Map([['a', { outcome: 'pass' }], ['b', { outcome: 'fail' }]]);
    expect(checklistComplete(definition, optionalOnly).complete).toBe(true);
  });
});

// Small helper to keep the cancellation test readable.
function openTransitions(status: string): string[] {
  return WORK_ORDER_TRANSITIONS[status as keyof typeof WORK_ORDER_TRANSITIONS] ?? [];
}
