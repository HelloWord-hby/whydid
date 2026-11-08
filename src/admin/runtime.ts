/**
 * The running configuration, rebuilt in place when the admin page saves.
 *
 * A save validates the draft, builds a complete set of services from it
 * (boards, workbench, release log), and only then writes the files and
 * swaps the services in. If any step fails, the old services keep running
 * and nothing is written. Database pools and the model source are reused
 * across reloads, so a reload does not reconnect or refetch data.
 *
 * Agent sessions live in the workbench, so a reload starts new sessions;
 * the dashboard opens a fresh one on its next message.
 */
import { type Sql } from 'postgres';
import { LlmClient } from '../agent/llm.js';
import { BoardService } from '../boards/service.js';
import { createModelSource, type ModelSource } from '../boards/model/source.js';
import { qualityScoreNames } from '../boards/model/aggregate.js';
import { type WhydidConfig } from '../config/schema.js';
import { poolFor } from '../db/pools.js';
import { EvalService } from '../evals/service.js';
import { demoReleaseLog } from '../releases/demo.js';
import { ReleaseStore } from '../releases/store.js';
import { buildWorkbenchEnv, Workbench } from '../workbench/index.js';
import { type AgentRouteOptions } from '../workbench/http.js';
import { boardsBaseDir, readBundle, validateBundle, writeBundle, type ConfigBundle, type ConfigFiles, type ValidBundle } from './bundle.js';
import { type SettingsStore } from './settings.js';

export interface RuntimeParts {
  main: { config: WhydidConfig; db: Sql };
  boards: BoardService;
  workbench: Workbench;
  releases: ReleaseStore;
  dataModes: string;
}

export interface RuntimeOptions {
  files: ConfigFiles;
  settings: SettingsStore;
  releasesPath: string;
  now?: () => Date;
}

export class Runtime {
  private current: RuntimeParts;
  private readonly modelSources = new Map<string, ModelSource>();
  readonly evals: EvalService;
  readonly agent: AgentRouteOptions;

  constructor(readonly opts: RuntimeOptions) {
    this.current = this.build(validateBundle(opts.files, readBundle(opts.files)));
    const self = this;
    this.agent = {
      get workbench() {
        return self.current.workbench;
      },
      llmFactory: () => self.llm(),
      llmConfigured: () => Boolean(opts.settings.llm().apiKey),
      get model() {
        return opts.settings.llm().model;
      },
    };
    this.evals = new EvalService({
      get workbench() {
        return self.current.workbench;
      },
      llmFactory: () => self.llm(),
      llmConfigured: () => Boolean(opts.settings.llm().apiKey),
      get model() {
        return opts.settings.llm().model;
      },
      get dataModes() {
        return self.current.dataModes;
      },
    });
  }

  get parts(): RuntimeParts {
    return this.current;
  }

  llm(): LlmClient {
    const s = this.opts.settings.llm();
    return new LlmClient({ baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model });
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private db(sourceId: string, timezone: string): Sql {
    const url = this.opts.settings.databaseUrl(sourceId);
    if (!url) throw new Error(`No database for source "${sourceId}": set DATABASE_URL or a database URL for this source.`);
    return poolFor(url, timezone);
  }

  private modelSource(maxPages: number): ModelSource {
    const env = this.opts.settings.langfuseEnv();
    const key = JSON.stringify([env.LANGFUSE_HOST, env.LANGFUSE_PUBLIC_KEY, env.LANGFUSE_SECRET_KEY, maxPages]);
    let src = this.modelSources.get(key);
    if (!src) {
      src = createModelSource(env, maxPages);
      this.modelSources.set(key, src);
    }
    return src;
  }

  /** Build a full set of services from a validated bundle. Touches no files. */
  build(valid: ValidBundle): RuntimeParts {
    const main = { config: valid.main, db: this.db('main', valid.main.timezone) };
    const boards = new BoardService(valid.boards, boardsBaseDir(this.opts.files), {
      loadSemantic: (_path, id) => valid.semantic.get(id)!,
      dbFor: (id, tz) => this.db(id, tz),
      modelSource: (maxPages) => this.modelSource(maxPages),
    });
    const list = boards.catalog().boards;
    const demoModel = list.some((b) => b.source_kind === 'model_output' && b.mode === 'demo');
    const releases = new ReleaseStore(this.opts.releasesPath, demoModel ? () => demoReleaseLog(this.now()) : undefined);
    const workbench = new Workbench(buildWorkbenchEnv(boards, main.config, main.db, () => this.now(), releases));
    return { main, boards, workbench, releases, dataModes: list.map((b) => `${b.id}=${b.mode}`).join(', ') };
  }

  /** Validate and build a draft without saving it (for previews). */
  tryDraft(draft: ConfigBundle): RuntimeParts {
    return this.build(validateBundle(this.opts.files, draft));
  }

  /** Validate, build, write, swap. Throws (and changes nothing) when the draft is invalid. */
  save(draft: ConfigBundle): void {
    const valid = validateBundle(this.opts.files, draft);
    const next = this.build(valid);
    writeBundle(this.opts.files, valid);
    this.current = next;
  }

  /** Rebuild from the files on disk, e.g. after connection settings changed. */
  reload(): void {
    this.current = this.build(validateBundle(this.opts.files, readBundle(this.opts.files)));
  }

  /** Score names seen in the model data over the last 30 days, for the card editor. */
  async modelScoreNames(): Promise<string[]> {
    for (const ctx of this.current.boards.sourceContexts().values()) {
      if (ctx.kind !== 'model_output') continue;
      const to = this.now();
      const from = new Date(to.getTime() - 30 * 86_400_000);
      const ds = await ctx.source.load(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
      return qualityScoreNames(ds, ctx.settings);
    }
    return [];
  }
}
