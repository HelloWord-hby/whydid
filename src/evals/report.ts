/** Render an eval run as Markdown — the file you keep and compare across prompt versions. */
import { type CaseScore, type EvalCase, type EvalSummary } from './score.js';

export interface RunMeta {
  date: string;
  model: string;
  promptVersion: string;
  dataModes: string;
  mock: boolean;
  /** ISO timestamp; older result files only have `date`. */
  startedAt?: string;
}

const pct = (hit: number, of: number) => (of === 0 ? '—' : `${hit}/${of} (${Math.round((hit / of) * 100)}%)`);

export function renderReport(meta: RunMeta, cases: EvalCase[], scores: CaseScore[], s: EvalSummary): string {
  const grounded = s.numbersChecked - s.numbersUngrounded;
  const lines = [
    `# whydid regression run — ${meta.date}`,
    '',
    meta.mock
      ? '> **Pipeline check with the scripted mock LLM.** These numbers test the harness, not answer quality.'
      : `> Model \`${meta.model}\`.`,
    '',
    `Prompt version \`${meta.promptVersion}\` · data: ${meta.dataModes}`,
    '',
    '| Measure | Result |',
    '|---|---|',
    `| Cases passed | ${pct(s.passed, s.cases)} |`,
    `| Driver found | ${pct(s.driverFound.hit, s.driverFound.of)} |`,
    `| Direction stated wrong or missing | ${s.directionErrors} of ${s.directionChecked} |`,
    `| Honest exit when the data cannot answer | ${pct(s.honestExit.hit, s.honestExit.of)} |`,
    `| Numbers traceable to a tool result | ${pct(grounded, s.numbersChecked)} |`,
    `| Avg tool calls / tokens / seconds | ${s.avgToolCalls.toFixed(1)} / ${Math.round(s.avgTokens).toLocaleString('en-US')} / ${s.avgSeconds.toFixed(1)} |`,
    '',
    '| Case | Pass | Failed checks | Bonus | Calls | Tokens | s |',
    '|---|---|---|---|---|---|---|',
    ...scores.map((x) =>
      [
        '',
        `\`${x.id}\``,
        x.pass ? '✅' : '❌',
        x.failures.length ? x.failures.join('; ').replace(/\|/g, '/') : '',
        x.bonus.total ? `${x.bonus.found}/${x.bonus.total}` : '',
        String(x.outcome.toolCalls),
        x.outcome.tokens.toLocaleString('en-US'),
        (x.outcome.ms / 1000).toFixed(1),
        '',
      ].join(' | ').trim()
    ),
    '',
    '## Answers',
    '',
  ];
  for (const x of scores) {
    const c = cases.find((k) => k.id === x.id);
    lines.push(`### \`${x.id}\` ${x.pass ? '✅' : '❌'}`, '');
    if (c?.note) lines.push(`*Known answer:* ${c.note}`, '');
    lines.push(`*Question:* ${c?.question ?? ''}`, '');
    lines.push(x.outcome.error ? `Error: ${x.outcome.error}` : x.outcome.answer.split('\n').map((l) => `> ${l}`).join('\n'), '');
  }
  return lines.join('\n');
}
