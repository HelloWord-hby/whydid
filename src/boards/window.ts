/**
 * Board time windows — last N full UTC days vs the N days before.
 * Derived in code so every card on a board compares the same periods.
 */
import { type Window } from './types.js';

export const ALLOWED_DAYS = [7, 14, 30] as const;
export const DEFAULT_DAYS = 7;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  const copy = new Date(d.getTime());
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Parse the ?days= query value; anything outside ALLOWED_DAYS is rejected. */
export function parseDays(raw: string | null | undefined): number {
  if (raw == null || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  if (!(ALLOWED_DAYS as readonly number[]).includes(n)) {
    throw new Error(`days must be one of ${ALLOWED_DAYS.join(', ')}`);
  }
  return n;
}

export function buildWindow(days: number, now: Date = new Date()): Window {
  const today = startOfUtcDay(now);
  const currentFrom = addDays(today, -days);
  const previousFrom = addDays(today, -2 * days);
  return {
    days,
    current: { from: isoDay(currentFrom), to: isoDay(today) },
    previous: { from: isoDay(previousFrom), to: isoDay(currentFrom) },
  };
}

/** Every ISO day in [from, to). */
export function daysIn(period: { from: string; to: string }): string[] {
  const out: string[] = [];
  let d = new Date(period.from + 'T00:00:00Z');
  const end = new Date(period.to + 'T00:00:00Z');
  while (d < end) {
    out.push(isoDay(d));
    d = addDays(d, 1);
  }
  return out;
}

/** Relative change as a fraction; null when there is no usable baseline. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function difference(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}
