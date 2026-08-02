/**
 * Additive decomposition — for count/sum metrics.
 *
 * The total change between two periods is exactly the sum of per-segment
 * changes, so attribution is a matter of ranking segments by their delta
 * and being honest about when the ranking is meaningful.
 *
 * Two honesty guards baked into the math:
 *
 * 1. Stability. When the total barely moved (|Δ| < 1% of baseline),
 *    "share of total delta" explodes — a segment can show +900% share of a
 *    near-zero change. In that case contribution_share is null and the
 *    result is flagged unstable, so the narrating LLM cannot quote a
 *    meaningless percentage.
 *
 * 2. Offsetting moves. When big positive and negative segment moves cancel
 *    out, abs_contribution_share (|Δᵢ| / Σ|Δⱼ|) still ranks segments
 *    sensibly. It is always in [0, 1] regardless of the total.
 */

export interface SegmentValue {
  segment: string;
  value: number;
}

export interface AdditiveDriver {
  segment: string;
  period_a: number;
  period_b: number;
  delta: number;
  /** Delta as percentage points of the period-A total. */
  contribution_pp: number;
  /** Share of the total delta. null when the decomposition is unstable. */
  contribution_share: number | null;
  /** |delta| / Σ|delta| — stable ranking signal, always within [0, 1]. */
  abs_contribution_share: number;
}

export interface AdditiveResult {
  period_a_total: number;
  period_b_total: number;
  delta: number;
  delta_pct: number | null;
  /** 'unstable' when |delta| < 1% of the period-A total. */
  stability: 'stable' | 'unstable';
  growth_drivers: AdditiveDriver[];
  drag_drivers: AdditiveDriver[];
  /** Aggregate of segments beyond top_n. */
  others: { delta: number; contribution_pp: number };
}

const STABILITY_THRESHOLD = 0.01;

export function decomposeAdditive(
  periodA: SegmentValue[],
  periodB: SegmentValue[],
  topN = 10
): AdditiveResult {
  const a = new Map(periodA.map((r) => [r.segment, r.value]));
  const b = new Map(periodB.map((r) => [r.segment, r.value]));

  const totalA = sum([...a.values()]);
  const totalB = sum([...b.values()]);
  const delta = totalB - totalA;

  const stable = totalA !== 0 && Math.abs(delta / totalA) >= STABILITY_THRESHOLD;

  const segments = new Set([...a.keys(), ...b.keys()]);
  const sumAbsDelta = sum(
    [...segments].map((s) => Math.abs((b.get(s) ?? 0) - (a.get(s) ?? 0)))
  );

  const drivers: AdditiveDriver[] = [...segments]
    .map((segment) => {
      const va = a.get(segment) ?? 0;
      const vb = b.get(segment) ?? 0;
      const d = vb - va;
      return {
        segment,
        period_a: va,
        period_b: vb,
        delta: d,
        contribution_pp: totalA === 0 ? 0 : (d / totalA) * 100,
        contribution_share: stable && delta !== 0 ? d / delta : null,
        abs_contribution_share: sumAbsDelta === 0 ? 0 : Math.abs(d) / sumAbsDelta,
      };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const top = drivers.slice(0, topN);
  const othersDelta = sum(drivers.slice(topN).map((d) => d.delta));

  return {
    period_a_total: totalA,
    period_b_total: totalB,
    delta,
    delta_pct: totalA !== 0 ? (delta / totalA) * 100 : null,
    stability: stable ? 'stable' : 'unstable',
    growth_drivers: top.filter((d) => d.delta > 0),
    drag_drivers: top.filter((d) => d.delta < 0),
    others: {
      delta: othersDelta,
      contribution_pp: totalA === 0 ? 0 : (othersDelta / totalA) * 100,
    },
  };
}

function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}
