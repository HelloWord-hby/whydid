import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoReleaseLog } from '../src/releases/demo.js';
import { parseReleaseLog, readHeading, sortEntries } from '../src/releases/parse.js';
import { MAX_RELEASE_LOG_BYTES, ReleaseStore } from '../src/releases/store.js';
import { buildWorkbenchEnv } from '../src/workbench/index.js';
import { buildCatalog, contextBlock } from '../src/workbench/prompt.js';
import { releaseContextLine } from '../src/workbench/release-tools.js';
import { buildAgentTools, runAgentTool } from '../src/workbench/tools.js';
import { demoBoards, fakeDb, mainConfig, NOW } from './workbench-helpers.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'whydid-rel-')), 'releases.md');

describe('readHeading', () => {
  it('finds ISO, slash, dotted and Chinese dates, and a version that is not the date', () => {
    expect(readHeading('v1.9 — 2026-11-04')).toEqual({ date: '2026-11-04', version: 'v1.9' });
    expect(readHeading('1.2.0 - 2026/3/7')).toEqual({ date: '2026-03-07', version: '1.2.0' });
    expect(readHeading('2026.11.04 hotfix')).toEqual({ date: '2026-11-04', version: null });
    expect(readHeading('v2.0（2026年11月4日）')).toEqual({ date: '2026-11-04', version: 'v2.0' });
    expect(readHeading('Unreleased')).toEqual({ date: null, version: null });
    expect(readHeading('v1.0 2026-02-30')).toEqual({ date: null, version: 'v1.0' });
  });
});

describe('parseReleaseLog', () => {
  it('splits a Keep-a-Changelog file at the level that carries versions', () => {
    const md = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '- wip',
      '',
      '## [1.2.0](https://example.com) - 2026-11-04',
      '### Added',
      '- reranker',
      '```',
      '## not a heading',
      '```',
      '## [1.1.0] - 2026-10-01',
      '- first',
    ].join('\n');
    const entries = parseReleaseLog(md);
    expect(entries.map((e) => [e.version, e.date, e.title])).toEqual([
      [null, null, 'Unreleased'],
      ['1.2.0', '2026-11-04', '1.2.0 - 2026-11-04'],
      ['1.1.0', '2026-10-01', '1.1.0 - 2026-10-01'],
    ]);
    expect(entries[1]!.body).toContain('### Added');
    expect(entries[1]!.body).toContain('## not a heading');
  });

  it('keeps a document without version headings as one undated note, and an empty one as nothing', () => {
    expect(parseReleaseLog('# Readme\nSome text')).toEqual([{ id: 'r1', version: null, date: null, title: 'Readme', body: '# Readme\nSome text' }]);
    expect(parseReleaseLog('  \n')).toEqual([]);
  });

  it('sorts dated entries newest first and undated last', () => {
    const sorted = sortEntries(parseReleaseLog('## v1 2026-01-01\n## draft\n## v2 2026-02-01'));
    expect(sorted.map((e) => e.title)).toEqual(['v2 2026-02-01', 'v1 2026-01-01', 'draft']);
  });

  it('dates the demo log so v1.9 ships 4 days before today, like the demo data', () => {
    const entries = sortEntries(parseReleaseLog(demoReleaseLog(NOW)));
    expect(entries[0]).toMatchObject({ version: 'v1.9', date: '2026-11-04' });
    expect(entries).toHaveLength(3);
  });
});

describe('ReleaseStore', () => {
  it('serves the demo log until a file is written, then the file', () => {
    const path = tmp();
    const store = new ReleaseStore(path, () => demoReleaseLog(NOW));
    expect(store.read().origin).toBe('demo');
    const saved = store.write('## v3.0 — 2026-11-07\n- new judge');
    expect(saved).toMatchObject({ origin: 'file', entries: [{ version: 'v3.0', date: '2026-11-07' }] });
    expect(readFileSync(path, 'utf8')).toContain('new judge');
    expect(store.write('').entries).toEqual([]);
  });

  it('reports "none" without a file or demo, and refuses oversized logs', () => {
    const store = new ReleaseStore(tmp());
    expect(store.read()).toMatchObject({ origin: 'none', entries: [] });
    expect(() => store.write('x'.repeat(MAX_RELEASE_LOG_BYTES + 1))).toThrow(/limited/);
  });
});

describe('list_releases tool', () => {
  const store = new ReleaseStore(tmp(), () => demoReleaseLog(NOW));
  const env = buildWorkbenchEnv(demoBoards(), mainConfig, fakeDb, () => NOW, store);
  const tools = buildAgentTools(env);
  const run = (args: Record<string, unknown>) => runAgentTool(tools, env, 'list_releases', args) as Promise<Record<string, unknown>>;

  it('is registered only when the server keeps a release log', () => {
    expect(tools.map((t) => t.name)).toContain('list_releases');
    expect(buildAgentTools(buildWorkbenchEnv(demoBoards(), mainConfig, fakeDb, () => NOW)).map((t) => t.name)).not.toContain('list_releases');
  });

  it('returns releases in the window and its baseline, as untrusted text, with a hint to verify', async () => {
    const r = await run({ days: 7 });
    expect(r.range).toEqual({ from: '2026-10-25', to: '2026-11-07' });
    const releases = r.releases as Array<{ version: string; untrusted: { changes: string } }>;
    expect(releases.map((x) => x.version)).toEqual(['v1.9']);
    expect(releases[0]!.untrusted.changes).toContain('800 → 300');
    expect((r.next_hints as string[])[0]).toMatch(/low_score_breakdown group_by=release/);
  });

  it('returns the whole log without a window and validates dates', async () => {
    const r = await run({});
    expect((r.releases as unknown[]).length).toBe(3);
    await expect(run({ from: '4 Nov' })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('adds a catalog section and a one-line turn context', () => {
    expect(buildCatalog(env)).toContain('### Release log');
    const line = releaseContextLine(env)!;
    expect(line).toBe('release_log: 3 dated entries, latest v1.9 on 2026-11-04 (read with list_releases)');
    expect(contextBlock({ today: '2026-11-08', entry: 'chat', playbook: 'explain_change', days: 7, releases: line })).toContain(line);
  });
});
