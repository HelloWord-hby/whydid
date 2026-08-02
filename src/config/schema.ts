/**
 * Config schema — the semantic layer of whydid.
 *
 * Everything the agent knows about YOUR data lives in one YAML file:
 * which table, which metrics, which dimensions, and any caveats the LLM
 * should be told about (coverage gaps, definition quirks, etc.).
 *
 * The SQL expressions in this file are trusted operator input — they are
 * written by whoever deploys whydid, never by the LLM. The LLM can only
 * pick metric/dimension names from the enums derived from this config.
 */
import { z } from 'zod';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate a SQL identifier (optionally schema-qualified for tables). */
export function assertIdentifier(name: string, allowQualified = false): void {
  const parts = allowQualified ? name.split('.') : [name];
  for (const part of parts) {
    if (!IDENTIFIER.test(part)) {
      throw new Error(
        `Invalid SQL identifier "${name}". Only letters, digits and underscores are allowed.`
      );
    }
  }
}

/** Quote an identifier (each dot-separated part) for safe interpolation. */
export function quoteIdentifier(name: string): string {
  return name
    .split('.')
    .map((p) => `"${p}"`)
    .join('.');
}

export const metricSchema = z
  .object({
    /**
     * additive — counts/sums. Decomposed by summing per-segment deltas.
     * rate — averages/ratios. Decomposed with Oaxaca-Blinder (mix vs behavior).
     */
    kind: z.enum(['additive', 'rate']),
    /** SQL aggregate expression for additive metrics, e.g. COUNT(DISTINCT session_id). */
    expr: z.string().optional(),
    /**
     * For rate metrics: the per-row expression E such that metric = AVG(E).
     * e.g. "CASE WHEN resolved THEN 1.0 ELSE 0.0 END" for a resolution rate,
     * or "latency_ms" for an average latency. Rows where E is NULL are excluded.
     */
    of: z.string().optional(),
    label: z.string().optional(),
    unit: z.string().optional(),
    /** Set false to forbid decomposition (e.g. metrics with tiny sample sizes). */
    decompose: z.boolean().default(true),
    /** Caveat injected into the system prompt, e.g. "self-reported, trend-only". */
    note: z.string().optional(),
  })
  .superRefine((m, ctx) => {
    if (m.kind === 'additive' && !m.expr) {
      ctx.addIssue({ code: 'custom', message: 'additive metrics require "expr"' });
    }
    if (m.kind === 'rate' && !m.of) {
      ctx.addIssue({ code: 'custom', message: 'rate metrics require "of"' });
    }
  });

export const dimensionSchema = z.object({
  /** Column name in the table. */
  column: z.string(),
  label: z.string().optional(),
  /** Optional raw value → display label map, injected into tool results. */
  values: z.record(z.string(), z.string()).optional(),
  /** Caveat injected into the system prompt, e.g. "only populated since 2026-02". */
  note: z.string().optional(),
});

export const configSchema = z.object({
  /** Table or view holding one row per event/conversation. May be schema-qualified. */
  table: z.string(),
  /** Timestamp column used for all period filtering (timestamptz recommended). */
  time_column: z.string(),
  /** IANA timezone for interpreting dates and bucketing days. */
  timezone: z.string().default('UTC'),
  /** Earliest date with data (YYYY-MM-DD). Queries before this are rejected. */
  data_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Free-text product context injected into the system prompt. */
  context: z.string().optional(),
  metrics: z.record(z.string(), metricSchema),
  dimensions: z.record(z.string(), dimensionSchema),
});

export type MetricDef = z.infer<typeof metricSchema>;
export type DimensionDef = z.infer<typeof dimensionSchema>;
export type WhydidConfig = z.infer<typeof configSchema>;

/** Validate identifiers and cross-references after zod parsing. */
export function validateConfig(config: WhydidConfig): WhydidConfig {
  assertIdentifier(config.table, true);
  assertIdentifier(config.time_column);
  for (const [name, dim] of Object.entries(config.dimensions)) {
    assertIdentifier(name);
    assertIdentifier(dim.column);
  }
  for (const name of Object.keys(config.metrics)) {
    assertIdentifier(name);
  }
  if (Object.keys(config.metrics).length === 0) {
    throw new Error('Config must define at least one metric.');
  }
  return config;
}

/** SQL aggregate expression for a metric (derived for rate metrics). */
export function metricExpr(def: MetricDef): string {
  return def.kind === 'additive' ? def.expr! : `AVG(${def.of!})`;
}

// Own-property lookups everywhere below: a name like "__proto__" or
// "constructor" must be treated as unknown, not resolved up the prototype
// chain into something truthy.

export function getMetricOrThrow(config: WhydidConfig, name: string): MetricDef {
  const def = Object.hasOwn(config.metrics, name) ? config.metrics[name] : undefined;
  if (!def) {
    throw new Error(
      `Unknown metric "${name}". Available: ${Object.keys(config.metrics).join(', ')}`
    );
  }
  return def;
}

export function getDimensionOrThrow(config: WhydidConfig, name: string): DimensionDef {
  const def = Object.hasOwn(config.dimensions, name) ? config.dimensions[name] : undefined;
  if (!def) {
    throw new Error(
      `Unknown dimension "${name}". Available: ${Object.keys(config.dimensions).join(', ')}`
    );
  }
  return def;
}

/** Translate a raw dimension value to its display label, if one is configured. */
export function labelForValue(dim: DimensionDef, value: string): string | undefined {
  return dim.values && Object.hasOwn(dim.values, value) ? dim.values[value] : undefined;
}
