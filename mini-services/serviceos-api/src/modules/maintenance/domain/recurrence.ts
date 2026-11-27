import { z } from 'zod';
import { addDays, addMonths, addWeeks, addYears, startOfDay } from 'date-fns';

/**
 * Preventive maintenance recurrence (Tech Spec §12.5): calendar-based rules
 * only for the MVP; meter/IoT triggers are later. Pure functions so the
 * generator is deterministic and unit-testable.
 */
export const RecurrenceRuleSchema = z
  .object({
    frequency: z.enum(['week', 'month', 'quarter', 'half_year', 'year']),
    interval: z.number().int().min(1).max(60),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
  })
  .strict();

export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;

export const FREQUENCY_MONTHS: Record<string, number> = {
  week: 0,
  month: 1,
  quarter: 3,
  half_year: 6,
  year: 12,
};

/** Next due date after `from`, honouring dayOfMonth where valid. */
export function nextDue(from: Date, rule: RecurrenceRule): Date {
  let next: Date;
  switch (rule.frequency) {
    case 'week':
      next = addWeeks(startOfDay(from), rule.interval);
      break;
    case 'month':
    case 'quarter':
    case 'half_year':
    case 'year':
      next = addMonths(startOfDay(from), FREQUENCY_MONTHS[rule.frequency] * rule.interval);
      break;
    default:
      next = addMonths(startOfDay(from), 1);
  }
  if (rule.dayOfMonth && next.getMonth() === from.getMonth() + FREQUENCY_MONTHS[rule.frequency] * rule.interval) {
    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next = new Date(next.getFullYear(), next.getMonth(), Math.min(rule.dayOfMonth, daysInMonth));
  }
  return next;
}

/**
 * Deterministic generation key — the idempotency anchor for PM visits
 * (Tech Spec §12.5 / §9.3: unique on (tenant, plan, asset, due date) so
 * worker retries can never create duplicate visits).
 */
export function generationKey(planId: string, assetId: string, dueAt: Date): string {
  return `${planId}:${assetId}:${dueAt.toISOString().slice(0, 10)}`;
}

/** All due dates in [start, horizon]. */
export function dueDates(start: Date, horizonEnd: Date, rule: RecurrenceRule): Date[] {
  const dates: Date[] = [];
  let cursor = startOfDay(start);
  let guard = 0;
  while (cursor <= horizonEnd && guard < 500) {
    dates.push(cursor);
    cursor = nextDue(cursor, rule);
    guard++;
  }
  return dates;
}

export { addDays, addMonths, addWeeks, addYears };
