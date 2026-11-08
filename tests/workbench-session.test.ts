import { describe, expect, it } from 'vitest';
import { type ChatMessage } from '../src/agent/llm.js';
import { Workbench } from '../src/workbench/index.js';
import { MAX_TURNS, type AgentEvent } from '../src/workbench/session.js';
import { demoEnv, ScriptedLlm } from './workbench-helpers.js';

function collect(): { events: AgentEvent[]; emit: (e: AgentEvent) => void } {
  const events: AgentEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

function toolMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!) as Record<string, unknown>);
}

describe('agent session', () => {
  it('injects the card as ref #1, numbers later calls in order, and checks the answer', async () => {
    const wb = new Workbench(demoEnv());
    const s = wb.createSession();
    const llm = new ScriptedLlm([
      { content: 'Looking.', calls: [{ name: 'score_summary', args: { days: 7 } }, { name: 'low_score_breakdown', args: { days: 7, group_by: 'route' } }] },
      (messages) => {
        const card = toolMessages(messages)[0]!;
        const value = (card.data as { value: number }).value;
        return { content: `**Conclusion** — Faithfulness is ${value.toFixed(3)} [#1], unproven 99.9% [#2].` };
      },
    ]);
    const { events, emit } = collect();
    await s.send({ text: 'Why?', entry: 'card', card: 'faithfulness', days: 7 }, llm, emit, '2026-11-08');

    const first = llm.seen[0]!;
    expect(first[0]!.role).toBe('system');
    expect(first[1]!.content).toMatch(/^<context>[\s\S]*playbook: explain_card[\s\S]*card: faithfulness/);
    expect(first[2]!.tool_calls![0]!.function.name).toBe('read_card');
    expect(toolMessages(first)[0]!.ref).toBe('#1');

    const starts = events.filter((e) => e.type === 'tool_start') as Array<Extract<AgentEvent, { type: 'tool_start' }>>;
    expect(starts.map((e) => [e.ref, e.tool, e.injected])).toEqual([
      [1, 'read_card', true],
      [2, 'score_summary', false],
      [3, 'low_score_breakdown', false],
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'turn_start', 'tool_start', 'tool_end', 'text', 'tool_start', 'tool_start', 'tool_end', 'tool_end', 'answer', 'done',
    ]);
    const done = events.at(-1) as Extract<AgentEvent, { type: 'done' }>;
    expect(done.grounding).toEqual({ checked: 2, ungrounded: ['99.9%'] });
    expect(done.calls).toBe(3);
    expect(done.usage).toEqual({ prompt_tokens: 20, completion_tokens: 10 });
    expect(s.transcript.map((t) => t.role)).toEqual(['user', 'agent']);
  });

  it('keeps history across turns: board review, then a follow-up with continuing refs', async () => {
    const wb = new Workbench(demoEnv());
    const s = wb.createSession();
    const llm = new ScriptedLlm([
      { calls: [{ name: 'read_card', args: { card_id: 'faithfulness' } }] },
      { content: 'Board reviewed.' },
      { calls: [{ name: 'feedback_summary', args: {} }] },
      { content: 'Follow-up done.' },
    ]);
    await s.send({ text: 'Review', entry: 'board', board: 'model_output' }, llm);
    const { events, emit } = collect();
    await s.send({ text: 'and thumbs-down?', entry: 'chat' }, llm, emit);

    expect(llm.seen[0]![2]!.tool_calls![0]!.function.name).toBe('list_cards');
    expect((events[0] as Extract<AgentEvent, { type: 'turn_start' }>).playbook).toBe('followup');
    const start = events.find((e) => e.type === 'tool_start') as Extract<AgentEvent, { type: 'tool_start' }>;
    expect(start.ref).toBe(3);
    const lastPrompt = llm.seen.at(-1)!;
    expect(lastPrompt.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(s.calls.map((c) => c.tool)).toEqual(['list_cards', 'read_card', 'feedback_summary']);
  });

  it('feeds tool errors back to the LLM instead of failing the turn', async () => {
    const s = new Workbench(demoEnv()).createSession();
    const llm = new ScriptedLlm([
      { calls: [{ name: 'compare_periods', args: { source: 'nowhere', metric: 'x', period_b: { from: '2026-11-01', to: '2026-11-08' } } }] },
      { content: 'Could not answer.' },
    ]);
    const { events, emit } = collect();
    await s.send({ text: 'q', entry: 'chat' }, llm, emit);
    const end = events.find((e) => e.type === 'tool_end') as Extract<AgentEvent, { type: 'tool_end' }>;
    expect(end.ok).toBe(false);
    expect(toolMessages(llm.seen[1]!)[0]).toMatchObject({ ref: '#1', error: true });
    expect(events.at(-1)!.type).toBe('done');
  });

  it('stops at the turn limit with a flagged partial answer', async () => {
    const s = new Workbench(demoEnv()).createSession();
    const llm = new ScriptedLlm([{ content: 'still digging', calls: [{ name: 'list_cards', args: {} }] }]);
    const { events, emit } = collect();
    await s.send({ text: 'q', entry: 'chat' }, llm, emit);
    const answer = events.find((e) => e.type === 'answer') as Extract<AgentEvent, { type: 'answer' }>;
    expect(answer.partial).toBe(true);
    expect(answer.text).toContain(`limit of ${MAX_TURNS}`);
    expect(s.calls).toHaveLength(MAX_TURNS);
  });

  it('reports bad references and concurrent turns as errors', async () => {
    const s = new Workbench(demoEnv()).createSession();
    const { events, emit } = collect();
    await s.send({ text: 'q', entry: 'card', card: 'ghost' }, new ScriptedLlm([{ content: 'x' }]), emit);
    expect(events).toEqual([{ type: 'error', message: 'Unknown card "ghost".' }]);

    let release: () => void = () => {};
    const slow = { chat: () => new Promise<never>((_, reject) => { release = () => reject(new Error('stopped')); }) };
    const pending = s.send({ text: 'q', entry: 'chat' }, slow);
    await expect(s.send({ text: 'q2', entry: 'chat' }, slow)).rejects.toThrow(/already running/);
    release();
    await pending;
    expect(s.busy).toBe(false);
  });
});
