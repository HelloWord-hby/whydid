/**
 * Workbench tool registry: semantic-layer tools over every SQL source,
 * model-output tools, and board tools — one flat list for one tool loop.
 *
 * Semantic tools take a `source` argument instead of being duplicated per
 * source, so connecting another database adds no tools, only catalog lines.
 * Metric and dimension names are validated by the underlying tools, whose
 * errors list the valid names so the agent can correct itself.
 */
import { z } from 'zod';
import { buildToolSchemas, executeTool, type ToolSchema } from '../tools/index.js';
import { type ToolContext } from '../tools/context.js';
import { ALLOWED_DAYS } from '../boards/window.js';
import { hintsForSemantic } from './hints.js';
import { MODEL_TOOLS } from './model-tools.js';
import { defineAgentTool, type AgentTool, type WorkbenchEnv } from './types.js';

const SEMANTIC_TOOL_NAMES = [
  'get_metric',
  'get_metric_trend',
  'compare_periods',
  'decompose_change_additive',
  'decompose_change_rate',
] as const;

const NAME_KEYS = new Set(['metric', 'group_by', 'dimension']);

/** Drop config-specific enums: names differ per source and are checked at run time. */
function genericParameters(params: Record<string, unknown>): Record<string, unknown> {
  const props = { ...(params.properties as Record<string, Record<string, unknown>>) };
  for (const key of Object.keys(props)) {
    if (NAME_KEYS.has(key)) {
      const { enum: _drop, ...rest } = props[key]!;
      props[key] = { ...rest, description: `${key === 'metric' ? 'Metric' : 'Dimension'} name of the chosen source (see the data catalog).` };
    }
    if (key === 'filters') {
      props[key] = { ...props[key]!, description: 'Optional filters: dimension name → value or array of values.' };
    }
  }
  return {
    ...params,
    properties: { source: { type: 'string', description: 'Semantic source id (see the data catalog).' }, ...props },
    required: ['source', ...((params.required as string[]) ?? [])],
  };
}

function sourceCtx(env: WorkbenchEnv, id: unknown): ToolContext {
  const ids = [...env.semantic.keys()];
  const ctx = typeof id === 'string' ? env.semantic.get(id) : undefined;
  if (!ctx) throw new Error(`Unknown source "${String(id)}". Semantic sources: ${ids.join(', ') || '(none)'}`);
  return ctx;
}

function semanticTools(env: WorkbenchEnv): AgentTool[] {
  const first = env.semantic.values().next().value as ToolContext | undefined;
  if (!first) return [];
  const schemas = new Map(buildToolSchemas(first.config).map((s) => [s.function.name, s.function]));
  return SEMANTIC_TOOL_NAMES.map((name) => {
    const base = schemas.get(name)!;
    return defineAgentTool({
      name,
      description: `${base.description} Works on any semantic source.`,
      parameters: genericParameters(base.parameters),
      args: z.object({ source: z.string() }).passthrough(),
      run: async (args, e) => {
        const { source, ...rest } = args as { source: string } & Record<string, unknown>;
        const ctx = sourceCtx(e, source);
        const result = (await executeTool(ctx, name, rest)) as Record<string, unknown>;
        return { source, ...result, next_hints: hintsForSemantic(name, result, ctx.config, source) };
      },
    });
  });
}

export const listCardsTool = defineAgentTool({
  name: 'list_cards',
  description: 'List dashboard boards and their cards (id, title, what it shows). Use to see what the user is looking at.',
  parameters: { type: 'object', properties: { board: { type: 'string', description: 'Only this board.' } } },
  args: z.object({ board: z.string().optional() }).strict(),
  run: async (args, env) => {
    const boards = env.boards.boardsConfig().filter((b) => !args.board || b.id === args.board);
    if (args.board && boards.length === 0) {
      throw new Error(`Unknown board "${args.board}". Boards: ${env.boards.boardsConfig().map((b) => b.id).join(', ')}`);
    }
    return {
      boards: boards.map((b) => ({
        id: b.id,
        title: b.title,
        source: b.source,
        cards: env.boards.cardsOnBoard(b.id).map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description ?? null,
          display: c.display,
          provider: c.provider,
        })),
      })),
    };
  },
});

export const readCardTool = defineAgentTool({
  name: 'read_card',
  description: 'Read one dashboard card exactly as the user sees it: the server-computed numbers for the chosen window.',
  parameters: {
    type: 'object',
    properties: {
      card_id: { type: 'string' },
      days: { type: 'number', enum: [...ALLOWED_DAYS], description: 'Window length, default 7.' },
    },
    required: ['card_id'],
  },
  args: z
    .object({ card_id: z.string(), days: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(7) })
    .strict(),
  run: async (args, env) => {
    const card = env.boards.cardConfig(args.card_id);
    if (!card) throw new Error(`Unknown card "${args.card_id}". Use list_cards to see card ids.`);
    const r = await env.boards.cardData(args.card_id, args.days, env.now());
    return {
      card: { id: card.id, title: card.title, board: card.board, provider: card.provider, params: card.params },
      mode: r.mode,
      window: r.window,
      data: r.data,
      ...(r.notes ? { caveats: r.notes } : {}),
    };
  },
});

export function buildAgentTools(env: WorkbenchEnv): AgentTool[] {
  return [...semanticTools(env), ...(env.model ? MODEL_TOOLS : []), listCardsTool, readCardTool];
}

export function toToolSchemas(tools: AgentTool[]): ToolSchema[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Validate and run one tool call. Errors are thrown with messages meant for the LLM. */
export async function runAgentTool(
  tools: AgentTool[],
  env: WorkbenchEnv,
  name: string,
  args: unknown
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}". Available: ${tools.map((t) => t.name).join(', ')}`);
  const parsed = tool.args.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid arguments for ${name} — ${issues}`);
  }
  return tool.run(parsed.data as never, env);
}
