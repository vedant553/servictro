import {
  startOfUtcDay,
  daysBetweenUtcDays,
  isContractExpired,
  renewalHorizonFor,
  coverageLowerBound,
} from '../../src/modules/maintenance/domain/expiry';

describe('AMC expiry semantics (audit DATA-04)', () => {
  // A fixed "now" mid-day so day boundaries are unambiguous.
  const now = new Date('2026-11-01T14:23:00Z');

  describe('startOfUtcDay', () => {
    it('truncates to UTC midnight', () => {
      expect(startOfUtcDay(now).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    });
    it('handles month/year rollover', () => {
      expect(startOfUtcDay(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });
  });

  describe('isContractExpired', () => {
    it('a contract ending today is STILL covered through end of day', () => {
      expect(isContractExpired(new Date('2026-11-01'), now)).toBe(false);
    });
    it('a contract that ended yesterday is expired', () => {
      expect(isContractExpired(new Date('2026-10-31'), now)).toBe(true);
    });
    it('is exact at midnight of the following day', () => {
      // At exactly 2026-11-02T00:00:00Z the 2026-11-01 contract is expired.
      expect(isContractExpired(new Date('2026-11-01'), new Date('2026-11-02T00:00:00Z'))).toBe(true);
    });
    it('long-past contracts are expired (worker must still process them)', () => {
      expect(isContractExpired(new Date('2026-01-01'), now)).toBe(true);
    });
  });

  describe('daysBetweenUtcDays', () => {
    it('same day is 0', () => {
      expect(daysBetweenUtcDays(new Date('2026-11-01'), now)).toBe(0);
    });
    it('tomorrow is 1 (independent of time of day)', () => {
      expect(daysBetweenUtcDays(new Date('2026-11-02'), now)).toBe(1);
      expect(daysBetweenUtcDays(new Date('2026-11-02'), new Date('2026-11-01T00:01:00Z'))).toBe(1);
    });
    it('yesterday is -1', () => {
      expect(daysBetweenUtcDays(new Date('2026-10-31'), now)).toBe(-1);
    });
  });

  describe('renewalHorizonFor', () => {
    it('notifies on configured horizons', () => {
      expect(renewalHorizonFor(90, [90, 60, 30])).toBe(90);
      expect(renewalHorizonFor(60, [90, 60, 30])).toBe(60);
      expect(renewalHorizonFor(30, [90, 60, 30])).toBe(30);
    });
    it('notifies on the final day (0) even though it is not a configured horizon', () => {
      expect(renewalHorizonFor(0, [90, 60, 30])).toBe(0);
    });
    it('does not notify on non-horizon days', () => {
      expect(renewalHorizonFor(45, [90, 60, 30])).toBeNull();
      expect(renewalHorizonFor(1, [90, 60, 30])).toBeNull();
      expect(renewalHorizonFor(-3, [90, 60, 30])).toBeNull();
    });
  });

  describe('coverageLowerBound', () => {
    it('is start of today — the entitlement query lower bound', () => {
      expect(coverageLowerBound(now).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    });
  });
});
