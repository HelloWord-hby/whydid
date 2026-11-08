/**
 * Langfuse → whydid transforms. Pure functions, no I/O.
 *
 * whydid's semantic layer wants one wide table with one row per
 * conversation. Langfuse serves traces and scores separately, so the sync
 * flattens traces into rows and pivots numeric scores into `score_*`
 * columns — the same shape an internal analytics mart would have.
 */

/** Subset of GET /api/public/traces item fields the sync consumes. */
export interface LangfuseTrace {
  id: string;
  timestamp: string;
  name?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  release?: string | null;
  version?: string | null;
  environment?: string | null;
  /** Seconds, provided by the API's metrics field group. */
  latency?: number | null;
  totalCost?: number | null;
}

/** Subset of GET /api/public/v2/scores item fields the sync consumes. */
export interface LangfuseScore {
  id: string;
  traceId?: string | null;
  name: string;
  /** Numeric for NUMERIC and BOOLEAN scores; null for CATEGORICAL. */
  value?: number | null;
  dataType?: string | null;
  timestamp: string;
  /** Free-text reason attached to the score (judge rationale, user comment). */
  comment?: string | null;
}

export interface ConversationRow {
  id: string;
  created_at: string;
  name: string | null;
  user_id: string | null;
  session_id: string | null;
  release: string | null;
  version: string | null;
  environment: string | null;
  latency_sec: number | null;
  total_cost: number | null;
}

export interface ScoreRow {
  id: string;
  trace_id: string;
  name: string;
  value: number | null;
  data_type: string | null;
  ts: string;
}

export function traceToRow(t: LangfuseTrace): ConversationRow {
  return {
    id: t.id,
    created_at: t.timestamp,
    name: t.name ?? null,
    user_id: t.userId ?? null,
    session_id: t.sessionId ?? null,
    release: t.release ?? null,
    version: t.version ?? null,
    environment: t.environment ?? null,
    latency_sec: asFiniteNumber(t.latency),
    total_cost: asFiniteNumber(t.totalCost),
  };
}

/** Scores without a trace id or numeric value cannot be pivoted; drop them. */
export function scoreToRow(s: LangfuseScore): ScoreRow | null {
  if (!s.traceId) return null;
  return {
    id: s.id,
    trace_id: s.traceId,
    name: s.name,
    value: asFiniteNumber(s.value),
    data_type: s.dataType ?? null,
    ts: s.timestamp,
  };
}

const MAX_COLUMN_LENGTH = 55;

/**
 * Sanitize a score name into a `score_*` column identifier that passes
 * whydid's identifier validation. "QA-Relevance (v2)" → "score_qa_relevance_v2".
 */
export function scoreColumn(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_COLUMN_LENGTH)
    .replace(/_+$/g, '');
  return `score_${sanitized || 'unnamed'}`;
}

/**
 * Map score names to unique column names. Distinct names that sanitize to
 * the same identifier get deterministic numeric suffixes (sorted order),
 * so re-running the sync always produces the same schema.
 */
export function buildScoreColumnMap(names: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const name of [...new Set(names)].sort()) {
    const base = scoreColumn(name);
    let column = base;
    let suffix = 2;
    while (used.has(column)) {
      column = `${base}_${suffix++}`;
    }
    used.add(column);
    map.set(name, column);
  }
  return map;
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
