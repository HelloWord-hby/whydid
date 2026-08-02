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
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';

export class LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  readonly model: string;

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
  }

  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        temperature: 0,
        max_tokens: 4096,
      }),
    });

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
