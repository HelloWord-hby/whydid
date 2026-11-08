/**
 * Prompt assembly — six layers, two placements.
 *
 *   system message (stable for a whole session, cache-friendly):
 *     L1 principles   prompts/01-principles.md
 *     L2 data catalog generated from the configs
 *     L3 tool policy  prompts/03-tool-policy.md
 *     L4 playbooks    prompts/04-playbooks.md (all of them; L5 picks one)
 *     L6 output       prompts/06-output.md
 *   per-turn context block, prepended to the user's message:
 *     L5 today, entry, playbook, board, card, window
 *
 * The playbook is chosen by the UI entry point, not guessed by the LLM.
 * The assembled system text is hashed into a version id that is logged
 * with every run, so answers can be traced to the exact prompt.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { labelForValue, type WhydidConfig } from '../config/schema.js';
import { type WorkbenchEnv } from './types.js';

export const PROMPT_FILES = ['01-principles.md', '03-tool-policy.md', '04-playbooks.md', '06-output.md'] as const;
export type PromptFiles = Record<(typeof PROMPT_FILES)[number], string>;

export const PLAYBOOKS = ['explain_change', 'explain_card', 'board_review', 'sample_review', 'followup'] as const;
export type Playbook = (typeof PLAYBOOKS)[number];

export const ENTRIES = ['chat', 'card', 'board'] as const;
export type Entry = (typeof ENTRIES)[number];

const PROMPTS_DIR = new URL('../../prompts/', import.meta.url);
const SAMPLE_PROVIDERS = new Set(['low_score_samples', 'feedback_samples']);

export function loadPromptFiles(dir: URL = PROMPTS_DIR): PromptFiles {
  const out = {} as PromptFiles;
  for (const f of PROMPT_FILES) out[f] = readFileSync(new URL(f, dir), 'utf8').trim();
  return out;
}

function semanticSection(id: string, config: WhydidConfig): string {
  const metrics = Object.entries(config.metrics)
    .map(([name, m]) =>
      [`- \`${name}\` (${m.kind})`, m.label ? `— ${m.label}` : '', m.unit ? `[${m.unit}]` : '', m.decompose ? '' : '(no decomposition)', m.note ? `Caveat: ${m.note}` : '']
        .filter(Boolean)
        .join(' ')
    )
    .join('\n');
  const dims = Object.entries(config.dimensions)
    .map(([name, d]) => {
      const values = d.values
        ? ` Values: ${Object.keys(d.values).map((v) => `${v}=${labelForValue(d, v)}`).join(', ')}.`
        : '';
      return `- \`${name}\`${d.label ? ` — ${d.label}` : ''}.${values}${d.note ? ` Caveat: ${d.note}` : ''}`;
    })
    .join('\n');
  return [
    `### Source \`${id}\` (semantic, SQL)`,
    `Table \`${config.table}\`, timezone ${config.timezone}${config.data_start ? `, data starts ${config.data_start}` : ''}.`,
    config.context ? `Context: ${config.context.trim()}` : '',
    `Metrics:\n${metrics}`,
    `Dimensions:\n${dims}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function modelSection(env: WorkbenchEnv): string {
  if (!env.model) return '';
  const { id, ctx } = env.model;
  const s = ctx.settings;
  return [
    `### Source \`${id}\` (model output, ${ctx.source.mode === 'live' ? 'live Langfuse' : 'demo dataset'})`,
    'One trace per LLM call. `route` = trace name, `release` = deployed release.',
    `Quality scores are NUMERIC LLM-judge scores where higher is better; a score below ${s.low_score_threshold} is "low". Score names come from the data (score_summary lists them).`,
    `End-user feedback is the score \`${s.feedback_score}\`; value ${s.negative_feedback_value} means thumbs-down.`,
    'BOOLEAN and categorical scores are excluded from quality statistics.',
  ].join('\n');
}

function boardsSection(env: WorkbenchEnv): string {
  return env.boards
    .boardsConfig()
    .map(
      (b) =>
        `- Board \`${b.id}\` "${b.title}" (source \`${b.source}\`): cards ${env.boards
          .cardsOnBoard(b.id)
          .map((c) => `\`${c.id}\``)
          .join(', ')}`
    )
    .join('\n');
}

/** L2 — generated from the configs, so it always matches what the tools accept. */
export function buildCatalog(env: WorkbenchEnv): string {
  const semantic = [...env.semantic.entries()].map(([id, ctx]) => semanticSection(id, ctx.config));
  return ['# Data catalog', ...semantic, modelSection(env), '### Dashboard', boardsSection(env)]
    .filter(Boolean)
    .join('\n\n');
}

export interface AssembledPrompt {
  text: string;
  version: string;
}

export function assembleSystemPrompt(files: PromptFiles, catalog: string): AssembledPrompt {
  const text = [
    files['01-principles.md'],
    catalog,
    files['03-tool-policy.md'],
    files['04-playbooks.md'],
    files['06-output.md'],
  ].join('\n\n---\n\n');
  return { text, version: createHash('sha256').update(text).digest('hex').slice(0, 12) };
}

export interface TurnContext {
  today: string;
  entry: Entry;
  playbook: Playbook;
  board?: { id: string; title: string };
  card?: { id: string; title: string };
  days: number;
}

/** Pick the playbook from the entry point; free text keeps the session's last playbook. */
export function choosePlaybook(
  entry: Entry,
  cardProvider: string | undefined,
  previous: Playbook | undefined
): Playbook {
  if (entry === 'board') return 'board_review';
  if (entry === 'card') return cardProvider && SAMPLE_PROVIDERS.has(cardProvider) ? 'sample_review' : 'explain_card';
  return previous ? 'followup' : 'explain_change';
}

/** L5 — per-turn context, kept out of the system message so the cached prefix survives. */
export function contextBlock(c: TurnContext): string {
  const lines = [
    `today: ${c.today}`,
    `entry: ${c.entry}`,
    `playbook: ${c.playbook}`,
    `window: last ${c.days} full UTC days vs the ${c.days} days before`,
  ];
  if (c.board) lines.push(`board: ${c.board.id} ("${c.board.title}")`);
  if (c.card) lines.push(`card: ${c.card.id} ("${c.card.title}")`);
  return `<context>\n${lines.join('\n')}\n</context>`;
}
