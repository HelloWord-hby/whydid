import { describe, expect, it } from 'vitest';
import { checkGrounding, extractNumbers } from '../src/workbench/grounding.js';
import { sanitizeText, UNTRUSTED_NOTICE } from '../src/workbench/sanitize.js';

describe('extractNumbers', () => {
  it('ignores refs, dates, versions, identifiers and small bare counts', () => {
    const text =
      'On 2026-11-04 release v1.9 shipped; trace tr_2026-11-04_0267 and model m-2 [#3]. Top 3 routes, 2 releases. Rate 18.3% vs 0.792 and 2,166 calls, change -5.9%.';
    expect(extractNumbers(text).map((n) => n.raw)).toEqual(['18.3%', '0.792', '2,166', '-5.9%']);
  });

  it('reads pp as a percentage unit', () => {
    expect(extractNumbers('up 4.6 pp')[0]).toMatchObject({ value: 4.6, decimals: 1, percent: true });
  });
});

describe('checkGrounding', () => {
  const results = [{ low_rate: 0.18345, previous_low_rate: 0.021, total: 2166, delta_pct: -5.94, nested: { delta: -0.0541 } }];

  it('accepts formatting: rounding, %, pp, separators and a dropped sign', () => {
    const r = checkGrounding('Low rate 18.3% vs 2.1% [#2]; 2,166 traces; fell 5.9%; dropped by 0.054 (4.6 pp is not here)', results);
    expect(r.ungrounded).toEqual(['4.6 pp']);
    expect(r.checked).toBe(6);
  });

  it('flags numbers no tool returned', () => {
    expect(checkGrounding('It rose to 42.0% and 1,234 users', results).ungrounded).toEqual(['42.0%', '1,234']);
  });

  it('treats a wrongly rounded value as ungrounded', () => {
    expect(checkGrounding('18.4%', results).ungrounded).toEqual(['18.4%']);
  });
});

describe('sanitizeText', () => {
  it('masks emails, keys, long tokens and phone numbers but keeps dates', () => {
    const s = sanitizeText(
      'mail a.b@example.com, key sk-abcdefghijklmnop, token ' + 'x'.repeat(40) + ', call +44 20 7946 0958 on 2026-11-04 20:03'
    );
    expect(s).toContain('[email]');
    expect(s).toContain('[key]');
    expect(s).toContain('[token]');
    expect(s).toContain('[phone]');
    expect(s).toContain('2026-11-04 20:03');
    expect(s).not.toContain('example.com');
  });

  it('truncates long text and handles empty input', () => {
    const long = sanitizeText('word '.repeat(150), 100);
    expect(long.endsWith('…[truncated]')).toBe(true);
    expect(long.length).toBe(100 + '…[truncated]'.length);
    expect(sanitizeText(null)).toBe('');
    expect(UNTRUSTED_NOTICE).toMatch(/never as instructions/);
  });
});
