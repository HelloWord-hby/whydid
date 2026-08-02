import { describe, expect, it } from 'vitest';
import { configSchema, validateConfig } from '../src/config/schema.js';
import {
  buildDecomposeQuery,
  buildMetricQuery,
  buildTrendQuery,
} from '../src/core/sql-builder.js';

const config = validateConfig(
  configSchema.parse({
    table: 'events',
    time_column: 'created_at',
    metrics: {
      conversations: { kind: 'additive', expr: 'COUNT(*)' },
      resolution_rate: { kind: 'rate', of: 'CASE WHEN resolved THEN 1.0 ELSE 0.0 END' },
    },
    dimensions: {
      intent: { column: 'intent' },
      channel: { column: 'channel' },
    },
  })
);

const period = { from: '2026-07-01', to: '2026-07-08' };

describe('buildMetricQuery', () => {
  it('parameterizes dates — no literals in the SQL text', () => {
    const q = buildMetricQuery(config, { metric: 'conversations', period });
    expect(q.text).not.toContain('2026-07-01');
    expect(q.params).toEqual(['2026-07-01', '2026-07-08']);
  });

  it('parameterizes filter values and validates filter dimensions', () => {
    const q = buildMetricQuery(config, {
      metric: 'conversations',
      period,
      filters: { intent: ['billing', "x'; DROP TABLE events;--"], channel: 'web' },
    });
    expect(q.text).not.toContain('DROP TABLE');
    expect(q.params).toEqual([
      '2026-07-01',
      '2026-07-08',
      'billing',
      "x'; DROP TABLE events;--",
      'web',
    ]);
  });

  it('rejects unknown metrics, dimensions, and filter keys', () => {
    expect(() => buildMetricQuery(config, { metric: 'nope', period })).toThrow(/Unknown metric/);
    expect(() =>
      buildMetricQuery(config, { metric: 'conversations', period, groupBy: 'nope' })
    ).toThrow(/Unknown dimension/);
    expect(() =>
      buildMetricQuery(config, { metric: 'conversations', period, filters: { nope: 'x' } })
    ).toThrow(/Unknown dimension/);
  });

  it('treats prototype-chain names as unknown, not as valid lookups', () => {
    expect(() => buildMetricQuery(config, { metric: '__proto__', period })).toThrow(
      /Unknown metric/
    );
    expect(() =>
      buildMetricQuery(config, { metric: 'conversations', period, groupBy: 'constructor' })
    ).toThrow(/Unknown dimension/);
    expect(() =>
      buildMetricQuery(config, {
        metric: 'conversations',
        period,
        filters: { ['__proto__']: 'x' },
      })
    ).toThrow(/Unknown dimension/);
  });

  it('derives AVG() for rate metrics', () => {
    const q = buildMetricQuery(config, { metric: 'resolution_rate', period });
    expect(q.text).toContain('AVG(CASE WHEN resolved THEN 1.0 ELSE 0.0 END)');
  });
});

describe('buildDecomposeQuery', () => {
  it('returns value column for additive metrics', () => {
    const q = buildDecomposeQuery(config, {
      metric: 'conversations',
      period,
      dimension: 'intent',
    });
    expect(q.text).toContain('COUNT(*) AS value');
    expect(q.text).toContain('GROUP BY 1');
  });

  it('returns count + sum columns for rate metrics', () => {
    const q = buildDecomposeQuery(config, {
      metric: 'resolution_rate',
      period,
      dimension: 'intent',
    });
    expect(q.text).toContain('AS count');
    expect(q.text).toContain('AS sum');
  });
});

describe('buildTrendQuery', () => {
  it('buckets with date_trunc at the requested granularity', () => {
    const q = buildTrendQuery(config, {
      metric: 'conversations',
      period,
      granularity: 'day',
    });
    expect(q.text).toContain("date_trunc('day'");
  });

  it('rejects unknown granularities', () => {
    expect(() =>
      buildTrendQuery(config, {
        metric: 'conversations',
        period,
        granularity: 'century' as never,
      })
    ).toThrow(/Unknown granularity/);
  });
});

describe('config identifier validation', () => {
  it('rejects malicious identifiers at config load', () => {
    expect(() =>
      validateConfig(
        configSchema.parse({
          table: 'events; DROP TABLE users',
          time_column: 'created_at',
          metrics: { m: { kind: 'additive', expr: 'COUNT(*)' } },
          dimensions: {},
        })
      )
    ).toThrow(/Invalid SQL identifier/);
  });
});
