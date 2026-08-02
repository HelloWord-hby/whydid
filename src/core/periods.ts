/**
 * Period handling — one of the two places whydid refuses to trust the LLM
 * (the other is arithmetic).
 *
 * All periods are half-open ISO date intervals [from, to). Relative phrases
 * ("last week") resolve to concrete dates in deterministic code, and
 * comparison periods are derived here — the LLM only ever passes dates
 * through, it never computes them.
 */
import {
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  addDays,
  addMonths,
} from 'date-fns';

export interface Period {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, exclusive. */
  to: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string, field: string): void {
  if (!ISO_DATE.test(value) || !isValid(parseISO(value))) {
    throw new Error(`${field} must be an ISO date (YYYY-MM-DD), got "${value}"`);
  }
}

export function assertValidPeriod(p: Period, name = 'period'): void {
  assertIsoDate(p.from, `${name}.from`);
  assertIsoDate(p.to, `${name}.to`);
  if (p.from >= p.to) {
    throw new Error(
      `${name} is empty or inverted: [${p.from}, ${p.to}). "to" is exclusive and must be after "from".`
    );
  }
}

export function periodDays(p: Period): number {
  return differenceInCalendarDays(parseISO(p.to), parseISO(p.from));
}

/** Resolve a shorthand alias to a concrete period, relative to a reference date. */
export function resolveAlias(alias: string, referenceDate: Date): Period {
  const day = (d: Date) => format(d, 'yyyy-MM-dd');
  const ref = referenceDate;

  switch (alias) {
    case 'today':
      return { from: day(ref), to: day(addDays(ref, 1)) };
    case 'yesterday':
      return { from: day(subDays(ref, 1)), to: day(ref) };
    case 'this_week': {
      const start = startOfWeek(ref, { weekStartsOn: 1 });
      return { from: day(start), to: day(addDays(start, 7)) };
    }
    case 'last_week': {
      const start = startOfWeek(subDays(ref, 7), { weekStartsOn: 1 });
      return { from: day(start), to: day(addDays(start, 7)) };
    }
    case 'this_month': {
      const start = startOfMonth(ref);
      return { from: day(start), to: day(addMonths(start, 1)) };
    }
    case 'last_month': {
      const start = startOfMonth(subMonths(ref, 1));
      return { from: day(start), to: day(addMonths(start, 1)) };
    }
    case 'last_7d':
      return { from: day(subDays(ref, 7)), to: day(ref) };
    case 'last_30d':
      return { from: day(subDays(ref, 30)), to: day(ref) };
    default:
      throw new Error(`Unknown period alias "${alias}"`);
  }
}

/**
 * Comparison periods must be the same length as the current period, otherwise
 * the delta mixes "the metric changed" with "the window changed".
 */
export function assertEqualLength(a: Period, b: Period): void {
  const da = periodDays(a);
  const db = periodDays(b);
  if (da !== db) {
    throw new Error(
      `Periods must be equal length to compare: period_a is ${da} days, period_b is ${db} days.`
    );
  }
}

export type ComparisonStrategy = 'prev_period' | 'prev_week' | 'prev_month';

/** Derive the baseline period for a given current period. */
export function resolveComparisonPeriod(
  current: Period,
  strategy: ComparisonStrategy
): Period {
  const from = parseISO(current.from);
  const to = parseISO(current.to);
  const day = (d: Date) => format(d, 'yyyy-MM-dd');

  switch (strategy) {
    case 'prev_period': {
      const days = periodDays(current);
      return { from: day(subDays(from, days)), to: current.from };
    }
    case 'prev_week':
      return { from: day(subDays(from, 7)), to: day(subDays(to, 7)) };
    case 'prev_month': {
      // Shift only the start by a calendar month, then re-apply the current
      // length: shifting both endpoints independently would produce unequal
      // windows whenever month lengths differ (e.g. a 30-day window starting
      // Jul 3 vs Jun 3–Jul 2 = 29 days).
      const start = subMonths(from, 1);
      return { from: day(start), to: day(addDays(start, periodDays(current))) };
    }
    default:
      throw new Error(`Unknown comparison strategy "${strategy}"`);
  }
}

/** Reject queries that start before the configured data start date. */
export function guardDataStart(period: Period, dataStart?: string): void {
  if (dataStart && period.from < dataStart) {
    throw new Error(
      `No data before ${dataStart}. Requested period starts at ${period.from}. ` +
        `Adjust the period instead of reporting empty results as a real drop.`
    );
  }
}
