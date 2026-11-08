/**
 * Drill-down hints — deterministic "what to look at next" suggestions
 * attached to tool results. Code decides when a result is worth drilling
 * into (thresholds below); the LLM decides whether to follow.
 *
 * Keeping these rules here instead of in the prompt keeps the prompt short
 * and makes every rule unit-testable.
 */
import { type WhydidConfig } from '../config/schema.js';

/** |relative change| at or above this many percent is worth decomposing. */
export const MATERIAL_CHANGE_PCT = 5;
/** A low-score rate difference of this many percentage points is worth a look. */
export const MATERIAL_RATE_PP = 2;

interface CompareLike {
  metric: string;
  delta_pct: number | null;
}

interface AdditiveLike {
  dimension: string;
  growth_drivers?: Array<{ segment: string; delta: number }>;
  drag_drivers?: Array<{ segment: string; delta: number }>;
}

interface RateLike {
  dimension: string;
  mix_effect?: number;
  behavior_effect?: number;
  drivers?: Array<{ segment: string; total_contribution: number }>;
}

interface TrendLike {
  points?: Array<{ bucket: string; outlier?: 'high' | 'low' }>;
}

function otherDimensions(config: WhydidConfig, exclude: string): string[] {
  return Object.keys(config.dimensions).filter((d) => d !== exclude);
}

export function hintsForSemantic(
  tool: string,
  result: unknown,
  config: WhydidConfig,
  source: string
): string[] {
  const hints: string[] = [];
  if (tool === 'compare_periods') {
    const r = result as CompareLike;
    if (r.delta_pct != null && Math.abs(r.delta_pct) >= MATERIAL_CHANGE_PCT) {
      const kind = config.metrics[r.metric]?.kind;
      const decomposer = kind === 'rate' ? 'decompose_change_rate' : 'decompose_change_additive';
      hints.push(
        `The change is material (|delta_pct| ≥ ${MATERIAL_CHANGE_PCT}). Next: ${decomposer} on source "${source}" along one of: ${Object.keys(config.dimensions).join(', ')}.`
      );
    } else if (r.delta_pct != null) {
      hints.push(`The change is below ${MATERIAL_CHANGE_PCT}% — it may be noise; say so before decomposing.`);
    }
  }
  if (tool === 'decompose_change_additive') {
    const r = result as AdditiveLike;
    const all = [...(r.growth_drivers ?? []), ...(r.drag_drivers ?? [])].sort(
      (a, b) => Math.abs(b.delta) - Math.abs(a.delta)
    );
    const top = all[0];
    if (top) {
      hints.push(
        `Top driver is ${r.dimension}="${top.segment}". Next: drill in with filters {"${r.dimension}": "${top.segment}"} and break down by ${otherDimensions(config, r.dimension).join(' or ') || 'another dimension'}.`
      );
    }
  }
  if (tool === 'decompose_change_rate') {
    const r = result as RateLike;
    const top = [...(r.drivers ?? [])].sort(
      (a, b) => Math.abs(b.total_contribution) - Math.abs(a.total_contribution)
    )[0];
    if (top) {
      const behavior = Math.abs(r.behavior_effect ?? 0) >= Math.abs(r.mix_effect ?? 0);
      hints.push(
        behavior
          ? `Behavior effect dominates: segments themselves changed. Drill into ${r.dimension}="${top.segment}" with filters and another dimension.`
          : `Mix effect dominates: traffic composition shifted. Check which ${r.dimension} segments grew or shrank with get_metric grouped by ${r.dimension}.`
      );
    }
  }
  if (tool === 'get_metric_trend') {
    const r = result as TrendLike;
    const outliers = (r.points ?? []).filter((p) => p.outlier).map((p) => `${p.bucket} (${p.outlier})`);
    if (outliers.length) {
      hints.push(`Outlier buckets: ${outliers.join(', ')}. Name them in the answer and check what differs on those days.`);
    }
  }
  return hints;
}

export interface LowScoreRowLike {
  group: string;
  low_rate: number | null;
  previous_low_rate: number | null;
}

/** Point at the group whose low-score rate rose the most, if material. */
export function hintsForLowScore(rows: LowScoreRowLike[], groupBy: string, score?: string): string[] {
  const rising = rows
    .filter((r) => r.low_rate != null && r.previous_low_rate != null)
    .map((r) => ({ group: r.group, rise: (r.low_rate as number) - (r.previous_low_rate as number) }))
    .sort((a, b) => b.rise - a.rise)[0];
  if (!rising || rising.rise * 100 < MATERIAL_RATE_PP) return [];
  const filterKey = groupBy === 'score' ? 'score' : groupBy;
  return [
    `Low-score rate of ${groupBy}="${rising.group}" rose by at least ${MATERIAL_RATE_PP} pp vs the baseline. Next: low_score_samples with ${filterKey}="${rising.group}"${score && groupBy !== 'score' ? ` and score="${score}"` : ''} to read concrete cases.`,
  ];
}
