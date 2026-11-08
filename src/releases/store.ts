/**
 * Release log storage — one Markdown file on the server.
 *
 * The agent runs on the server and the eval script reads the same file,
 * so the log lives next to the configs (default whydid.releases.md,
 * gitignored) rather than in the browser. When the file does not exist
 * and the model board runs on demo data, a demo log that matches the demo
 * incident is shown instead; saving writes the real file.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseReleaseLog, sortEntries, type ReleaseEntry } from './parse.js';

export const MAX_RELEASE_LOG_BYTES = 256 * 1024;

export type ReleaseOrigin = 'file' | 'demo' | 'none';

export interface ReleaseLog {
  origin: ReleaseOrigin;
  /** File name shown in the UI (not an absolute path). */
  file: string;
  markdown: string;
  /** Newest first; undated entries last. */
  entries: ReleaseEntry[];
  updated_at: string | null;
}

export class ReleaseStore {
  private readonly path: string;
  private cache: { mtimeMs: number; log: ReleaseLog } | undefined;

  constructor(
    private readonly file: string,
    private readonly demo?: () => string
  ) {
    this.path = resolve(file);
  }

  read(): ReleaseLog {
    if (!existsSync(this.path)) {
      const markdown = this.demo?.() ?? '';
      return this.build(markdown, markdown ? 'demo' : 'none', null);
    }
    const { mtimeMs, mtime } = statSync(this.path);
    if (this.cache?.mtimeMs === mtimeMs) return this.cache.log;
    const log = this.build(readFileSync(this.path, 'utf8'), 'file', mtime.toISOString());
    this.cache = { mtimeMs, log };
    return log;
  }

  write(markdown: string): ReleaseLog {
    if (Buffer.byteLength(markdown, 'utf8') > MAX_RELEASE_LOG_BYTES) {
      throw new Error(`The release log is limited to ${MAX_RELEASE_LOG_BYTES / 1024} KB.`);
    }
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, markdown, 'utf8');
    renameSync(tmp, this.path);
    this.cache = undefined;
    return this.read();
  }

  private build(markdown: string, origin: ReleaseOrigin, updatedAt: string | null): ReleaseLog {
    return { origin, file: this.file, markdown, entries: sortEntries(parseReleaseLog(markdown)), updated_at: updatedAt };
  }
}
