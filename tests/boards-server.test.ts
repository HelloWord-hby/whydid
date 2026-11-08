import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Sql } from 'postgres';
import { configSchema, validateConfig } from '../src/config/schema.js';
import { BoardService, parseBoardsConfig } from '../src/boards/service.js';
import { startServer } from '../src/server.js';

const config = validateConfig(
  configSchema.parse({
    table: 'events',
    time_column: 'created_at',
    metrics: { users: { kind: 'additive', expr: 'COUNT(*)' } },
    dimensions: {},
  })
);
const db = {} as Sql;

const boards = new BoardService(
  parseBoardsConfig({
    sources: { model: { kind: 'model_output' } },
    boards: [{ id: 'model_output', title: 'Model', source: 'model' }],
    cards: [
      { id: 'traces', board: 'model_output', title: 'Traces', display: 'stat', provider: 'trace_count', default: true },
    ],
  }),
  '/tmp',
  { env: {} }
);

const PORT = 18_000 + Math.floor(Math.random() * 1000);
const base = `http://localhost:${PORT}`;
let server: ReturnType<typeof startServer>;

beforeAll(async () => {
  delete process.env.WHYDID_SERVE_TOKEN;
  server = startServer(config, db, { port: PORT, host: 'localhost', boards });
  await new Promise<void>((r) => server.once('listening', () => r()));
});

afterAll(() => {
  server.close();
});

describe('board routes', () => {
  it('GET /boards returns the catalog', async () => {
    const r = await fetch(base + '/boards');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { boards: Array<{ id: string; mode: string }>; cards: unknown[] };
    expect(body.boards[0]).toMatchObject({ id: 'model_output', mode: 'demo' });
    expect(body.cards).toHaveLength(1);
  });

  it('GET /cards/:id returns server-computed data', async () => {
    const r = await fetch(base + '/cards/traces?days=14');
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      card: string;
      window: { days: number };
      data: { display: string; value: number };
    };
    expect(body.card).toBe('traces');
    expect(body.window.days).toBe(14);
    expect(body.data.display).toBe('stat');
    expect(typeof body.data.value).toBe('number');
  });

  it('rejects unknown cards and bad windows', async () => {
    expect((await fetch(base + '/cards/nope')).status).toBe(404);
    expect((await fetch(base + '/cards/__proto__')).status).toBe(404);
    expect((await fetch(base + '/cards/traces?days=5')).status).toBe(400);
  });

  it('serves the dashboard shell (or a build hint) and refuses paths outside ui/dist/assets', async () => {
    for (const path of ['/', '/?api=x', '/index.html']) {
      const r = await fetch(base + path);
      // 200 when ui/dist is built, 503 with instructions when it is not.
      expect([200, 503]).toContain(r.status);
      expect(r.headers.get('content-type')).toMatch(/text\/html/);
    }
    for (const path of ['/assets/../package.json', '/assets/%2e%2e%2fpackage.json', '/src/server.ts', '/assets/x.exe']) {
      expect((await fetch(base + path)).status).toBe(404);
    }
  });

  it('refuses to route /ask to a board without a semantic config', async () => {
    const r = await fetch(base + '/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'why?', board: 'model_output' }),
    });
    expect(r.status).toBe(400);
  });
});
