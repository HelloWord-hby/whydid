import { describe, expect, it } from 'vitest';
import { decomposeAdditive } from '../src/attribution/additive.js';

describe('decomposeAdditive', () => {
  it('conserves the total: driver deltas + others = total delta', () => {
    const a = [
      { segment: 'x', value: 100 },
      { segment: 'y', value: 200 },
      { segment: 'z', value: 50 },
    ];
    const b = [
      { segment: 'x', value: 150 },
      { segment: 'y', value: 180 },
      { segment: 'w', value: 30 },
    ];
    const result = decomposeAdditive(a, b, 10);

    expect(result.period_a_total).toBe(350);
    expect(result.period_b_total).toBe(360);
    expect(result.delta).toBe(10);

    const driverSum = [...result.growth_drivers, ...result.drag_drivers].reduce(
      (s, d) => s + d.delta,
      0
    );
    expect(driverSum + result.others.delta).toBe(result.delta);
  });

  it('handles segments missing from one period as zero', () => {
    const result = decomposeAdditive(
      [{ segment: 'gone', value: 40 }],
      [{ segment: 'new', value: 70 }],
      10
    );
    const gone = result.drag_drivers.find((d) => d.segment === 'gone');
    const fresh = result.growth_drivers.find((d) => d.segment === 'new');
    expect(gone?.delta).toBe(-40);
    expect(gone?.period_b).toBe(0);
    expect(fresh?.delta).toBe(70);
    expect(fresh?.period_a).toBe(0);
  });

  it('flags near-flat totals as unstable and nulls contribution_share', () => {
    // +100 and -99 cancel: total moves 1 on a base of 1000 (0.1% < 1%)
    const a = [
      { segment: 'up', value: 500 },
      { segment: 'down', value: 500 },
    ];
    const b = [
      { segment: 'up', value: 600 },
      { segment: 'down', value: 401 },
    ];
    const result = decomposeAdditive(a, b, 10);

    expect(result.stability).toBe('unstable');
    for (const d of [...result.growth_drivers, ...result.drag_drivers]) {
      expect(d.contribution_share).toBeNull();
      expect(d.abs_contribution_share).toBeGreaterThanOrEqual(0);
      expect(d.abs_contribution_share).toBeLessThanOrEqual(1);
    }
  });

  it('keeps contribution_share meaningful when stable', () => {
    const a = [
      { segment: 'x', value: 100 },
      { segment: 'y', value: 100 },
    ];
    const b = [
      { segment: 'x', value: 180 },
      { segment: 'y', value: 120 },
    ];
    const result = decomposeAdditive(a, b, 10);
    expect(result.stability).toBe('stable');
    const x = result.growth_drivers.find((d) => d.segment === 'x');
    const y = result.growth_drivers.find((d) => d.segment === 'y');
    expect(x?.contribution_share).toBeCloseTo(0.8);
    expect(y?.contribution_share).toBeCloseTo(0.2);
  });

  it('rolls segments beyond top_n into others', () => {
    const a = Array.from({ length: 5 }, (_, i) => ({ segment: `s${i}`, value: 10 }));
    const b = Array.from({ length: 5 }, (_, i) => ({ segment: `s${i}`, value: 20 + i }));
    const result = decomposeAdditive(a, b, 2);
    expect(result.growth_drivers.length + result.drag_drivers.length).toBe(2);
    const topDelta = [...result.growth_drivers, ...result.drag_drivers].reduce(
      (s, d) => s + d.delta,
      0
    );
    expect(topDelta + result.others.delta).toBe(result.delta);
  });

  it('handles an empty baseline without dividing by zero', () => {
    const result = decomposeAdditive([], [{ segment: 'x', value: 10 }], 10);
    expect(result.period_a_total).toBe(0);
    expect(result.delta).toBe(10);
    expect(result.delta_pct).toBeNull();
  });
});
