/**
 * Rate decomposition (Oaxaca-Blinder) — for average/ratio metrics.
 *
 * A global rate is a weighted average of per-segment rates, so it can move
 * for two very different reasons that demand different actions:
 *
 *   mix_effect      Σ (wB − wA) · rA        — the composition of traffic
 *                                             shifted toward segments that
 *                                             were already better or worse
 *                                             (nothing "broke")
 *   behavior_effect Σ wA · (rB − rA)        — segments themselves got better
 *                                             or worse (something actually
 *                                             changed inside them)
 *   interaction     Σ (wB − wA) · (rB − rA) — weight and rate moved together;
 *                                             genuinely mixed causation
 *
 * where wX is a segment's share of volume in period X and rX its rate.
 * This is the classic three-term Oaxaca-Blinder decomposition: the terms
 * sum exactly to the total rate change. When |interaction| exceeds 10% of
 * the total change, the mix/behavior split is flagged as approximate.
 */

export interface SegmentRate {
  segment: string;
  /** Number of rows contributing to the rate (AVG denominator). */
  count: number;
  /** Sum of the underlying per-row values (AVG numerator). */
  sum: number;
}

export interface RateDriver {
  segment: string;
  weight_a: number;
  weight_b: number;
  rate_a: number;
  rate_b: number;
  /** (wB − wA) · rA — contribution from the segment's share shifting. */
  mix_contribution: number;
  /** wA · (rB − rA) — contribution from the segment's own rate moving. */
  behavior_contribution: number;
  /** (wB − wA) · (rB − rA) — joint weight-and-rate movement. */
  interaction_contribution: number;
  total_contribution: number;
}

export interface RateResult {
  period_a_rate: number | null;
  period_b_rate: number | null;
  delta_rate: number | null;
  mix_effect: number;
  behavior_effect: number;
  interaction: number;
  /** true when |interaction| > 10% of |delta_rate| — interpret with caution. */
  interaction_warning: boolean;
  drivers: RateDriver[];
}

const INTERACTION_NOISE_RATIO = 0.1;

export function decomposeRate(
  periodA: SegmentRate[],
  periodB: SegmentRate[],
  topN = 10
): RateResult {
  const countA = periodA.reduce((s, r) => s + r.count, 0);
  const countB = periodB.reduce((s, r) => s + r.count, 0);

  if (countA === 0 || countB === 0) {
    return {
      period_a_rate: countA > 0 ? rateOf(periodA, countA) : null,
      period_b_rate: countB > 0 ? rateOf(periodB, countB) : null,
      delta_rate: null,
      mix_effect: 0,
      behavior_effect: 0,
      interaction: 0,
      interaction_warning: false,
      drivers: [],
    };
  }

  const globalA = rateOf(periodA, countA);
  const globalB = rateOf(periodB, countB);
  const deltaRate = globalB - globalA;

  const a = new Map(periodA.map((r) => [r.segment, r]));
  const b = new Map(periodB.map((r) => [r.segment, r]));
  const segments = new Set([...a.keys(), ...b.keys()]);

  let mixEffect = 0;
  let behaviorEffect = 0;
  let interaction = 0;

  const drivers: RateDriver[] = [...segments].map((segment) => {
    const ra = a.get(segment);
    const rb = b.get(segment);

    const wA = ra ? ra.count / countA : 0;
    const wB = rb ? rb.count / countB : 0;
    const rateA = ra && ra.count > 0 ? ra.sum / ra.count : 0;
    const rateB = rb && rb.count > 0 ? rb.sum / rb.count : 0;

    const mix = (wB - wA) * rateA;
    const behavior = wA * (rateB - rateA);
    const inter = (wB - wA) * (rateB - rateA);
    mixEffect += mix;
    behaviorEffect += behavior;
    interaction += inter;

    return {
      segment,
      weight_a: wA,
      weight_b: wB,
      rate_a: rateA,
      rate_b: rateB,
      mix_contribution: mix,
      behavior_contribution: behavior,
      interaction_contribution: inter,
      total_contribution: mix + behavior + inter,
    };
  });

  const interactionWarning =
    deltaRate !== 0 && Math.abs(interaction / deltaRate) > INTERACTION_NOISE_RATIO;

  drivers.sort(
    (x, y) => Math.abs(y.total_contribution) - Math.abs(x.total_contribution)
  );

  return {
    period_a_rate: globalA,
    period_b_rate: globalB,
    delta_rate: deltaRate,
    mix_effect: mixEffect,
    behavior_effect: behaviorEffect,
    interaction,
    interaction_warning: interactionWarning,
    drivers: drivers.slice(0, topN),
  };
}

function rateOf(rows: SegmentRate[], totalCount: number): number {
  const totalSum = rows.reduce((s, r) => s + r.sum, 0);
  return totalSum / totalCount;
}
