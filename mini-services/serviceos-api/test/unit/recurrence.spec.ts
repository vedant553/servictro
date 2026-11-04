import { nextDue, dueDates, generationKey, RecurrenceRuleSchema } from '../../src/modules/maintenance/domain/recurrence';

describe('preventive maintenance recurrence (Tech Spec §12.5)', () => {
  it('validates recurrence rules', () => {
    expect(RecurrenceRuleSchema.safeParse({ frequency: 'quarter', interval: 1 }).success).toBe(true);
    expect(RecurrenceRuleSchema.safeParse({ frequency: 'week', interval: 0 }).success).toBe(false);
    expect(RecurrenceRuleSchema.safeParse({ frequency: 'daily', interval: 1 }).success).toBe(false);
    expect(RecurrenceRuleSchema.safeParse({ frequency: 'month', interval: 1, dayOfMonth: 32 }).success).toBe(false);
  });

  it('computes quarterly due dates deterministically', () => {
    const start = new Date('2026-01-15T00:00:00Z');
    const rule = { frequency: 'quarter' as const, interval: 1 };
    expect(nextDue(start, rule).toISOString().slice(0, 10)).toBe('2026-04-15');
    expect(nextDue(nextDue(start, rule), rule).toISOString().slice(0, 10)).toBe('2026-07-15');
  });

  it('honours dayOfMonth clamped to month length', () => {
    const rule = { frequency: 'month' as const, interval: 1, dayOfMonth: 31 };
    const from = new Date('2026-01-31T00:00:00Z');
    const next = nextDue(from, rule);
    // February 2026 has 28 days → clamped
    expect(next.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('generates a bounded set of due dates within the horizon', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-12-31T00:00:00Z');
    const dates = dueDates(start, end, { frequency: 'month', interval: 1 });
    expect(dates).toHaveLength(12);
  });

  it('generation keys are unique per (plan, asset, date) — PM idempotency anchor', () => {
    const plan = 'plan-1';
    const assetA = 'asset-a';
    const assetB = 'asset-b';
    const d1 = new Date('2026-04-01T00:00:00Z');
    const d2 = new Date('2026-07-01T00:00:00Z');
    const keys = [
      generationKey(plan, assetA, d1),
      generationKey(plan, assetA, d2),
      generationKey(plan, assetB, d1),
    ];
    expect(new Set(keys).size).toBe(3);
    // Same inputs → same key (worker retries dedupe)
    expect(generationKey(plan, assetA, d1)).toBe(keys[0]);
    // Different timezone offsets of the same instant collapse to the same UTC day
    expect(generationKey(plan, assetA, new Date('2026-04-01T05:30:00+05:30'))).toBe(keys[0]);
  });
});
