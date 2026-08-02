import { describe, expect, it } from 'vitest';
import {
  buildScoreColumnMap,
  scoreColumn,
  scoreToRow,
  traceToRow,
} from '../src/connectors/langfuse/transform.js';

describe('traceToRow', () => {
  it('maps fields and coalesces missing values to null', () => {
    const row = traceToRow({
      id: 't1',
      timestamp: '2026-08-01T10:00:00Z',
      name: 'chat',
      userId: 'u1',
      latency: 2.5,
      totalCost: 0.0031,
    });
    expect(row).toEqual({
      id: 't1',
      created_at: '2026-08-01T10:00:00Z',
      name: 'chat',
      user_id: 'u1',
      session_id: null,
      release: null,
      version: null,
      environment: null,
      latency_sec: 2.5,
      total_cost: 0.0031,
    });
  });

  it('rejects non-finite numbers instead of storing NaN', () => {
    const row = traceToRow({
      id: 't2',
      timestamp: '2026-08-01T10:00:00Z',
      latency: Number.NaN,
      totalCost: Infinity,
    });
    expect(row.latency_sec).toBeNull();
    expect(row.total_cost).toBeNull();
  });
});

describe('scoreToRow', () => {
  it('drops scores without a trace id', () => {
    expect(
      scoreToRow({ id: 's1', name: 'helpfulness', value: 0.9, timestamp: '2026-08-01T10:00:00Z' })
    ).toBeNull();
  });

  it('keeps categorical scores with null value (raw table only)', () => {
    const row = scoreToRow({
      id: 's2',
      traceId: 't1',
      name: 'sentiment',
      dataType: 'CATEGORICAL',
      timestamp: '2026-08-01T10:00:00Z',
    });
    expect(row?.value).toBeNull();
    expect(row?.data_type).toBe('CATEGORICAL');
  });
});

describe('scoreColumn', () => {
  it('sanitizes arbitrary score names into valid identifiers', () => {
    expect(scoreColumn('helpfulness')).toBe('score_helpfulness');
    expect(scoreColumn('QA-Relevance (v2)')).toBe('score_qa_relevance_v2');
    expect(scoreColumn('忠诚度')).toBe('score_unnamed');
    expect(scoreColumn('  ')).toBe('score_unnamed');
  });

  it('produces identifiers that pass whydid identifier validation', () => {
    const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (const name of ['a b c', '9lives', 'UPPER', 'x'.repeat(200), '---']) {
      expect(scoreColumn(name)).toMatch(IDENTIFIER);
    }
  });
});

describe('buildScoreColumnMap', () => {
  it('assigns deterministic suffixes on collisions', () => {
    const map = buildScoreColumnMap(['QA Relevance', 'qa-relevance', 'qa_relevance']);
    expect(new Set(map.values()).size).toBe(3);
    // Sorted input order makes suffix assignment reproducible.
    expect(map.get('QA Relevance')).toBe('score_qa_relevance');
    expect(map.get('qa-relevance')).toBe('score_qa_relevance_2');
    expect(map.get('qa_relevance')).toBe('score_qa_relevance_3');
  });

  it('is idempotent across repeated names', () => {
    const map = buildScoreColumnMap(['helpfulness', 'helpfulness', 'helpfulness']);
    expect(map.size).toBe(1);
    expect(map.get('helpfulness')).toBe('score_helpfulness');
  });
});
