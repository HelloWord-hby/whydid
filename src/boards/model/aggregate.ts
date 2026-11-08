/**
 * Model-output aggregates — pure functions over traces and scores.
 *
 * Both the live Langfuse source and the demo generator produce a
 * ModelDataset; every model-output card is computed here, so the numbers
 * on the board are reproducible from the raw records and unit-tested.
 */

export interface ModelTrace {
  id: string;
  timestamp: string;
  name: string | null;
  release: string | null;
  latency: number | null;
  cost: number | null;
}

export interface ModelScore {
  traceId: string | null;
  name: string;
  value: number | null;
  dataType: string | null;
  timestamp: string;
  comment: string | null;
}

export interface ModelDataset {
  traces: ModelTrace[];
  scores: ModelScore[];
  /** True when the live fetch hit its page cap and the data is incomplete. */
  truncated: boolean;
}

export interface ModelSettings {
  /** Name of the end-user feedback score (thumbs up/down). */
  feedback_score: string;
  /** Value of the feedback score that means "thumbs down". */
  negative_feedback_value: number;
  /** Quality scores strictly below this count as low. */
  low_score_threshold: number;
}

export interface Period {
  from: string;
  to: string;
}

export type LowScoreGroup = 'score' | 'route' | 'release';

export interface LowScoreRow {
  group: string;
  n: number;
  low: number;
  low_rate: number | null;
}

function inPeriod(ts: string, p: Period): boolean {
  const day = ts.slice(0, 10);
  return day >= p.from && day < p.to;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Quality scores are NUMERIC judge scores where higher is better. BOOLEAN
 * scores are left out: their polarity is unknown (hallucinated=1 is bad),
 * so "below threshold = low" would silently invert them.
 */
function isQualityScore(s: ModelScore, settings: ModelSettings): boolean {
  return (
    s.name !== settings.feedback_score &&
    s.dataType !== 'CATEGORICAL' &&
    s.dataType !== 'BOOLEAN' &&
    s.value != null
  );
}

function traceIndex(ds: ModelDataset): Map<string, ModelTrace> {
  return new Map(ds.traces.map((t) => [t.id, t]));
}

export function traceCount(ds: ModelDataset, p: Period): number {
  return ds.traces.filter((t) => inPeriod(t.timestamp, p)).length;
}

export function dailyTraceCounts(ds: ModelDataset, days: string[]): Array<{ t: string; v: number }> {
  const counts = new Map<string, number>(days.map((d) => [d, 0]));
  for (const t of ds.traces) {
    const day = t.timestamp.slice(0, 10);
    const c = counts.get(day);
    if (c !== undefined) counts.set(day, c + 1);
  }
  return days.map((d) => ({ t: d, v: counts.get(d) ?? 0 }));
}

export function traceFieldAverage(
  ds: ModelDataset,
  p: Period,
  field: 'latency' | 'cost'
): number | null {
  const values = ds.traces
    .filter((t) => inPeriod(t.timestamp, p))
    .map((t) => t[field])
    .filter((v): v is number => v != null);
  return mean(values);
}

/** Quality score names present in the data (feedback and categorical excluded). */
export function qualityScoreNames(ds: ModelDataset, settings: ModelSettings): string[] {
  const names = new Set<string>();
  for (const s of ds.scores) if (isQualityScore(s, settings)) names.add(s.name);
  return [...names].sort();
}

export function scoreAverage(ds: ModelDataset, name: string, p: Period): number | null {
  return mean(
    ds.scores
      .filter((s) => s.name === name && s.value != null && inPeriod(s.timestamp, p))
      .map((s) => s.value as number)
  );
}

export function dailyScoreAverages(
  ds: ModelDataset,
  name: string,
  days: string[]
): Array<{ t: string; v: number | null }> {
  const buckets = new Map<string, number[]>(days.map((d) => [d, []]));
  for (const s of ds.scores) {
    if (s.name !== name || s.value == null) continue;
    buckets.get(s.timestamp.slice(0, 10))?.push(s.value);
  }
  return days.map((d) => ({ t: d, v: mean(buckets.get(d) ?? []) }));
}

/**
 * Low-score rate grouped by score name, route (trace name) or release.
 * A score is "low" when value < threshold. Only quality scores count.
 */
export function lowScoreStats(
  ds: ModelDataset,
  p: Period,
  settings: ModelSettings,
  groupBy: LowScoreGroup,
  onlyScore?: string
): LowScoreRow[] {
  const traces = traceIndex(ds);
  const acc = new Map<string, { n: number; low: number }>();
  for (const s of ds.scores) {
    if (!isQualityScore(s, settings) || !inPeriod(s.timestamp, p)) continue;
    if (onlyScore && s.name !== onlyScore) continue;
    const trace = s.traceId ? traces.get(s.traceId) : undefined;
    const key =
      groupBy === 'score'
        ? s.name
        : groupBy === 'route'
          ? (trace?.name ?? '(none)')
          : (trace?.release ?? '(none)');
    const entry = acc.get(key) ?? { n: 0, low: 0 };
    entry.n += 1;
    if ((s.value as number) < settings.low_score_threshold) entry.low += 1;
    acc.set(key, entry);
  }
  return [...acc.entries()]
    .map(([group, { n, low }]) => ({ group, n, low, low_rate: n === 0 ? null : low / n }))
    .sort((a, b) => (b.low_rate ?? 0) - (a.low_rate ?? 0) || a.group.localeCompare(b.group));
}

export interface ScoreSample {
  timestamp: string;
  trace_id: string;
  route: string;
  release: string;
  score: string;
  value: number;
  comment: string;
}

function toSample(s: ModelScore, traces: Map<string, ModelTrace>): ScoreSample {
  const trace = s.traceId ? traces.get(s.traceId) : undefined;
  return {
    timestamp: s.timestamp,
    trace_id: s.traceId ?? '',
    route: trace?.name ?? '',
    release: trace?.release ?? '',
    score: s.name,
    value: s.value as number,
    comment: s.comment ?? '',
  };
}

/** Lowest-scoring quality scores in the period, worst first, newest first on ties. */
export function lowScoreSamples(
  ds: ModelDataset,
  p: Period,
  settings: ModelSettings,
  limit: number
): ScoreSample[] {
  const traces = traceIndex(ds);
  return ds.scores
    .filter(
      (s) =>
        isQualityScore(s, settings) &&
        inPeriod(s.timestamp, p) &&
        (s.value as number) < settings.low_score_threshold
    )
    .sort((a, b) => (a.value as number) - (b.value as number) || b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map((s) => toSample(s, traces));
}

export interface FeedbackStats {
  total: number;
  negative: number;
  negative_rate: number | null;
}

export function feedbackStats(ds: ModelDataset, p: Period, settings: ModelSettings): FeedbackStats {
  let total = 0;
  let negative = 0;
  for (const s of ds.scores) {
    if (s.name !== settings.feedback_score || s.value == null || !inPeriod(s.timestamp, p)) continue;
    total += 1;
    if (s.value === settings.negative_feedback_value) negative += 1;
  }
  return { total, negative, negative_rate: total === 0 ? null : negative / total };
}

export interface FeedbackGroupRow {
  group: string;
  rated: number;
  negative: number;
  negative_rate: number | null;
}

/** Thumbs-down rate per route or release, highest rate first. */
export function feedbackByGroup(
  ds: ModelDataset,
  p: Period,
  settings: ModelSettings,
  groupBy: 'route' | 'release'
): FeedbackGroupRow[] {
  const traces = traceIndex(ds);
  const acc = new Map<string, { rated: number; negative: number }>();
  for (const s of ds.scores) {
    if (s.name !== settings.feedback_score || s.value == null || !inPeriod(s.timestamp, p)) continue;
    const trace = s.traceId ? traces.get(s.traceId) : undefined;
    const key = (groupBy === 'route' ? trace?.name : trace?.release) ?? '(none)';
    const entry = acc.get(key) ?? { rated: 0, negative: 0 };
    entry.rated += 1;
    if (s.value === settings.negative_feedback_value) entry.negative += 1;
    acc.set(key, entry);
  }
  return [...acc.entries()]
    .map(([group, { rated, negative }]) => ({
      group,
      rated,
      negative,
      negative_rate: rated === 0 ? null : negative / rated,
    }))
    .sort((a, b) => (b.negative_rate ?? 0) - (a.negative_rate ?? 0) || a.group.localeCompare(b.group));
}

/** Thumbs-down feedback in the period, newest first. */
export function negativeFeedbackSamples(
  ds: ModelDataset,
  p: Period,
  settings: ModelSettings,
  limit: number
): ScoreSample[] {
  const traces = traceIndex(ds);
  return ds.scores
    .filter(
      (s) =>
        s.name === settings.feedback_score &&
        s.value === settings.negative_feedback_value &&
        inPeriod(s.timestamp, p)
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
    .map((s) => toSample(s, traces));
}
