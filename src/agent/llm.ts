/**
 * LLM client — any OpenAI-compatible chat-completions endpoint with tool
 * calling. Defaults to OpenRouter. Temperature is pinned to 0: the LLM's
 * job here is routing and narration, not creativity.
 */
import { type ToolSchema } from '../tools/index.js';

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ChatResponse {
  message: { content: string | null; tool_calls?: ChatToolCall[] };
  finish_reason: string;
  usage?: ChatUsage;
}

export interface LlmClientOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** Waits before each retry of a transient failure (tests pass zeros). */
  retryDelaysMs?: readonly number[];
}

const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_DELAYS_MS = [1_000, 4_000] as const;

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

export class LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  readonly model: string;
  private readonly retryDelays: readonly number[];

  constructor(opts: LlmClientOptions = {}) {
    this.baseUrl = (
      opts.baseUrl ??
      process.env.WHYDID_LLM_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    const key = opts.apiKey ?? process.env.WHYDID_LLM_API_KEY;
    if (!key) {
      throw new Error(
        'WHYDID_LLM_API_KEY is required. Any OpenAI-compatible endpoint works; see .env.example.'
      );
    }
    this.apiKey = key;
    this.model = opts.model ?? process.env.WHYDID_LLM_MODEL ?? DEFAULT_MODEL;
    this.retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  /**
   * One request, retried on transient failures: network errors, 429 and 5xx.
   * Other 4xx mean the request itself is wrong and are reported at once.
   */
  private async post(body: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response | undefined;
      let networkError: unknown;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        networkError = err;
      }
      const transient = networkError !== undefined || response!.status === 429 || response!.status >= 500;
      if (!transient || attempt >= this.retryDelays.length) {
        if (networkError !== undefined) {
          throw new Error(`LLM API unreachable after ${attempt + 1} attempts: ${networkError instanceof Error ? networkError.message : String(networkError)}`);
        }
        return response!;
      }
      await new Promise((r) => setTimeout(r, this.retryDelays[attempt]));
    }
  }

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const response = await this.post(
      JSON.stringify({
        model: this.model,
        messages,
        tools,
        temperature: 0,
        max_tokens: 4096,
      })
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM API error ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: { content: string | null; tool_calls?: ChatToolCall[] };
        finish_reason: string;
      }>;
      usage?: ChatUsage;
    };

    const choice = data.choices[0];
    if (!choice) {
      throw new Error('LLM API returned no choices.');
    }
    return {
      message: choice.message,
      finish_reason: choice.finish_reason,
      usage: data.usage,
    };
  }
}
