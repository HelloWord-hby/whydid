/**
 * Demo model-output dataset — what the Model Output board shows when no
 * Langfuse keys are configured.
 *
 * Synthetic traces and scores for an imaginary developer-tools support
 * assistant, generated with a fixed-seed PRNG so every run of the same
 * day produces identical numbers. One incident is injected so the board
 * has something to find: release v1.9 ships 4 days before "today" and
 * hurts faithfulness on the rag-answer route, with more thumbs-down there.
 */
import { type ModelDataset, type ModelScore, type ModelTrace } from './aggregate.js';

const DAYS = 60;
const TRACES_PER_DAY = 300;
const RELEASE_DAYS_AGO = 4;

const ROUTES: Array<[string, number]> = [
  ['chat', 45],
  ['rag-answer', 30],
  ['troubleshoot', 15],
  ['summarize', 10],
];

const QUALITY_BASE: Record<string, number> = {
  faithfulness: 0.86,
  relevance: 0.84,
  conciseness: 0.76,
  completeness: 0.8,
};

const JUDGE_COMMENTS: Record<string, string[]> = {
  faithfulness: [
    'States a CLI flag that does not appear in the retrieved docs.',
    'Quotes a rate limit that contradicts the pricing page snippet.',
    'Mixes up two SDK versions in the same answer.',
  ],
  relevance: ['Answers a different question than the one asked.', 'Drifts into unrelated setup steps.'],
  conciseness: ['Repeats the same caveat three times.', 'Long preamble before the actual answer.'],
  completeness: ['Skips the authentication step.', 'Does not cover the error case the user mentioned.'],
};

const FEEDBACK_COMMENTS = [
  'The command it gave me does not exist.',
  'Too long, I just needed the config key.',
  'Did not answer my question.',
  'Wrong version of the API.',
  '',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function generateDemoModelDataset(now: Date = new Date()): ModelDataset {
  const rand = mulberry32(20261108);
  const pick = <T>(weighted: Array<[T, number]>): T => {
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [value, weight] of weighted) {
      r -= weight;
      if (r <= 0) return value;
    }
    return weighted[weighted.length - 1]![0];
  };
  const pickOne = (items: string[]): string => items[Math.floor(rand() * items.length)]!;

  const end = new Date(now.getTime());
  end.setUTCHours(0, 0, 0, 0);

  const traces: ModelTrace[] = [];
  const scores: ModelScore[] = [];

  for (let daysAgo = DAYS; daysAgo >= 1; daysAgo--) {
    const day = new Date(end.getTime() - daysAgo * 86_400_000);
    const weekday = day.getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.65 : 1;
    const growth = 1 + (0.2 * (DAYS - daysAgo)) / DAYS;
    const volume = Math.round(TRACES_PER_DAY * weekend * growth * (0.9 + rand() * 0.2));
    const release = daysAgo <= RELEASE_DAYS_AGO ? 'v1.9' : 'v1.8';
    const dayKey = day.toISOString().slice(0, 10);

    for (let i = 0; i < volume; i++) {
      const route = pick(ROUTES);
      const ts = new Date(day.getTime() + Math.floor(rand() * 86_400) * 1000).toISOString();
      const id = `tr_${dayKey}_${String(i).padStart(4, '0')}`;
      const incident = release === 'v1.9' && route === 'rag-answer';

      traces.push({
        id,
        timestamp: ts,
        name: route,
        release,
        latency: Number((1.2 + rand() * (route === 'troubleshoot' ? 6 : 3.5)).toFixed(2)),
        cost: Number((0.0008 + rand() * 0.004).toFixed(5)),
      });

      let worst = 1;
      for (const [name, base] of Object.entries(QUALITY_BASE)) {
        const center = incident && name === 'faithfulness' ? 0.56 : base;
        // Mostly near the center, with a thin tail of bad answers.
        const tail = rand() < 0.04 ? 0.35 : 0;
        const value = Number(clamp01(center + (rand() - 0.5) * 0.32 - tail).toFixed(3));
        worst = Math.min(worst, value);
        scores.push({
          traceId: id,
          name,
          value,
          dataType: 'NUMERIC',
          timestamp: ts,
          comment: value < 0.5 ? pickOne(JUDGE_COMMENTS[name] ?? ['']) : null,
        });
      }

      if (rand() < 0.1) {
        const pDown = worst < 0.5 ? 0.55 : 0.12;
        const down = rand() < pDown;
        scores.push({
          traceId: id,
          name: 'user_feedback',
          value: down ? 0 : 1,
          dataType: 'BOOLEAN',
          timestamp: ts,
          comment: down ? pickOne(FEEDBACK_COMMENTS) || null : null,
        });
      }
    }
  }
  return { traces, scores, truncated: false };
}
