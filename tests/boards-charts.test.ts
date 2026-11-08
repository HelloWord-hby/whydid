import { describe, expect, it } from 'vitest';
import { buildBar, buildPie, OTHER_LABEL } from '../src/boards/charts.js';

const segs = [
  { label: 'a', value: 50 },
  { label: 'b', value: 30 },
  { label: 'c', value: 10 },
  { label: 'd', value: 6 },
  { label: 'e', value: 4 },
];

describe('buildPie', () => {
  it('keeps every slice when under the cap, shares summing to 1', () => {
    const pie = buildPie(segs, 'int', 10);
    expect(pie.total).toBe(100);
    expect(pie.slices.map((s) => s.label)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(pie.slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  it('merges the tail into Other so the slice count equals the cap', () => {
    const pie = buildPie(segs, 'int', 3);
    expect(pie.slices).toEqual([
      { label: 'a', value: 50, share: 0.5 },
      { label: 'b', value: 30, share: 0.3 },
      { label: OTHER_LABEL, value: 20, share: 0.2 },
    ]);
  });

  it('sorts largest first and drops zero or negative segments', () => {
    const pie = buildPie(
      [
        { label: 'small', value: 1 },
        { label: 'zero', value: 0 },
        { label: 'neg', value: -5 },
        { label: 'big', value: 3 },
      ],
      'int',
      10
    );
    expect(pie.slices.map((s) => s.label)).toEqual(['big', 'small']);
    expect(pie.total).toBe(4);
  });

  it('handles an empty input', () => {
    expect(buildPie([], 'int', 5)).toMatchObject({ total: 0, slices: [] });
  });
});

describe('buildBar', () => {
  it('keeps input order and adds shares only when asked', () => {
    const plain = buildBar(segs.slice(0, 2), 'int');
    expect(plain.items).toEqual([
      { label: 'a', value: 50, share: null },
      { label: 'b', value: 30, share: null },
    ]);
    expect(plain.share_label).toBeUndefined();

    const shared = buildBar(segs.slice(0, 2), 'int', { withShare: true });
    expect(shared.items.map((i) => i.share)).toEqual([50 / 80, 30 / 80]);
    expect(shared.share_label).toBe('of total');
  });

  it('computes shares over every segment before cutting to the limit', () => {
    const top2 = buildBar(segs, 'int', { withShare: true, limit: 2 });
    expect(top2.items).toEqual([
      { label: 'a', value: 50, share: 0.5 },
      { label: 'b', value: 30, share: 0.3 },
    ]);
  });
});
