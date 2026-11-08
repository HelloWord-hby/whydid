import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ZodObject, type ZodRawShape } from 'zod';
import { checkSemanticPath, readBundle, validateBundle, writeBundle, type ConfigBundle } from '../src/admin/bundle.js';
import { Runtime } from '../src/admin/runtime.js';
import { maskDatabaseUrl, maskSecret, SettingsStore } from '../src/admin/settings.js';
import { PROVIDER_FIELDS } from '../src/boards/providers/fields.js';
import { PROVIDERS } from '../src/boards/providers/index.js';
import { startServer } from '../src/server.js';

const MAIN = `# Main semantic layer
table: conversations
time_column: created_at
metrics:
  conversations: { kind: additive, expr: "COUNT(*)" }
dimensions:
  intent: { column: intent }
`;

const EVENTS = `table: app_events
time_column: ts
metrics:
  sessions: { kind: additive, expr: "COUNT(DISTINCT session_id)" }
dimensions:
  platform: { column: platform }
`;

const BOARDS = `# Boards header comment
sources:
  model:
    kind: model_output
  events:
    kind: semantic
    config: presets/events.yaml
boards:
  - id: model_output
    title: Model Output
    source: model
  - id: product_events
    title: Product Events
    source: events
cards:
  - id: traces
    board: model_output
    title: Traces
    display: stat
    provider: trace_count
    default: true
  - id: sessions
    board: product_events
    title: Sessions
    display: stat
    provider: metric_stat
    params: { metric: sessions }
`;

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'whydid-admin-'));
  mkdirSync(join(dir, 'presets'));
  writeFileSync(join(dir, 'whydid.config.yaml'), MAIN);
  writeFileSync(join(dir, 'presets/events.yaml'), EVENTS);
  writeFileSync(join(dir, 'whydid.boards.yaml'), BOARDS);
  const files = { boards: join(dir, 'whydid.boards.yaml'), main: join(dir, 'whydid.config.yaml') };
  const env = { DATABASE_URL: 'postgres://u:secretpw@db.invalid:5432/x', WHYDID_LLM_API_KEY: 'sk-env-1234567890abcdef' };
  const settings = new SettingsStore(join(dir, '.whydid/settings.json'), env);
  return { dir, files, settings, env };
}

const NOW = new Date('2026-11-08T12:00:00Z');

describe('SettingsStore', () => {
  it('masks secrets and database passwords', () => {
    expect(maskSecret('sk-or-v1-abcdefghijklmnop')).toBe('••••mnop');
    expect(maskSecret('sk-123456789012')).toBe('••••');
    expect(maskSecret('short')).toBe('••••');
    expect(maskDatabaseUrl('postgres://u:pw@h:5432/db')).toBe('postgres://u:••••@h:5432/db');
  });

  it('saved values override the environment; null clears; the file is private', () => {
    const { settings, dir } = workspace();
    expect(settings.llm().apiKey).toBe('sk-env-1234567890abcdef');
    expect(settings.publicView().llm.api_key).toEqual({ value: '••••cdef', origin: 'env' });

    settings.update({ llm: { base_url: 'https://api.deepseek.com/v1', api_key: 'sk-saved-abcdefgh', model: 'deepseek-chat' } });
    expect(settings.llm()).toEqual({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-saved-abcdefgh', model: 'deepseek-chat' });
    const file = join(dir, '.whydid/settings.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(settings.publicView())).not.toContain('sk-saved-abcdefgh');

    settings.update({ llm: { model: 'deepseek-reasoner' } });
    expect(settings.llm().apiKey).toBe('sk-saved-abcdefgh');
    settings.update({ llm: { api_key: null } });
    expect(settings.llm().apiKey).toBe('sk-env-1234567890abcdef');

    settings.update({ databases: { events: 'postgres://a:b@other:5432/ev' } });
    expect(settings.databaseUrl('events')).toBe('postgres://a:b@other:5432/ev');
    expect(settings.databaseUrl('main')).toContain('db.invalid');
    expect(new SettingsStore(file, {}).llm().model).toBe('deepseek-reasoner');
  });
});

describe('config bundle', () => {
  it('reads every file, validates, and keeps the header comment when writing back', () => {
    const { files } = workspace();
    const bundle = readBundle(files);
    expect(Object.keys(bundle.semantic)).toEqual(['events']);
    const valid = validateBundle(files, bundle);
    expect(valid.paths).toEqual({ events: 'presets/events.yaml' });

    const boards = bundle.boards as { cards: Array<Record<string, unknown>> };
    boards.cards.push({ id: 'platforms', board: 'product_events', title: 'Platforms', display: 'pie', provider: 'metric_breakdown', params: { dimension: 'platform', metrics: ['sessions'] } });
    writeBundle(files, validateBundle(files, bundle));
    const text = readFileSync(files.boards, 'utf8');
    expect(text.startsWith('# Boards header comment')).toBe(true);
    expect(text).toContain('id: platforms');
    expect(readFileSync(files.main, 'utf8').startsWith('# Main semantic layer')).toBe(true);
  });

  it('names the broken part: unknown metric, bad semantic layer, unsafe path', () => {
    const { files } = workspace();
    const bundle = readBundle(files);
    const bad: ConfigBundle = { ...bundle, semantic: { events: { table: 'x', time_column: 'ts', metrics: {}, dimensions: {} } } };
    expect(() => validateBundle(files, bad)).toThrow(/Semantic layer "events".*at least one metric/);

    const boards = structuredClone(bundle.boards) as { sources: Record<string, Record<string, unknown>> };
    boards.sources.events!.config = '../escape.yaml';
    expect(() => validateBundle(files, { ...bundle, boards })).toThrow(/leaves the config directory/);
    expect(() => checkSemanticPath('/base', '/etc/passwd.yaml')).toThrow(/relative/);
    expect(() => checkSemanticPath('/base', 'a/b.json')).toThrow(/\.yaml/);
  });

  it('gives a new semantic source a default file path', () => {
    const { files } = workspace();
    const bundle = readBundle(files);
    const boards = structuredClone(bundle.boards) as { sources: Record<string, unknown> };
    boards.sources.orders = { kind: 'semantic' };
    const valid = validateBundle(files, { ...bundle, boards, semantic: { ...bundle.semantic, orders: { table: 'orders', time_column: 'created_at', metrics: { orders: { kind: 'additive', expr: 'COUNT(*)' } }, dimensions: {} } } });
    expect(valid.paths.orders).toBe('semantic/orders.yaml');
  });
});

describe('provider field descriptors', () => {
  it('describe exactly the params each provider accepts', () => {
    for (const [name, provider] of Object.entries(PROVIDERS)) {
      const shape = (provider.params as unknown as ZodObject<ZodRawShape>).shape;
      expect(Object.keys(shape).sort(), name).toEqual((PROVIDER_FIELDS[name] ?? []).map((f) => f.key).sort());
    }
  });
});

describe('Runtime', () => {
  it('saves a valid draft and hot-swaps the services; an invalid draft changes nothing', () => {
    const { files, settings, dir } = workspace();
    const rt = new Runtime({ files, settings, releasesPath: join(dir, 'releases.md'), now: () => NOW });
    const before = rt.parts.boards;
    expect(before.catalog().cards.map((c) => c.id)).toEqual(['traces', 'sessions']);

    const bundle = readBundle(files);
    const broken = structuredClone(bundle);
    (broken.boards.cards as Array<Record<string, unknown>>)[1]!.params = { metric: 'nope' };
    expect(() => rt.save(broken)).toThrow(/nope/);
    expect(rt.parts.boards).toBe(before);
    expect(readFileSync(files.boards, 'utf8')).toBe(BOARDS);

    (bundle.boards.boards as Array<Record<string, unknown>>)[0]!.title = { en: 'LLM quality', zh: 'LLM 质量' };
    rt.save(bundle);
    expect(rt.parts.boards).not.toBe(before);
    expect(rt.parts.boards.catalog().boards[0]!.title).toEqual({ en: 'LLM quality', zh: 'LLM 质量' });
    expect(rt.agent.workbench).toBe(rt.parts.workbench);
    // No source has a rate metric, so the rate decomposition tool is left out instead of crashing.
    const names = rt.parts.workbench.tools.map((t) => t.name);
    expect(names).toContain('decompose_change_additive');
    expect(names).not.toContain('decompose_change_rate');
  });

  it('reads score names from the model data for the card editor', async () => {
    const { files, settings, dir } = workspace();
    const rt = new Runtime({ files, settings, releasesPath: join(dir, 'releases.md'), now: () => NOW });
    expect(await rt.modelScoreNames()).toEqual(expect.arrayContaining(['faithfulness', 'relevance']));
  });
});

describe('admin routes', () => {
  const PORT = 21_000 + Math.floor(Math.random() * 1000);
  const base = `http://localhost:${PORT}`;
  const ws = workspace();
  const rt = new Runtime({ files: ws.files, settings: ws.settings, releasesPath: join(ws.dir, 'releases.md'), now: () => NOW });
  let writable = true;
  let server: ReturnType<typeof startServer>;

  beforeAll(async () => {
    delete process.env.WHYDID_SERVE_TOKEN;
    const admin = { runtime: rt, settings: ws.settings, settingsPath: '.whydid/settings.json', get writable() { return writable; } };
    server = startServer(rt.parts.main.config, rt.parts.main.db, {
      port: PORT,
      host: 'localhost',
      main: () => rt.parts.main,
      get boards() {
        return rt.parts.boards;
      },
      admin,
    });
    await new Promise<void>((r) => server.once('listening', () => r()));
  });
  afterAll(() => server.close());

  const send = (path: string, method: string, payload: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method, body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json', ...headers } });

  it('returns the bundle, providers, masked settings and score names', async () => {
    const r = (await (await fetch(base + '/admin/config')).json()) as Record<string, unknown>;
    expect(r.writable).toBe(true);
    expect(Object.keys(r.bundle as object)).toEqual(['boards', 'semantic', 'main']);
    expect((r.providers as Array<{ name: string }>).map((p) => p.name)).toContain('metric_breakdown');
    expect(JSON.stringify(r.settings)).not.toContain('secretpw');
    expect(r.model_scores).toEqual(expect.arrayContaining(['faithfulness']));
  });

  it('previews a card from an unsaved draft, then saves the draft', async () => {
    const bundle = readBundle(ws.files);
    (bundle.boards.cards as Array<Record<string, unknown>>).push({ id: 'faith', board: 'model_output', title: 'Faithfulness', display: 'stat', provider: 'score_average', params: { score: 'faithfulness' } });
    const preview = await send('/admin/preview', 'POST', { bundle, card: 'faith', days: 7 });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { data: { display: string } }).data.display).toBe('stat');
    expect(rt.parts.boards.hasCard('faith')).toBe(false);

    const saved = await send('/admin/config', 'PUT', { bundle });
    expect(saved.status).toBe(200);
    expect(rt.parts.boards.hasCard('faith')).toBe(true);
    const cards = (await (await fetch(base + '/boards')).json()) as { cards: Array<{ id: string }> };
    expect(cards.cards.map((c) => c.id)).toContain('faith');
  });

  it('rejects invalid drafts with the reason, and cross-origin or read-only writes', async () => {
    const bundle = readBundle(ws.files);
    (bundle.boards.cards as Array<Record<string, unknown>>)[0]!.display = 'table';
    const bad = await send('/admin/config', 'PUT', { bundle });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/cannot render as "table"/);

    const cross = await send('/admin/settings', 'PUT', { llm: { model: 'x' } }, { Origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    expect(cross.headers.get('access-control-allow-origin')).toBeNull();

    writable = false;
    expect((await send('/admin/settings', 'PUT', { llm: { model: 'x' } })).status).toBe(403);
    writable = true;
  });

  it('saves settings and never echoes the key back', async () => {
    const r = await send('/admin/settings', 'PUT', { llm: { api_key: 'sk-new-key-0987654321', model: 'moonshot-v1-8k' } });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('sk-new-key-0987654321');
    expect(text).toContain('••••4321');
    expect(ws.settings.llm().model).toBe('moonshot-v1-8k');
  });
});

describe('YAML write-back', () => {
  const SRC = `# header
sources:
  model:
    kind: model_output          # inline comment
boards:
  - id: a
    title: { en: A, zh: 甲 }
    source: model

cards:
  # ── group ──
  - id: one
    board: a
    title: One
    params: { score: faithfulness }

  - id: two
    board: a
    title: Two
`;

  it('keeps comments, blank lines and flow style on untouched nodes', async () => {
    const { mergeYaml } = await import('../src/admin/yaml-merge.js');
    const { parse } = await import('yaml');
    const value = parse(SRC) as { cards: Array<Record<string, unknown>> };
    value.cards = [value.cards[1]!, { ...value.cards[0]!, title: 'One (renamed)' }, { id: 'three', board: 'a', title: 'Three' }];
    const out = mergeYaml(SRC, value);
    expect(out).toContain('# header');
    expect(out).toContain('kind: model_output # inline comment');
    expect(out).toContain('title: { en: A, zh: 甲 }');
    expect(out).toContain('params: { score: faithfulness }');
    expect(out).toContain('title: One (renamed)');
    expect(out.indexOf('id: two')).toBeLessThan(out.indexOf('id: one'));
    expect(out).toContain('id: three');
    expect(parse(out)).toEqual(value);
  });

  it('does not touch a file whose content is unchanged', async () => {
    const { writeYaml } = await import('../src/admin/yaml-merge.js');
    const { parse } = await import('yaml');
    const dir = mkdtempSync(join(tmpdir(), 'whydid-yaml-'));
    const file = join(dir, 'x.yaml');
    writeFileSync(file, SRC);
    expect(writeYaml(file, parse(SRC) as Record<string, unknown>)).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(SRC);
  });
});
