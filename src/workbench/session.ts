/**
 * Agent session — a multi-turn conversation with one flat tool loop.
 *
 * Each turn:
 *   1. builds the L5 context block and the user message;
 *   2. for card / board entries, runs read_card / list_cards itself and
 *      records it as a real tool call, so the card's numbers enter the
 *      conversation as citable evidence (ref #n), not as prose;
 *   3. loops: LLM picks tools → tools run in parallel → results go back
 *      tagged with their ref → until the LLM answers or MAX_TURNS hits;
 *   4. checks the answer's numbers against all tool results.
 *
 * Every step is emitted as an event so the UI can show it live.
 */
import { randomUUID } from 'node:crypto';
import { compressOldToolResults } from '../agent/orchestrator.js';
import { type ChatMessage, type ChatResponse, type ChatToolCall } from '../agent/llm.js';
import { type ToolSchema } from '../tools/index.js';
import { checkGrounding, type GroundingReport } from './grounding.js';
import {
  choosePlaybook,
  contextBlock,
  type AssembledPrompt,
  type Entry,
  type Playbook,
} from './prompt.js';
import { runAgentTool, toToolSchemas } from './tools.js';
import { type AgentTool, type WorkbenchEnv } from './types.js';

export const MAX_TURNS = 12;
const MAX_RESULT_CHARS_FOR_LLM = 4000;
const MAX_RESULT_CHARS_FOR_UI = 8000;
const COMPRESS_AFTER_TURN = 4;

export interface LlmLike {
  readonly model?: string;
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse>;
}

export interface UserTurn {
  text: string;
  entry: Entry;
  board?: string;
  card?: string;
  days?: number;
}

export type AgentEvent =
  | { type: 'turn_start'; playbook: Playbook; prompt_version: string }
  | { type: 'tool_start'; ref: number; tool: string; args: unknown; injected: boolean }
  | { type: 'tool_end'; ref: number; tool: string; ms: number; ok: boolean; result: string }
  | { type: 'text'; text: string }
  | { type: 'answer'; text: string; partial: boolean }
  | {
      type: 'done';
      usage: { prompt_tokens: number; completion_tokens: number };
      calls: number;
      prompt_version: string;
      grounding: GroundingReport;
    }
  | { type: 'error'; message: string };

export interface CallRecord {
  ref: number;
  tool: string;
  args: unknown;
  ok: boolean;
  result: unknown;
  ms: number;
  injected: boolean;
}

export type TranscriptItem =
  | { role: 'user'; text: string; entry: Entry; board?: string; card?: string; days: number }
  | { role: 'agent'; events: AgentEvent[] };

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…(truncated, ${s.length} chars)` : s;
}

export class AgentSession {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  lastUsed = Date.now();
  busy = false;
  readonly transcript: TranscriptItem[] = [];
  readonly calls: CallRecord[] = [];
  private readonly messages: ChatMessage[];
  private readonly schemas: ToolSchema[];
  private playbook: Playbook | undefined;

  constructor(
    private readonly env: WorkbenchEnv,
    private readonly tools: AgentTool[],
    private readonly system: AssembledPrompt
  ) {
    this.messages = [{ role: 'system', content: system.text }];
    this.schemas = toToolSchemas(tools);
  }

  get promptVersion(): string {
    return this.system.version;
  }

  /** Validate the turn's board/card references before anything runs. */
  private resolveTurn(turn: UserTurn): { board?: { id: string; title: string }; card?: { id: string; title: string; provider: string } } {
    const card = turn.card ? this.env.boards.cardConfig(turn.card) : undefined;
    if (turn.card && !card) throw new Error(`Unknown card "${turn.card}".`);
    const boardId = turn.board ?? card?.board;
    const board = boardId ? this.env.boards.boardsConfig().find((b) => b.id === boardId) : undefined;
    if (boardId && !board) throw new Error(`Unknown board "${boardId}".`);
    if (turn.entry === 'card' && !card) throw new Error('A card entry needs a card id.');
    if (turn.entry === 'board' && !board) throw new Error('A board entry needs a board id.');
    return {
      board: board ? { id: board.id, title: board.title } : undefined,
      card: card ? { id: card.id, title: card.title, provider: card.provider } : undefined,
    };
  }

  private async execute(
    call: { id: string; name: string; args: unknown },
    injected: boolean,
    emit: (e: AgentEvent) => void,
    events: AgentEvent[]
  ): Promise<ChatMessage> {
    const ref = this.calls.length + 1;
    const record: CallRecord = { ref, tool: call.name, args: call.args, ok: true, result: null, ms: 0, injected };
    this.calls.push(record);
    const start: AgentEvent = { type: 'tool_start', ref, tool: call.name, args: call.args, injected };
    events.push(start);
    emit(start);

    const t0 = Date.now();
    let payload: Record<string, unknown>;
    try {
      const result = await runAgentTool(this.tools, this.env, call.name, call.args);
      record.result = result;
      payload = { ref: `#${ref}`, ...(result as Record<string, unknown>) };
    } catch (err) {
      record.ok = false;
      const message = err instanceof Error ? err.message : String(err);
      record.result = { error: message };
      payload = { ref: `#${ref}`, error: true, message };
    }
    record.ms = Date.now() - t0;
    const json = JSON.stringify(payload);
    const end: AgentEvent = {
      type: 'tool_end',
      ref,
      tool: call.name,
      ms: record.ms,
      ok: record.ok,
      result: truncate(json, MAX_RESULT_CHARS_FOR_UI),
    };
    events.push(end);
    emit(end);
    return { role: 'tool', tool_call_id: call.id, name: call.name, content: truncate(json, MAX_RESULT_CHARS_FOR_LLM) };
  }

  /** Run tools the server knows the user wants, recorded as a normal assistant tool call. */
  private async inject(
    calls: Array<{ name: string; args: Record<string, unknown> }>,
    emit: (e: AgentEvent) => void,
    events: AgentEvent[]
  ): Promise<void> {
    const toolCalls: ChatToolCall[] = calls.map((c, i) => ({
      id: `inj_${this.calls.length + i + 1}`,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
    this.messages.push({ role: 'assistant', tool_calls: toolCalls });
    for (const [i, c] of calls.entries()) {
      this.messages.push(await this.execute({ id: toolCalls[i]!.id, name: c.name, args: c.args }, true, emit, events));
    }
  }

  async send(turn: UserTurn, llm: LlmLike, emit: (e: AgentEvent) => void = () => {}, today?: string): Promise<void> {
    if (this.busy) throw new Error('This session is already running a turn.');
    this.busy = true;
    this.lastUsed = Date.now();
    const events: AgentEvent[] = [];
    const days = turn.days ?? 7;
    try {
      const { board, card } = this.resolveTurn(turn);
      this.playbook = choosePlaybook(turn.entry, card?.provider, this.playbook);
      this.transcript.push({ role: 'user', text: turn.text, entry: turn.entry, board: board?.id, card: card?.id, days });
      this.transcript.push({ role: 'agent', events });

      const startEvent: AgentEvent = { type: 'turn_start', playbook: this.playbook, prompt_version: this.system.version };
      events.push(startEvent);
      emit(startEvent);

      const ctx = contextBlock({
        today: today ?? this.env.now().toISOString().slice(0, 10),
        entry: turn.entry,
        playbook: this.playbook,
        board,
        card: card ? { id: card.id, title: card.title } : undefined,
        days,
      });
      this.messages.push({ role: 'user', content: `${ctx}\n\n${turn.text}` });

      if (turn.entry === 'card' && card) await this.inject([{ name: 'read_card', args: { card_id: card.id, days } }], emit, events);
      if (turn.entry === 'board' && board) await this.inject([{ name: 'list_cards', args: { board: board.id } }], emit, events);

      await this.loop(llm, emit, events);
    } catch (err) {
      const e: AgentEvent = { type: 'error', message: err instanceof Error ? err.message : String(err) };
      events.push(e);
      emit(e);
    } finally {
      this.busy = false;
      this.lastUsed = Date.now();
    }
  }

  private async loop(llm: LlmLike, emit: (e: AgentEvent) => void, events: AgentEvent[]): Promise<void> {
    const usage = { prompt_tokens: 0, completion_tokens: 0 };
    const finish = (text: string, partial: boolean): void => {
      const answer: AgentEvent = { type: 'answer', text, partial };
      events.push(answer);
      emit(answer);
      const done: AgentEvent = {
        type: 'done',
        usage,
        calls: this.calls.length,
        prompt_version: this.system.version,
        grounding: checkGrounding(text, this.calls.filter((c) => c.ok).map((c) => c.result)),
      };
      events.push(done);
      emit(done);
    };

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await llm.chat(this.messages, this.schemas);
      if (response.usage) {
        usage.prompt_tokens += response.usage.prompt_tokens;
        usage.completion_tokens += response.usage.completion_tokens;
      }
      const toolCalls = response.message.tool_calls ?? [];
      const content = response.message.content ?? '';

      if (toolCalls.length === 0) {
        this.messages.push({ role: 'assistant', content });
        finish(content || '(empty response)', false);
        return;
      }

      if (content.trim()) {
        const text: AgentEvent = { type: 'text', text: content };
        events.push(text);
        emit(text);
      }
      this.messages.push({ role: 'assistant', content: content || undefined, tool_calls: toolCalls });

      const parsed = toolCalls.map((c) => {
        let args: unknown = {};
        try {
          args = JSON.parse(c.function.arguments || '{}');
        } catch {
          args = { __unparseable: c.function.arguments };
        }
        return { id: c.id, name: c.function.name, args };
      });
      // Refs are assigned in call order before the calls run concurrently.
      const results = await Promise.all(parsed.map((c) => this.execute(c, false, emit, events)));
      this.messages.push(...results);
      if (turn >= COMPRESS_AFTER_TURN) compressOldToolResults(this.messages);
    }

    const last = [...this.messages].reverse().find((m) => m.role === 'assistant' && m.content)?.content ?? '';
    finish(
      `⚠ Reached the limit of ${MAX_TURNS} tool-calling rounds — this analysis is incomplete and unverified.\n\n${last}`,
      true
    );
  }
}
