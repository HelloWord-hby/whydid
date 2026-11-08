/**
 * Board service — loads whydid.boards.yaml, binds each board to its data
 * source, validates every card against its provider at startup, and
 * serves the catalog and per-card data to the HTTP layer.
 *
 * Validation is fail-fast: a typo in a card's metric name stops the
 * server from starting instead of surfacing as a broken card later.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { type Sql } from 'postgres';
import { loadConfig } from '../config/load.js';
import { type WhydidConfig } from '../config/schema.js';
import { createModelSource, type LangfuseEnv } from './model/source.js';
import { getProvider } from './providers/index.js';
import { type AnyProvider, type SourceContext } from './providers/types.js';
import {
  boardsConfigSchema,
  checkReferences,
  type BoardConfig,
  type BoardsConfig,
  type CardConfig,
} from './schema.js';
import { type CardResponse } from './types.js';
import { buildWindow } from './window.js';

export const DEFAULT_BOARDS_PATH = 'whydid.boards.yaml';

interface BoundCard {
  config: CardConfig;
  provider: AnyProvider;
  params: unknown;
  sourceId: string;
}

export interface CatalogCard {
  id: string;
  board: string;
  title: string;
  description?: string;
  display: CardConfig['display'];
  provider: string;
  size: number;
  default: boolean;
  ask?: string;
}

export interface CatalogBoard extends BoardConfig {
  source_kind: SourceContext['kind'];
  mode: 'live' | 'demo';
  /** Default layout: card ids in config order with their default sizes. */
  default_layout: Array<{ id: string; size: number }>;
}

export interface Catalog {
  boards: CatalogBoard[];
  cards: CatalogCard[];
}

export interface BoardServiceDeps {
  db?: Sql;
  env?: LangfuseEnv;
  /** Load a semantic config by absolute path (injectable for tests). */
  loadSemantic?: (path: string) => WhydidConfig;
}

export function parseBoardsConfig(raw: unknown): BoardsConfig {
  const parsed = boardsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid boards config:\n${issues}`);
  }
  checkReferences(parsed.data);
  return parsed.data;
}

export function loadBoardsFile(path: string): { config: BoardsConfig; baseDir: string } {
  const filePath = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Boards config not found at ${filePath}.`);
  }
  return { config: parseBoardsConfig(parse(raw)), baseDir: dirname(filePath) };
}

export class BoardService {
  private readonly sources = new Map<string, SourceContext>();
  private readonly semanticConfigs = new Map<string, WhydidConfig>();
  private readonly cards = new Map<string, BoundCard>();

  constructor(
    private readonly config: BoardsConfig,
    baseDir: string,
    deps: BoardServiceDeps
  ) {
    for (const [id, src] of Object.entries(config.sources)) {
      if (src.kind === 'model_output') {
        this.sources.set(id, {
          kind: 'model_output',
          source: createModelSource(deps.env ?? {}, src.max_pages),
          settings: {
            feedback_score: src.feedback_score,
            negative_feedback_value: src.negative_feedback_value,
            low_score_threshold: src.low_score_threshold,
          },
        });
      } else {
        if (!deps.db) throw new Error(`Source "${id}" needs a database connection.`);
        const semantic = (deps.loadSemantic ?? loadConfig)(resolve(baseDir, src.config));
        this.semanticConfigs.set(id, semantic);
        this.sources.set(id, { kind: 'semantic', tool: { config: semantic, db: deps.db } });
      }
    }

    for (const card of config.cards) {
      const board = this.board(card.board);
      const ctx = this.sources.get(board.source)!;
      const provider = getProvider(card.provider);
      const where = `Card "${card.id}"`;
      if (provider.source !== ctx.kind) {
        throw new Error(
          `${where}: provider "${card.provider}" reads ${provider.source} data, but board "${board.id}" is bound to a ${ctx.kind} source.`
        );
      }
      if (!provider.displays.includes(card.display)) {
        throw new Error(
          `${where}: provider "${card.provider}" cannot render as "${card.display}" (supports ${provider.displays.join(', ')}).`
        );
      }
      const parsed = provider.params.safeParse(card.params);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(params)'}: ${i.message}`);
        throw new Error(`${where}: invalid params — ${issues.join('; ')}`);
      }
      try {
        provider.validate?.(parsed.data, ctx, card.display);
      } catch (err) {
        throw new Error(`${where}: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.cards.set(card.id, { config: card, provider, params: parsed.data, sourceId: board.source });
    }
  }

  private board(id: string): BoardConfig {
    const b = this.config.boards.find((x) => x.id === id);
    if (!b) throw new Error(`Unknown board "${id}".`);
    return b;
  }

  catalog(): Catalog {
    const boards = this.config.boards.map((b): CatalogBoard => {
      const ctx = this.sources.get(b.source)!;
      return {
        ...b,
        source_kind: ctx.kind,
        mode: ctx.kind === 'model_output' ? ctx.source.mode : 'live',
        default_layout: this.config.cards
          .filter((c) => c.board === b.id && c.default)
          .map((c) => ({ id: c.id, size: c.size })),
      };
    });
    const cards = this.config.cards.map(
      (c): CatalogCard => ({
        id: c.id,
        board: c.board,
        title: c.title,
        description: c.description,
        display: c.display,
        provider: c.provider,
        size: c.size,
        default: c.default,
        ask: c.ask,
      })
    );
    return { boards, cards };
  }

  hasCard(id: string): boolean {
    return this.cards.has(id);
  }

  /** Source contexts by id — the agent's tools read through the same objects as the cards. */
  sourceContexts(): ReadonlyMap<string, SourceContext> {
    return this.sources;
  }

  boardsConfig(): readonly BoardConfig[] {
    return this.config.boards;
  }

  cardConfig(id: string): CardConfig | undefined {
    return this.cards.get(id)?.config;
  }

  cardsOnBoard(boardId: string): CardConfig[] {
    return this.config.cards.filter((c) => c.board === boardId);
  }

  /** The semantic config behind a board, for routing "Ask the agent". */
  semanticConfigForBoard(boardId: string): WhydidConfig | undefined {
    const b = this.config.boards.find((x) => x.id === boardId);
    return b ? this.semanticConfigs.get(b.source) : undefined;
  }

  async cardData(id: string, days: number, now: Date = new Date()): Promise<CardResponse> {
    const bound = this.cards.get(id);
    if (!bound) throw new Error(`Unknown card "${id}".`);
    const ctx = this.sources.get(bound.sourceId)!;
    const win = buildWindow(days, now);
    const data = await bound.provider.run(bound.params, ctx, win, bound.config.display);
    const mode = ctx.kind === 'model_output' ? ctx.source.mode : 'live';
    const notes: string[] = [];
    if (ctx.kind === 'model_output') {
      const ds = await ctx.source.load(win.previous.from, win.current.to);
      if (ds.truncated) notes.push('Langfuse fetch hit the page cap; numbers cover a partial window.');
    }
    return {
      card: id,
      source: bound.sourceId,
      mode,
      window: win,
      data,
      generated_at: new Date().toISOString(),
      ...(notes.length ? { notes } : {}),
    };
  }
}

export function createBoardService(path: string, deps: BoardServiceDeps): BoardService {
  const { config, baseDir } = loadBoardsFile(path);
  return new BoardService(config, baseDir, deps);
}
