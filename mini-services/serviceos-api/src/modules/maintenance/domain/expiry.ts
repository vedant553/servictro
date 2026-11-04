/**
 * AMC/contract expiry semantics (audit DATA-04).
 *
 * Service contracts carry a DATE (no time) `endDate`: a contract ending
 * "2026-11-01" is covered through the END of that day (UTC). All expiry math
 * therefore operates on whole UTC days — never on raw timestamps, which
 * produced the original off-by-one (entitlement revoked at 00:01 on the final
 * day, worker missing contracts that expired while it was down).
 */

/** Midnight UTC of the given instant's day. */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Midnight UTC of the day AFTER the given instant's day (exclusive bound). */
export function endOfUtcDay(d: Date): Date {
  return new Date(startOfUtcDay(d).getTime() + 86_400_000);
}

/**
 * Whole days from `now`'s UTC day to `endDay`'s UTC day.
 * 0 = expires today (still covered), 1 = tomorrow, -1 = expired yesterday.
 */
export function daysBetweenUtcDays(endDay: Date, now: Date): number {
  return Math.round((startOfUtcDay(endDay).getTime() - startOfUtcDay(now).getTime()) / 86_400_000);
}

/** A contract is expired only once its final day has fully passed (UTC). */
export function isContractExpired(endDate: Date, now: Date): boolean {
  return startOfUtcDay(endDate).getTime() < startOfUtcDay(now).getTime();
}

/**
 * Reminder horizons (90/60/30 days) plus the final day (0) — "expires today"
 * is the most important reminder. Returns the horizon to notify on, or null.
 */
export function renewalHorizonFor(daysRemaining: number, horizons: readonly number[]): number | null {
  if (horizons.includes(daysRemaining)) return daysRemaining;
  if (daysRemaining === 0) return 0;
  return null;
}

/**
 * Inclusive lower bound for "still covered or expiring" queries: the start of
 * today (UTC). Combined with an upper bound this yields contracts expiring
 * today through the horizon — and never misses already-expired rows, which
 * the worker must still process (status flip + expiry notification).
 */
export function coverageLowerBound(now: Date): Date {
  return startOfUtcDay(now);
}
