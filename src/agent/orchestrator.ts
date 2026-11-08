/**
 * Orchestrator — the tool-calling loop.
 *
 * Three guards keep it bounded and cheap:
 * - MAX_TURNS caps the loop; hitting it produces an explicitly-flagged
 *   partial answer instead of a silent one.
 * - Large tool results are truncated before entering the LLM-facing history
 *   (the full JSON stays in the call log for programmatic consumers).
 * - After a few turns, old tool results are compressed to one-line summaries
 *   to stop O(n²) token growth across the conversation.
 */
import { type Sql } from 'postgres';
import { type WhydidConfig } from '../config/schema.js';
import { buildToolSchemas, executeTool } from '../tools/index.js';
import { buildSystemPrompt } from './system-prompt.js';
import { LlmClient, type ChatMessage } from './llm.js';

const MAX_TURNS = 12;
const MAX_TOOL_RESULT_CHARS = 2000;
const COMPRESS_AFTER_TURN = 4;
const KEEP_RECENT_TURNS = 2;

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  /** Full JSON result (or error) — not truncated. */
  result: string;
  duration_ms: number;
}

export interface AgentRunResult {
  report: string;
  tool_calls: ToolCallRecord[];
  usage: { prompt_tokens: number; completion_tokens: number };
}

export interface AgentRunOptions {
  verbose?: boolean;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  llm?: LlmClient;
  /** Injectable for tests; defaults to the current date. */
  today?: string;
}

export async function runAgent(
  config: WhydidConfig,
  db: Sql,
  question: string,
  opts: AgentRunOptions = {}
): Promise<AgentRunResult> {
  const llm = opts.llm ?? new LlmClient();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const tools = buildToolSchemas(config);
  const ctx = { config, db };

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(config, today) },
    { role: 'user', content: question },
  ];

  const log: ToolCallRecord[] = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await llm.chat(messages, tools);
    if (response.usage) {
      usage.prompt_tokens += response.usage.prompt_tokens;
      usage.completion_tokens += response.usage.completion_tokens;
    }

    const toolCalls = response.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        report: response.message.content ?? '(empty response)',
        tool_calls: log,
        usage,
      };
    }

    messages.push({
      role: 'assistant',
      content: response.message.content ?? undefined,
      tool_calls: toolCalls,
    });

    // Execute all tool calls of this turn concurrently (they share a
    // read-only pool), then append results in the original call order so
    // the OpenAI-format history stays aligned with tool_call ids.
    const executed = await Promise.all(
      toolCalls.map(async (call) => {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        opts.onToolCall?.(call.function.name, args);
        if (opts.verbose) {
          process.stderr.write(
            `[tool] ${call.function.name} ${JSON.stringify(args).slice(0, 200)}\n`
          );
        }

        const start = Date.now();
        let resultJson: string;
        try {
          const result = await executeTool(ctx, call.function.name, args);
          resultJson = JSON.stringify(result);
        } catch (err) {
          resultJson = JSON.stringify({
            error: true,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return { call, args, resultJson, duration: Date.now() - start };
      })
    );

    for (const { call, args, resultJson, duration } of executed) {
      if (opts.verbose) {
        process.stderr.write(`[tool] → ${resultJson.slice(0, 300)} (${duration}ms)\n`);
      }

      log.push({
        tool: call.function.name,
        args,
        result: resultJson,
        duration_ms: duration,
      });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content:
          resultJson.length > MAX_TOOL_RESULT_CHARS
            ? resultJson.slice(0, MAX_TOOL_RESULT_CHARS) +
              `…(truncated, ${resultJson.length} chars total)`
            : resultJson,
      });
    }

    if (turn >= COMPRESS_AFTER_TURN) {
      compressOldToolResults(messages);
    }
  }

  const lastAssistantText =
    [...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? '';
  return {
    report:
      `⚠ Reached the maximum of ${MAX_TURNS} tool-calling turns — this analysis is incomplete. ` +
      `Partial findings below; treat them as unverified.\n\n${lastAssistantText}`,
    tool_calls: log,
    usage,
  };
}

/**
 * Replace tool results older than the last KEEP_RECENT_TURNS assistant
 * tool-calling turns with one-line summaries. The LLM already consumed
 * them; it only needs a reminder of what it asked and roughly what came back.
 */
export function compressOldToolResults(messages: ChatMessage[]): void {
  const toolTurnIndices = messages
    .map((m, i) => (m.role === 'assistant' && m.tool_calls?.length ? i : -1))
    .filter((i) => i >= 0);
  const cutoff = toolTurnIndices[toolTurnIndices.length - KEEP_RECENT_TURNS];
  if (cutoff === undefined) return;

  for (let i = 0; i < cutoff; i++) {
    const msg = messages[i];
    if (msg?.role !== 'tool' || !msg.content || msg.content.startsWith('[compressed]')) {
      continue;
    }
    messages[i] = { ...msg, content: summarize(msg.name ?? 'tool', msg.content) };
  }
}

function summarize(toolName: string, content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.error) {
      return `[compressed] ${toolName} failed: ${String(parsed.message ?? '').slice(0, 100)}`;
    }
    const keep = [
      'total',
      'delta',
      'delta_pct',
      'period_a_total',
      'period_b_total',
      'delta_rate',
      'mix_effect',
      'behavior_effect',
      'stability',
    ];
    const parts = keep
      .filter((k) => parsed[k] != null && typeof parsed[k] !== 'object')
      .map((k) => `${k}=${formatShort(parsed[k])}`);
    if (Array.isArray(parsed.points)) parts.push(`${parsed.points.length} points`);
    if (Array.isArray(parsed.drivers)) parts.push(`${parsed.drivers.length} drivers`);
    // Keep the citation ref so earlier evidence can still be cited after compression.
    const ref = typeof parsed.ref === 'string' ? `${parsed.ref} ` : '';
    return `[compressed] ${ref}${toolName}: ${parts.join(' ') || Object.keys(parsed).join(',')}`;
  } catch {
    return `[compressed] ${toolName}: ${content.slice(0, 120)}`;
  }
}

function formatShort(value: unknown): string {
  return typeof value === 'number' ? String(Math.round(value * 10000) / 10000) : String(value);
}
