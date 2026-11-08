import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmClient } from '../src/agent/llm.js';

const ok = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });

function client() {
  return new LlmClient({ baseUrl: 'https://llm.invalid/v1', apiKey: 'k', model: 'm', retryDelaysMs: [0, 0] });
}

afterEach(() => vi.unstubAllGlobals());

describe('LlmClient retries', () => {
  it('retries network errors, 429 and 5xx, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const r = await client().chat([{ role: 'user', content: 'hi' }], []);
    expect(r.message.content).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a request error such as 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad model', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().chat([], [])).rejects.toThrow(/LLM API error 400: bad model/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last retry with the cause', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().chat([], [])).rejects.toThrow(/unreachable after 3 attempts: fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
