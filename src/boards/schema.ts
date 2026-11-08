/**
 * Boards config — whydid.boards.yaml.
 *
 * A board is a tab on the dashboard bound to one data source. A card is
 * pure configuration: which board it lives on, which provider computes
 * its data, the provider's params, and how to display the result. Adding
 * a card means adding an entry here; only a genuinely new kind of number
 * needs a new provider (one function in src/boards/providers/).
 */
import { z } from 'zod';
import { DISPLAYS } from './types.js';

const ID = z.string().regex(/^[a-z][a-z0-9_]*$/, 'ids are lower_snake_case');

export const modelSourceSchema = z.object({
  kind: z.literal('model_output'),
  feedback_score: z.string().default('user_feedback'),
  negative_feedback_value: z.number().default(0),
  low_score_threshold: z.number().default(0.5),
  /** Page cap per endpoint for live Langfuse fetches (100 items/page). */
  max_pages: z.number().int().positive().default(100),
});

export const semanticSourceSchema = z.object({
  kind: z.literal('semantic'),
  /** Path to a whydid semantic-layer config, relative to the boards file. */
  config: z.string(),
});

export const sourceSchema = z.discriminatedUnion('kind', [modelSourceSchema, semanticSourceSchema]);

export const boardSchema = z.object({
  id: ID,
  title: z.string(),
  description: z.string().optional(),
  source: ID,
});

export const cardSchema = z.object({
  id: ID,
  board: ID,
  title: z.string(),
  description: z.string().optional(),
  display: z.enum(DISPLAYS),
  provider: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  /** Default width in grid columns (the board grid has 4). */
  size: z.number().int().min(1).max(4).default(1),
  /** Shown on the board in the default layout; otherwise library-only. */
  default: z.boolean().default(false),
  /** Preset question for the "Ask the agent" button (semantic boards only). */
  ask: z.string().optional(),
});

export const boardsConfigSchema = z.object({
  sources: z.record(ID, sourceSchema),
  boards: z.array(boardSchema).min(1),
  cards: z.array(cardSchema),
});

export type ModelSourceConfig = z.infer<typeof modelSourceSchema>;
export type SemanticSourceConfig = z.infer<typeof semanticSourceSchema>;
export type SourceConfig = z.infer<typeof sourceSchema>;
export type BoardConfig = z.infer<typeof boardSchema>;
export type CardConfig = z.infer<typeof cardSchema>;
export type BoardsConfig = z.infer<typeof boardsConfigSchema>;

/** Structural checks that zod cannot express: uniqueness and references. */
export function checkReferences(cfg: BoardsConfig): void {
  const boardIds = new Set<string>();
  for (const b of cfg.boards) {
    if (boardIds.has(b.id)) throw new Error(`Duplicate board id "${b.id}".`);
    boardIds.add(b.id);
    if (!Object.hasOwn(cfg.sources, b.source)) {
      throw new Error(`Board "${b.id}" references unknown source "${b.source}".`);
    }
  }
  const cardIds = new Set<string>();
  for (const c of cfg.cards) {
    if (cardIds.has(c.id)) throw new Error(`Duplicate card id "${c.id}".`);
    cardIds.add(c.id);
    if (!boardIds.has(c.board)) {
      throw new Error(`Card "${c.id}" references unknown board "${c.board}".`);
    }
  }
}
