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

describe('checkGrounding on real answer phrasing', () => {
  it('treats "percentage points" and 个百分点 as percent, accepts truncation, and skips prose dates', () => {
    const results = [{ delta: -0.044, rate_a: 0.787365, behavior: -0.04462 }];
    const en = checkGrounding('Down 4.40 percentage points; integration 78.73% → 78.74%; behavior −4.46 percentage points.', results);
    expect(en.ungrounded).toEqual([]);
    expect(checkGrounding('a 4.40 percentage-point decline', results).ungrounded).toEqual([]);
    const zh = checkGrounding('下降 4.40 个百分点，组内 −4.46 个百分点。', results);
    expect(zh.ungrounded).toEqual([]);
    const dates = checkGrounding('No sessions for January 1–8, 2024 or December 25, 2023–January 1, 2024, nor 2024年1月8日.', []);
    expect(dates.checked).toBe(0);
    expect(checkGrounding('January 8 exclusive, 2024; baseline December 25, 2023', []).checked).toBe(0);
    // Counts keep their separators and are still checked.
    expect(checkGrounding('2,024 sessions', []).ungrounded).toEqual(['2,024']);
  });

  it('still flags a number that is neither rounded nor truncated from a tool value', () => {
    expect(checkGrounding('integration fell to 78.80%', [{ rate: 0.787365 }]).ungrounded).toEqual(['78.80%']);
    expect(checkGrounding('down 5.10 percentage points', [{ delta: -0.044 }]).ungrounded).toEqual(['5.10 percentage points']);
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
