import { describe, expect, it } from 'vitest';
import { decomposeRate } from '../src/attribution/rate.js';

describe('decomposeRate (Oaxaca-Blinder)', () => {
  it('mix + behavior + interaction exactly equals the total rate change', () => {
    const a = [
      { segment: 'x', count: 100, sum: 80 },
      { segment: 'y', count: 200, sum: 100 },
    ];
    const b = [
      { segment: 'x', count: 300, sum: 210 },
      { segment: 'y', count: 150, sum: 90 },
    ];
    const result = decomposeRate(a, b, 10);

    const globalA = 180 / 300;
    const globalB = 300 / 450;
    expect(result.period_a_rate).toBeCloseTo(globalA, 10);
    expect(result.period_b_rate).toBeCloseTo(globalB, 10);
    expect(
      result.mix_effect + result.behavior_effect + result.interaction
    ).toBeCloseTo(result.delta_rate!, 10);
  });

  it('pure mix shift yields zero behavior effect', () => {
    // Per-segment rates identical across periods; only weights move.
    const a = [
      { segment: 'good', count: 100, sum: 90 }, // rate 0.9
      { segment: 'bad', count: 100, sum: 50 }, // rate 0.5
    ];
    const b = [
      { segment: 'good', count: 50, sum: 45 }, // rate 0.9
      { segment: 'bad', count: 150, sum: 75 }, // rate 0.5
    ];
    const result = decomposeRate(a, b, 10);
    expect(result.behavior_effect).toBeCloseTo(0, 10);
    expect(result.mix_effect).toBeLessThan(0); // shifted toward the worse segment
  });

  it('pure behavior change yields zero mix effect', () => {
    // Weights identical; one segment's rate drops.
    const a = [
      { segment: 'x', count: 100, sum: 80 },
      { segment: 'y', count: 100, sum: 70 },
    ];
    const b = [
      { segment: 'x', count: 100, sum: 40 }, // rate 0.8 → 0.4
      { segment: 'y', count: 100, sum: 70 },
    ];
    const result = decomposeRate(a, b, 10);
    expect(result.mix_effect).toBeCloseTo(0, 10);
    expect(result.behavior_effect).toBeCloseTo(-0.2, 10);
    const x = result.drivers.find((d) => d.segment === 'x');
    expect(x?.behavior_contribution).toBeCloseTo(-0.2, 10);
  });

  it('returns nulls instead of fake zeros when a period is empty', () => {
    const result = decomposeRate([], [{ segment: 'x', count: 10, sum: 5 }], 10);
    expect(result.delta_rate).toBeNull();
    expect(result.period_a_rate).toBeNull();
    expect(result.period_b_rate).toBeCloseTo(0.5);
    expect(result.drivers).toHaveLength(0);
  });

  it('flags noisy decompositions via interaction_warning', () => {
    // Large simultaneous weight and rate swings produce a large interaction.
    const a = [
      { segment: 'x', count: 10, sum: 1 },
      { segment: 'y', count: 990, sum: 900 },
    ];
    const b = [
      { segment: 'x', count: 900, sum: 850 },
      { segment: 'y', count: 100, sum: 10 },
    ];
    const result = decomposeRate(a, b, 10);
    expect(
      result.mix_effect + result.behavior_effect + result.interaction
    ).toBeCloseTo(result.delta_rate!, 10);
    expect(result.interaction_warning).toBe(true);
  });
});
