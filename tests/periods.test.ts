import { describe, expect, it } from 'vitest';
import {
  assertEqualLength,
  assertValidPeriod,
  guardDataStart,
  periodDays,
  resolveAlias,
  resolveComparisonPeriod,
} from '../src/core/periods.js';

// Wednesday
const REF = new Date('2026-07-15T10:00:00Z');

describe('resolveAlias', () => {
  it('resolves yesterday as a one-day half-open interval', () => {
    expect(resolveAlias('yesterday', REF)).toEqual({ from: '2026-07-14', to: '2026-07-15' });
  });

  it('resolves last_week as Monday-to-Monday', () => {
    expect(resolveAlias('last_week', REF)).toEqual({ from: '2026-07-06', to: '2026-07-13' });
  });

  it('resolves last_month across month boundaries', () => {
    expect(resolveAlias('last_month', REF)).toEqual({ from: '2026-06-01', to: '2026-07-01' });
  });

  it('rejects unknown aliases', () => {
    expect(() => resolveAlias('fortnight', REF)).toThrow(/Unknown period alias/);
  });
});

describe('period validation', () => {
  it('rejects malformed dates', () => {
    expect(() => assertValidPeriod({ from: '2026-13-01', to: '2026-13-08' })).toThrow(/ISO date/);
    expect(() => assertValidPeriod({ from: 'last week', to: '2026-07-15' })).toThrow(/ISO date/);
  });

  it('rejects empty or inverted periods', () => {
    expect(() => assertValidPeriod({ from: '2026-07-15', to: '2026-07-15' })).toThrow(/empty/);
    expect(() => assertValidPeriod({ from: '2026-07-16', to: '2026-07-15' })).toThrow(/empty/);
  });

  it('enforces equal length for comparisons', () => {
    expect(() =>
      assertEqualLength(
        { from: '2026-07-01', to: '2026-07-08' },
        { from: '2026-07-08', to: '2026-07-16' }
      )
    ).toThrow(/equal length/);
  });

  it('guards the data start date', () => {
    expect(() =>
      guardDataStart({ from: '2026-01-01', to: '2026-01-08' }, '2026-03-01')
    ).toThrow(/No data before/);
    expect(() =>
      guardDataStart({ from: '2026-03-01', to: '2026-03-08' }, '2026-03-01')
    ).not.toThrow();
  });
});

describe('resolveComparisonPeriod', () => {
  const current = { from: '2026-07-08', to: '2026-07-15' };

  it('prev_period is the immediately preceding equal-length window', () => {
    const baseline = resolveComparisonPeriod(current, 'prev_period');
    expect(baseline).toEqual({ from: '2026-07-01', to: '2026-07-08' });
    expect(periodDays(baseline)).toBe(periodDays(current));
  });

  it('prev_week shifts the window back exactly 7 days', () => {
    expect(resolveComparisonPeriod(current, 'prev_week')).toEqual({
      from: '2026-07-01',
      to: '2026-07-08',
    });
  });

  it('prev_month shifts by calendar month', () => {
    expect(resolveComparisonPeriod(current, 'prev_month')).toEqual({
      from: '2026-06-08',
      to: '2026-06-15',
    });
  });

  it('prev_month preserves window length across unequal month lengths', () => {
    // 30-day window starting Jul 3: naive endpoint shifting would yield a
    // 29-day baseline (Jun 3 – Jul 2) and break the equal-length invariant.
    const window30 = { from: '2026-07-03', to: '2026-08-02' };
    const baseline = resolveComparisonPeriod(window30, 'prev_month');
    expect(baseline.from).toBe('2026-06-03');
    expect(periodDays(baseline)).toBe(periodDays(window30));
    expect(() => assertEqualLength(baseline, window30)).not.toThrow();
  });
});
