import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Sql } from 'postgres';
import { configSchema, validateConfig, type WhydidConfig } from '../src/config/schema.js';
import { BoardService, createBoardService, parseBoardsConfig } from '../src/boards/service.js';
import { buildWindow, parseDays } from '../src/boards/window.js';

// Construction never touches the database; a stub proves it.
const db = {} as Sql;

const semantic: WhydidConfig = validateConfig(
  configSchema.parse({
    table: 'events',
    time_column: 'created_at',
    metrics: {
      users: { kind: 'additive', expr: 'COUNT(DISTINCT user_id)' },
      ctr: { kind: 'rate', of: 'CASE WHEN clicked THEN 1.0 ELSE 0.0 END' },
    },
    dimensions: { entry: { column: 'entry' } },
  })
);

function base(cards: unknown[]): Record<string, unknown> {
  return {
    sources: {
      model: { kind: 'model_output' },
      events: { kind: 'semantic', config: 'events.yaml' },
    },
    boards: [
      { id: 'model_output', title: 'Model', source: 'model' },
      { id: 'events', title: 'Events', source: 'events' },
    ],
    cards,
  };
}

function service(cards: unknown[]): BoardService {
  return new BoardService(parseBoardsConfig(base(cards)), '/tmp', {
    db,
    env: {},
    loadSemantic: () => semantic,
  });
}

describe('boards config parsing', () => {
  it('applies defaults to cards and model sources', () => {
    const cfg = parseBoardsConfig(
      base([{ id: 'traces', board: 'model_output', title: 'Traces', display: 'stat', provider: 'trace_count' }])
    );
    expect(cfg.cards[0]).toMatchObject({ size: 1, default: false, params: {} });
    expect(cfg.sources.model).toMatchObject({ low_score_threshold: 0.5, feedback_score: 'user_feedback' });
  });

  it('rejects duplicate card ids and unknown boards', () => {
    const card = { id: 'a', board: 'model_output', title: 'A', display: 'stat', provider: 'trace_count' };
    expect(() => parseBoardsConfig(base([card, card]))).toThrow(/Duplicate card id "a"/);
    expect(() => parseBoardsConfig(base([{ ...card, board: 'nope' }]))).toThrow(/unknown board "nope"/);
  });

  it('rejects boards bound to unknown sources and bad ids/displays', () => {
    const cfg = base([]);
    (cfg.boards as Array<Record<string, unknown>>)[0]!.source = 'missing';
    expect(() => parseBoardsConfig(cfg)).toThrow(/unknown source "missing"/);
    expect(() =>
      parseBoardsConfig(base([{ id: 'Bad-Id', board: 'events', title: 'x', display: 'stat', provider: 'x' }]))
    ).toThrow(/lower_snake_case/);
    expect(() =>
      parseBoardsConfig(base([{ id: 'x', board: 'events', title: 'x', display: 'sankey', provider: 'x' }]))
    ).toThrow(/display/);
  });
});

describe('card validation against providers', () => {
  const card = (over: Record<string, unknown>) => ({ id: 'c', title: 'C', ...over });

  it('rejects unknown providers', () => {
    expect(() => service([card({ board: 'events', display: 'stat', provider: 'nope' })])).toThrow(
      /Unknown provider "nope"/
    );
  });

  it('rejects a provider used on the wrong kind of source', () => {
    expect(() => service([card({ board: 'events', display: 'stat', provider: 'trace_count' })])).toThrow(
      /reads model_output data/
    );
  });

  it('rejects a display the provider cannot render', () => {
    expect(() =>
      service([card({ board: 'events', display: 'table', provider: 'metric_stat', params: { metric: 'users' } })])
    ).toThrow(/cannot render as "table"/);
  });

  it('rejects invalid and unexpected params', () => {
    expect(() => service([card({ board: 'events', display: 'stat', provider: 'metric_stat' })])).toThrow(
      /invalid params/
    );
    expect(() =>
      service([card({ board: 'model_output', display: 'stat', provider: 'trace_count', params: { x: 1 } })])
    ).toThrow(/invalid params/);
  });

  it('rejects metrics and dimensions missing from the semantic layer', () => {
    expect(() =>
      service([card({ board: 'events', display: 'stat', provider: 'metric_stat', params: { metric: 'ghost' } })])
    ).toThrow(/Unknown metric "ghost"/);
    expect(() =>
      service([
        card({
          board: 'events',
          display: 'table',
          provider: 'metric_breakdown',
          params: { dimension: 'country', metrics: ['users'] },
        }),
      ])
    ).toThrow(/Unknown dimension "country"/);
  });

  it('builds the catalog with default layouts and modes', () => {
    const svc = service([
      card({ id: 'a', board: 'model_output', display: 'stat', provider: 'trace_count', default: true }),
      card({ id: 'b', board: 'model_output', display: 'line', provider: 'trace_count', size: 2 }),
      card({ id: 'c', board: 'events', display: 'stat', provider: 'metric_stat', params: { metric: 'users' }, default: true, size: 3 }),
    ]);
    const cat = svc.catalog();
    expect(cat.boards.map((b) => [b.id, b.mode, b.source_kind])).toEqual([
      ['model_output', 'demo', 'model_output'],
      ['events', 'live', 'semantic'],
    ]);
    expect(cat.boards[0]!.default_layout).toEqual([{ id: 'a', size: 1 }]);
    expect(cat.boards[1]!.default_layout).toEqual([{ id: 'c', size: 3 }]);
    expect(cat.cards).toHaveLength(3);
    expect(svc.semanticConfigForBoard('events')).toBe(semantic);
    expect(svc.semanticConfigForBoard('model_output')).toBeUndefined();
  });

  it('serves model-output card data from the demo source', async () => {
    const svc = service([
      card({ id: 'traces', board: 'model_output', display: 'stat', provider: 'trace_count' }),
      card({ id: 'dims', board: 'model_output', display: 'table', provider: 'low_score_rate' }),
    ]);
    const now = new Date('2026-11-08T12:00:00Z');
    const stat = await svc.cardData('traces', 7, now);
    expect(stat.mode).toBe('demo');
    expect(stat.window.current).toEqual({ from: '2026-11-01', to: '2026-11-08' });
    expect(stat.data.display).toBe('stat');
    if (stat.data.display === 'stat') {
      expect(stat.data.value).toBeGreaterThan(0);
      expect(stat.data.spark).toHaveLength(7);
    }
    const table = await svc.cardData('dims', 7, now);
    expect(table.data.display === 'table' && table.data.rows.map((r) => r.group)).toEqual(
      expect.arrayContaining(['faithfulness', 'relevance'])
    );
    await expect(svc.cardData('missing', 7, now)).rejects.toThrow(/Unknown card/);
  });
});

describe('bar and pie displays', () => {
  const card = (over: Record<string, unknown>) => ({ id: 'c', title: 'C', ...over });

  it('rejects a pie of a rate metric and displays a provider does not support', () => {
    expect(() =>
      service([
        card({ board: 'events', display: 'pie', provider: 'metric_breakdown', params: { dimension: 'entry', metrics: ['ctr'] } }),
      ])
    ).toThrow(/pie needs an additive metric/);
    expect(() => service([card({ board: 'model_output', display: 'pie', provider: 'low_score_rate' })])).toThrow(
      /cannot render as "pie"/
    );
    expect(() => service([card({ board: 'model_output', display: 'bar', provider: 'trace_count' })])).toThrow(
      /cannot render as "bar"/
    );
  });

  it('draws a breakdown as bar and pie from the same tool query', async () => {
    // A fake db that answers every grouped get_metric query with fixed rows.
    const rows = [
      { segment: 'home', value: '60' },
      { segment: 'push', value: '25' },
      { segment: 'search', value: '10' },
      { segment: 'link', value: '5' },
    ];
    const fakeDb = { unsafe: async () => rows } as unknown as Sql;
    const params = { dimension: 'entry', metrics: ['users'], share: true, limit: 3 };
    const svc = new BoardService(
      parseBoardsConfig(
        base([
          card({ id: 'p', board: 'events', display: 'pie', provider: 'metric_breakdown', params }),
          card({ id: 'b', board: 'events', display: 'bar', provider: 'metric_breakdown', params }),
        ])
      ),
      '/tmp',
      { db: fakeDb, env: {}, loadSemantic: () => semantic }
    );

    const pie = (await svc.cardData('p', 7)).data;
    expect(pie).toMatchObject({ display: 'pie', format: 'int', total: 100 });
    expect(pie.display === 'pie' && pie.slices.map((s) => [s.label, s.share])).toEqual([
      ['home', 0.6],
      ['push', 0.25],
      ['Other', 0.15],
    ]);

    const bar = (await svc.cardData('b', 7)).data;
    expect(bar.display === 'bar' && bar.items).toEqual([
      { label: 'home', value: 60, share: 0.6 },
      { label: 'push', value: 25, share: 0.25 },
      { label: 'search', value: 10, share: 0.1 },
    ]);
  });

  it('draws low-score rates as bars without shares', async () => {
    const svc = service([card({ board: 'model_output', display: 'bar', provider: 'low_score_rate', params: { group_by: 'route' } })]);
    const data = (await svc.cardData('c', 7, new Date('2026-11-08T12:00:00Z'))).data;
    expect(data.display).toBe('bar');
    if (data.display === 'bar') {
      expect(data.format).toBe('pct');
      expect(data.items.map((i) => i.label)).toContain('rag-answer');
      expect(data.items.every((i) => i.share === null)).toBe(true);
      // Sorted by low rate, worst first.
      const rates = data.items.map((i) => i.value ?? 0);
      expect([...rates].sort((a, b) => b - a)).toEqual(rates);
    }
  });
});

describe('the shipped whydid.boards.yaml', () => {
  it('loads and validates every card against its provider and semantic layer', () => {
    const svc = createBoardService(fileURLToPath(new URL('../whydid.boards.yaml', import.meta.url)), {
      db,
      env: {},
    });
    const cat = svc.catalog();
    expect(cat.boards.map((b) => b.id)).toEqual(['model_output', 'product_events']);
    for (const b of cat.boards) expect(b.default_layout.length).toBeGreaterThan(0);
    expect(cat.cards.length).toBeGreaterThanOrEqual(20);
  });
});

describe('board windows', () => {
  it('parses allowed day counts only', () => {
    expect(parseDays(null)).toBe(7);
    expect(parseDays('30')).toBe(30);
    expect(() => parseDays('5')).toThrow(/days must be one of/);
    expect(() => parseDays('7; DROP')).toThrow();
  });

  it('builds adjacent equal-length periods ending today (UTC)', () => {
    expect(buildWindow(7, new Date('2026-11-08T23:59:00Z'))).toEqual({
      days: 7,
      current: { from: '2026-11-01', to: '2026-11-08' },
      previous: { from: '2026-10-25', to: '2026-11-01' },
    });
  });
});
