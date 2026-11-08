/** Shared fixtures for workbench tests: a BoardService on demo data and a scripted LLM. */
import { type Sql } from 'postgres';
import { type ChatMessage, type ChatResponse } from '../src/agent/llm.js';
import { configSchema, validateConfig, type WhydidConfig } from '../src/config/schema.js';
import { BoardService, parseBoardsConfig } from '../src/boards/service.js';
import { type ToolSchema } from '../src/tools/index.js';
import { buildWorkbenchEnv } from '../src/workbench/index.js';
import { type LlmLike } from '../src/workbench/session.js';
import { type WorkbenchEnv } from '../src/workbench/types.js';

export const NOW = new Date('2026-11-08T12:00:00Z');

export const mainConfig: WhydidConfig = validateConfig(
  configSchema.parse({
    table: 'conversations',
    time_column: 'created_at',
    context: 'Support assistant conversations.',
    metrics: {
      conversations: { kind: 'additive', expr: 'COUNT(*)', label: 'Conversations' },
      resolution_rate: { kind: 'rate', of: 'CASE WHEN resolved THEN 1.0 ELSE 0.0 END', note: 'Self-reported.' },
    },
    dimensions: { intent: { column: 'intent', values: { billing: 'Billing' } } },
  })
);

/** Answers every query with fixed rows; enough for compare/get_metric shapes. */
export const fakeDb = {
  unsafe: async () => [
    { segment: 'billing', value: '120', bucket: '2026-11-01' },
    { segment: 'how_to', value: '80', bucket: '2026-11-02' },
  ],
} as unknown as Sql;

export function demoBoards(): BoardService {
  return new BoardService(
    parseBoardsConfig({
      sources: { model: { kind: 'model_output' } },
      boards: [{ id: 'model_output', title: 'Model Output', source: 'model' }],
      cards: [
        { id: 'faithfulness', board: 'model_output', title: 'Faithfulness', display: 'stat', provider: 'score_average', params: { score: 'faithfulness' }, default: true },
        { id: 'samples', board: 'model_output', title: 'Low-score samples', display: 'table', provider: 'low_score_samples', default: true },
      ],
    }),
    '/tmp',
    { env: {} }
  );
}

export function demoEnv(): WorkbenchEnv {
  return buildWorkbenchEnv(demoBoards(), mainConfig, fakeDb, () => NOW);
}

type Step = { content?: string; calls?: Array<{ name: string; args: Record<string, unknown> }> };

/** A scripted LLM: returns the steps in order and records what it was sent. */
export class ScriptedLlm implements LlmLike {
  readonly seen: ChatMessage[][] = [];
  readonly toolLists: ToolSchema[][] = [];
  private i = 0;
  constructor(private readonly steps: Array<Step | ((messages: ChatMessage[]) => Step)>) {}

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    this.seen.push(structuredClone(messages));
    this.toolLists.push(tools);
    const raw = this.steps[Math.min(this.i++, this.steps.length - 1)]!;
    const step = typeof raw === 'function' ? raw(messages) : raw;
    return {
      message: {
        content: step.content ?? null,
        tool_calls: step.calls?.map((c, k) => ({
          id: `c${this.i}_${k}`,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args) },
        })),
      },
      finish_reason: step.calls ? 'tool_calls' : 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  }
}
