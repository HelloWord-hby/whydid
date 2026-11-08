/**
 * list_releases — the team's release log as an agent tool.
 *
 * A release on the day a metric moved is a candidate cause, not proof; the
 * tool says so in its hints. Release text is written by people, so it is
 * masked, truncated and returned under "untrusted" like any other free text.
 */
import { z } from 'zod';
import { buildWindow } from '../boards/window.js';
import { type ReleaseEntry } from '../releases/parse.js';
import { sanitizeText, UNTRUSTED_NOTICE } from './sanitize.js';
import { defineAgentTool, type WorkbenchEnv } from './types.js';

const MAX_ENTRIES = 20;
const MAX_BODY_CHARS = 1200;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Window covering the current period and its baseline, so a release just before the change is included. */
function rangeFor(args: { days?: number; from?: string; to?: string }, now: Date): { from: string; to: string } | null {
  if (args.from || args.to) return { from: args.from ?? '0000-01-01', to: args.to ?? '9999-12-31' };
  if (!args.days) return null;
  const w = buildWindow(args.days, now);
  // Windows end exclusively; the range shown to the agent is inclusive.
  const last = new Date(Date.parse(`${w.current.to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { from: w.previous.from, to: last };
}

function view(e: ReleaseEntry) {
  return {
    version: e.version,
    date: e.date,
    untrusted: { title: sanitizeText(e.title, 200), changes: sanitizeText(e.body, MAX_BODY_CHARS) },
  };
}

function hints(entries: ReleaseEntry[], env: WorkbenchEnv): string[] {
  const out: string[] = [];
  const latest = entries.find((e) => e.date);
  if (latest && env.model) {
    out.push(
      `${latest.version ?? 'A release'} shipped on ${latest.date}. If a quality metric moved around that day, check it with low_score_breakdown group_by=release before naming the release as the cause.`
    );
  }
  if (entries.length && !latest) out.push('None of these entries has a date, so they cannot be matched to a change in time.');
  return out;
}

export const listReleasesTool = defineAgentTool({
  name: 'list_releases',
  description:
    "Read the product's release log (changelog kept by the team): version, date and what changed. Use it when a metric moved on a particular day, to see whether a release shipped then. Pass days (same window as the other tools) or from/to; omit both for the whole log.",
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', enum: [7, 14, 30], description: 'Covers the last N days and the N days before them.' },
      from: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
      to: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
    },
  },
  args: z
    .object({
      days: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .strict(),
  run: async (args, env) => {
    if (!env.releases) throw new Error('No release log is configured on this server.');
    const log = env.releases.read();
    if (!log.entries.length) {
      return { origin: log.origin, releases: [], note: 'The release log is empty. The team has not added release notes yet.' };
    }
    const range = rangeFor(args, env.now());
    const dated = log.entries.filter((e) => e.date && (!range || (e.date >= range.from && e.date <= range.to)));
    const undated = log.entries.filter((e) => !e.date);
    const picked = range ? dated : [...dated, ...undated];
    return {
      origin: log.origin,
      range,
      total_entries: log.entries.length,
      undated_entries: undated.length,
      releases: picked.slice(0, MAX_ENTRIES).map(view),
      ...(picked.length > MAX_ENTRIES ? { truncated: picked.length - MAX_ENTRIES } : {}),
      note: UNTRUSTED_NOTICE,
      next_hints: hints(picked, env),
    };
  },
});

/** One line for the per-turn context block, or undefined when there is no log. */
export function releaseContextLine(env: WorkbenchEnv): string | undefined {
  if (!env.releases) return undefined;
  const log = env.releases.read();
  const dated = log.entries.filter((e) => e.date);
  if (!log.entries.length) return 'release_log: empty';
  const latest = dated[0];
  return `release_log: ${dated.length} dated entries${latest ? `, latest ${latest.version ?? 'an unversioned entry'} on ${latest.date}` : ''} (read with list_releases)`;
}
