/**
 * Mock LLM — an OpenAI-compatible chat-completions endpoint that drives the
 * workbench agent without an API key, for local development and demos.
 *
 *   npx tsx scripts/mock-llm.ts                     # serves on :4010
 *   WHYDID_LLM_BASE_URL=http://localhost:4010/v1 WHYDID_LLM_API_KEY=mock \
 *     npm run dev -- serve
 *
 * It is scripted, not intelligent: round one calls tools chosen from the
 * context block (board / playbook), round two writes an answer that quotes
 * numbers from those tool results with their [#ref]. Everything else — tool
 * execution, refs, streaming, grounding — is the real pipeline.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 4010);
const DELAY_MS = Number(process.env.MOCK_LLM_DELAY_MS ?? 400);

interface Msg {
  role: string;
  content?: string | null;
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
}

type Json = Record<string, unknown>;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lastDays(n: number): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  return { from: isoDay(new Date(to.getTime() - n * 86_400_000)), to: isoDay(to) };
}

function contextOf(text: string): Record<string, string> {
  const block = /<context>([\s\S]*?)<\/context>/.exec(text)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().split(' ')[0]!.replace(/"/g, '');
  }
  return out;
}

function planTools(ctx: Record<string, string>, toolNames: Set<string>): Array<{ name: string; args: Json }> {
  const days = Number(/last (\d+)/.exec(ctx.window ?? '')?.[1] ?? 7);
  const period = lastDays(days);
  const has = (n: string) => toolNames.has(n);
  if (ctx.playbook === 'sample_review' && has('low_score_samples')) {
    return [
      { name: 'low_score_samples', args: { days, limit: 3 } },
      { name: 'low_score_breakdown', args: { days, group_by: 'release' } },
    ];
  }
  if (ctx.board === 'model_output' && has('score_summary')) {
    return [
      { name: 'score_summary', args: { days } },
      { name: 'low_score_breakdown', args: { days, group_by: 'route' } },
    ];
  }
  const source = ctx.board === 'product_events' ? 'events' : 'main';
  const metric = source === 'events' ? 'sessions' : 'conversations';
  const dimension = source === 'events' ? 'entry' : 'intent';
  const previous = { from: isoDay(new Date(Date.parse(period.from) - days * 86_400_000)), to: period.from };
  return [
    { name: 'compare_periods', args: { source, metric, period_b: period, compare_to: 'prev_period' } },
    { name: 'decompose_change_additive', args: { source, metric, period_a: previous, period_b: period, dimension } },
  ];
}

function pct(v: unknown): string {
  return typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : 'n/a';
}

function num(v: unknown, digits = 3): string {
  return typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(digits)) : 'n/a';
}

/** One evidence line per tool result, numbers copied from the result. */
function evidence(name: string, r: Json): string | null {
  const ref = `[${String(r.ref)}]`;
  if (r.error) return `- ${name} failed: ${String(r.message)} ${ref}`;
  if (name === 'score_summary') {
    const scores = (r.scores as Json[]).filter((s) => typeof s.delta_avg === 'number');
    const worst = scores.sort((a, b) => (a.delta_avg as number) - (b.delta_avg as number))[0];
    return worst
      ? `- ${String(worst.score)} average ${num(worst.current_avg)} vs ${num(worst.baseline_avg)} in the baseline ${ref}`
      : null;
  }
  if (name === 'low_score_breakdown') {
    const top = (r.rows as Json[])[0];
    return top
      ? `- Highest low-score rate: ${String(r.group_by)} "${String(top.group)}" at ${pct(top.low_rate)} vs ${pct(top.previous_low_rate)} before ${ref}`
      : null;
  }
  if (name === 'compare_periods') {
    return `- ${String(r.metric)}: ${num(r.period_b_total)} vs ${num(r.period_a_total)} (${num(r.delta_pct, 1)}%) ${ref}`;
  }
  if (name === 'decompose_change_additive') {
    const top = [...((r.growth_drivers as Json[]) ?? []), ...((r.drag_drivers as Json[]) ?? [])].sort(
      (a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number)
    )[0];
    return top ? `- Largest contributor: ${String(r.dimension)} "${String(top.segment)}" with a change of ${num(top.delta)} ${ref}` : null;
  }
  if (name === 'low_score_samples') {
    const first = (r.samples as Json[])[0];
    return `- ${num(r.matching_total)} low-scored answers in the window${first ? `; worst is trace ${String(first.trace_id)} on ${String(first.route)}` : ''} ${ref}`;
  }
  if (name === 'read_card') {
    const d = r.data as Json;
    return d.display === 'stat' ? `- The card shows ${num(d.value)} vs ${num(d.previous)} before ${ref}` : `- Read the card "${String((r.card as Json).title)}" ${ref}`;
  }
  return null;
}

function answer(messages: Msg[], start: number): string {
  const names = new Map<string, string>();
  for (const m of messages.slice(start)) for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
  const lines: string[] = [];
  for (const m of messages.slice(start)) {
    if (m.role !== 'tool' || !m.content) continue;
    try {
      const r = JSON.parse(m.content) as Json;
      const name = (m as unknown as { name?: string }).name ?? '';
      const line = evidence(name, r);
      if (line) lines.push(line);
    } catch {
      /* truncated result — skip */
    }
  }
  return [
    '**Conclusion** — (mock LLM) The tools below located where the change concentrates; this text is scripted for local testing.',
    '',
    '**Evidence**',
    ...lines,
    '',
    '**Next step** — Configure a real LLM key to get an actual analysis.',
    '',
    '**Limits** — Answer written by scripts/mock-llm.ts, not by a model.',
  ].join('\n');
}

let callSeq = 0;

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      messages: Msg[];
      tools?: Array<{ function: { name: string } }>;
    };
    const messages = body.messages;
    let lastUser = -1;
    messages.forEach((m, i) => {
      if (m.role === 'user') lastUser = i;
    });
    const ctx = contextOf(messages[lastUser]?.content ?? '');
    const ownRounds = messages
      .slice(lastUser + 1)
      .filter((m) => m.role === 'assistant' && m.tool_calls?.some((c) => !c.id.startsWith('inj_'))).length;

    let message: Json;
    if (ownRounds === 0) {
      const plan = planTools(ctx, new Set((body.tools ?? []).map((t) => t.function.name)));
      message = {
        role: 'assistant',
        content: 'Checking the change first, then where it concentrates.',
        tool_calls: plan.map((p) => ({
          id: `call_${++callSeq}`,
          type: 'function',
          function: { name: p.name, arguments: JSON.stringify(p.args) },
        })),
      };
    } else {
      message = { role: 'assistant', content: answer(messages, lastUser + 1) };
    }
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 120 },
        })
      );
    }, DELAY_MS);
  });
});

server.listen(PORT, () => {
  process.stdout.write(`Mock LLM on http://localhost:${PORT}/v1 — scripted, for local testing only.\n`);
});
