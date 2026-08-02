/**
 * Tool registry — JSON schemas for the LLM and the dispatch table.
 *
 * Schemas are generated from the config so the LLM literally cannot name a
 * metric or dimension that does not exist: they are enum-constrained, and
 * anything else fails validation before touching the database.
 */
import { z } from 'zod';
import { type WhydidConfig } from '../config/schema.js';
import { GRANULARITIES } from '../core/sql-builder.js';
import { type ToolContext } from './context.js';
import { getMetric } from './get-metric.js';
import { getMetricTrend } from './get-metric-trend.js';
import { comparePeriods } from './compare-periods.js';
import { decomposeChangeAdditive } from './decompose-additive.js';
import { decomposeChangeRate } from './decompose-rate.js';

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const PERIOD_SCHEMA = {
  type: 'object',
  description: 'Half-open ISO date interval [from, to): from is inclusive, to is exclusive.',
  properties: {
    from: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
    to: { type: 'string', description: 'YYYY-MM-DD, exclusive' },
  },
  required: ['from', 'to'],
} as const;

function filtersSchema(config: WhydidConfig) {
  return {
    type: 'object',
    description:
      'Optional filters: dimension name → value (or array of values). ' +
      `Available dimensions: ${Object.keys(config.dimensions).join(', ')}`,
    additionalProperties: {
      anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    },
  };
}

export function buildToolSchemas(config: WhydidConfig): ToolSchema[] {
  const metricNames = Object.keys(config.metrics);
  const dimensionNames = Object.keys(config.dimensions);
  const additiveDecomposable = metricNames.filter(
    (m) => config.metrics[m]!.kind === 'additive' && config.metrics[m]!.decompose
  );
  const rateDecomposable = metricNames.filter(
    (m) => config.metrics[m]!.kind === 'rate' && config.metrics[m]!.decompose
  );

  const schemas: ToolSchema[] = [
    {
      type: 'function',
      function: {
        name: 'get_metric',
        description:
          'Get a single metric value over a period, optionally split by one dimension.',
        parameters: {
          type: 'object',
          properties: {
            metric: { type: 'string', enum: metricNames },
            period: PERIOD_SCHEMA,
            group_by: { type: 'string', enum: dimensionNames },
            filters: filtersSchema(config),
          },
          required: ['metric', 'period'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_metric_trend',
        description:
          'Get a metric per time bucket over a period. Points more than 2 standard deviations from the window mean are flagged as outliers.',
        parameters: {
          type: 'object',
          properties: {
            metric: { type: 'string', enum: metricNames },
            period: PERIOD_SCHEMA,
            granularity: { type: 'string', enum: [...GRANULARITIES] },
            filters: filtersSchema(config),
          },
          required: ['metric', 'period', 'granularity'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'compare_periods',
        description:
          'Compare a metric between the current period (period_b) and an equal-length baseline. ' +
          'Give period_a explicitly, or set compare_to and the baseline is derived for you (default prev_period).',
        parameters: {
          type: 'object',
          properties: {
            metric: { type: 'string', enum: metricNames },
            period_b: { ...PERIOD_SCHEMA, description: 'The CURRENT period under investigation.' },
            period_a: { ...PERIOD_SCHEMA, description: 'Optional explicit baseline period.' },
            compare_to: {
              type: 'string',
              enum: ['prev_period', 'prev_week', 'prev_month'],
              description: 'How to derive the baseline when period_a is not given.',
            },
            filters: filtersSchema(config),
          },
          required: ['metric', 'period_b'],
        },
      },
    },
  ];

  if (additiveDecomposable.length > 0) {
    schemas.push({
      type: 'function',
      function: {
        name: 'decompose_change_additive',
        description:
          'Split the change of a COUNT/SUM metric between two equal-length periods into per-segment contributions along one dimension. Only valid for additive metrics.',
        parameters: {
          type: 'object',
          properties: {
            metric: { type: 'string', enum: additiveDecomposable },
            period_a: { ...PERIOD_SCHEMA, description: 'Baseline period.' },
            period_b: { ...PERIOD_SCHEMA, description: 'Current period.' },
            dimension: { type: 'string', enum: dimensionNames },
            top_n: { type: 'number', description: 'Max segments to return (default 10).' },
            filters: filtersSchema(config),
          },
          required: ['metric', 'period_a', 'period_b', 'dimension'],
        },
      },
    });
  }

  if (rateDecomposable.length > 0) {
    schemas.push({
      type: 'function',
      function: {
        name: 'decompose_change_rate',
        description:
          'Oaxaca-Blinder decomposition of a RATE/AVERAGE metric change between two equal-length periods: ' +
          'splits the change into mix effect (traffic composition shifted) vs behavior effect (segments themselves changed). Only valid for rate metrics.',
        parameters: {
          type: 'object',
          properties: {
            metric: { type: 'string', enum: rateDecomposable },
            period_a: { ...PERIOD_SCHEMA, description: 'Baseline period.' },
            period_b: { ...PERIOD_SCHEMA, description: 'Current period.' },
            dimension: { type: 'string', enum: dimensionNames },
            top_n: { type: 'number', description: 'Max segments to return (default 10).' },
            filters: filtersSchema(config),
          },
          required: ['metric', 'period_a', 'period_b', 'dimension'],
        },
      },
    });
  }

  return schemas;
}

// ── Runtime validation of LLM-provided arguments ──
// The LLM's JSON is untrusted input: every tool call is validated against a
// zod schema before dispatch, so handlers receive well-typed arguments and
// the LLM receives actionable validation errors instead of stack traces.

const periodArg = z.object({ from: z.string(), to: z.string() }).strict();
const filtersArg = z
  .record(z.string(), z.union([z.string(), z.array(z.string())]))
  .optional();

function defineTool<S extends z.ZodType>(
  schema: S,
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>
) {
  return {
    schema: schema as z.ZodType,
    run: run as (ctx: ToolContext, args: unknown) => Promise<unknown>,
  };
}

const TOOLS = {
  get_metric: defineTool(
    z
      .object({
        metric: z.string(),
        period: periodArg,
        group_by: z.string().optional(),
        filters: filtersArg,
      })
      .strict(),
    getMetric
  ),
  get_metric_trend: defineTool(
    z
      .object({
        metric: z.string(),
        period: periodArg,
        granularity: z.enum(GRANULARITIES),
        filters: filtersArg,
      })
      .strict(),
    getMetricTrend
  ),
  compare_periods: defineTool(
    z
      .object({
        metric: z.string(),
        period_b: periodArg,
        period_a: periodArg.optional(),
        compare_to: z.enum(['prev_period', 'prev_week', 'prev_month']).optional(),
        filters: filtersArg,
      })
      .strict(),
    comparePeriods
  ),
  decompose_change_additive: defineTool(
    z
      .object({
        metric: z.string(),
        period_a: periodArg,
        period_b: periodArg,
        dimension: z.string(),
        top_n: z.number().int().min(1).max(100).optional(),
        filters: filtersArg,
      })
      .strict(),
    decomposeChangeAdditive
  ),
  decompose_change_rate: defineTool(
    z
      .object({
        metric: z.string(),
        period_a: periodArg,
        period_b: periodArg,
        dimension: z.string(),
        top_n: z.number().int().min(1).max(100).optional(),
        filters: filtersArg,
      })
      .strict(),
    decomposeChangeRate
  ),
};

export function listToolNames(): string[] {
  return Object.keys(TOOLS);
}

export async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name as keyof typeof TOOLS] : undefined;
  if (!tool) {
    throw new Error(`Unknown tool "${name}". Available: ${listToolNames().join(', ')}`);
  }
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid arguments for ${name} — ${issues}`);
  }
  return tool.run(ctx, parsed.data);
}
