/** Eval set: run the regression cases, compare runs, and read each case's answer and failed checks. */
import { CheckCircle2, ChevronRight, CircleDashed, FlaskConical, Play, XCircle } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../app-state';
import { markdownToHtml } from '../agent/markdown';
import { getJson, postJson } from '../lib/api';
import { type EvalCase, type EvalCaseScore, type EvalOverview, type EvalRun, type EvalRunSummary } from '../lib/types';
import { Button, CardShell, cn, Empty } from '../components/ui';

const POLL_MS = 1500;

function pct(hit: number, of: number): string {
  return of === 0 ? '—' : `${Math.round((hit / of) * 100)}%`;
}

function when(r: EvalRunSummary, lang: string): string {
  const iso = r.meta.startedAt;
  if (!iso) return r.meta.date;
  return new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="bg-card px-5 pt-4 pb-3.5">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className={cn('mt-1.5 text-[26px] leading-none font-[720] tabular-nums', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function Summary({ run }: { run: EvalRunSummary }) {
  const { tr } = useApp();
  const s = run.summary;
  const grounded = s.numbersChecked - s.numbersUngrounded;
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 shadow-emboss">
      <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={tr('eval.passed')} value={pct(s.passed, s.cases)} sub={tr('eval.of', { a: s.passed, b: s.cases })} tone={s.passed === s.cases ? 'good' : undefined} />
        <Kpi label={tr('eval.driver')} value={pct(s.driverFound.hit, s.driverFound.of)} sub={`${s.driverFound.hit}/${s.driverFound.of}`} />
        <Kpi label={tr('eval.direction')} value={String(s.directionErrors)} sub={`/ ${s.directionChecked}`} tone={s.directionErrors > 0 ? 'bad' : 'good'} />
        <Kpi label={tr('eval.exit')} value={pct(s.honestExit.hit, s.honestExit.of)} sub={`${s.honestExit.hit}/${s.honestExit.of}`} />
        <Kpi label={tr('eval.grounded')} value={pct(grounded, s.numbersChecked)} sub={`${grounded}/${s.numbersChecked}`} />
        <Kpi label={tr('eval.cost')} value={s.avgToolCalls.toFixed(1)} sub={`${Math.round(s.avgTokens).toLocaleString('en-US')} · ${s.avgSeconds.toFixed(1)}s`} />
      </div>
    </div>
  );
}

function CaseRow({ c, score, open, onToggle }: { c: EvalCase; score?: EvalCaseScore; open: boolean; onToggle: () => void }) {
  const { tr } = useApp();
  const html = useMemo(() => (score ? markdownToHtml(score.outcome.error ? `Error: ${score.outcome.error}` : score.outcome.answer) : ''), [score]);
  return (
    <Fragment>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-primary/[0.045]">
        <td className="border-b border-border/70 px-3 py-2 align-top">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight size={13} className={cn('text-muted-foreground transition', open && 'rotate-90')} />
            {score ? (
              score.pass ? <CheckCircle2 size={15} className="text-good" /> : <XCircle size={15} className="text-bad" />
            ) : (
              <CircleDashed size={15} className="text-muted-foreground" />
            )}
          </span>
        </td>
        <td className="border-b border-border/70 px-2 py-2 align-top font-mono text-[12px] whitespace-nowrap">{c.id}</td>
        <td className="border-b border-border/70 px-2 py-2 align-top">{c.question}</td>
        <td className="border-b border-border/70 px-2 py-2 align-top text-[12px] text-bad">{score ? score.failures.map((f) => f.split(':')[0]).join(', ') : <span className="text-muted-foreground">{tr('eval.notRun')}</span>}</td>
        <td className="border-b border-border/70 px-3 py-2 text-right align-top text-[12px] whitespace-nowrap text-muted-foreground tabular-nums">
          {score ? `${score.outcome.toolCalls} · ${(score.outcome.ms / 1000).toFixed(1)}s` : ''}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="border-b border-border/70 bg-muted/40 px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div className="flex flex-col gap-3 text-[12.5px]">
                {c.note && (
                  <div>
                    <div className="mb-0.5 text-[11.5px] font-medium text-muted-foreground">{tr('eval.known')}</div>
                    {c.note}
                  </div>
                )}
                {c.find.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">{tr('eval.expect')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.find.map((g) => (
                        <code key={g.join('|')} className="rounded-md bg-popover px-1.5 py-0.5 text-[11.5px] shadow-emboss-sm">{g.join(' | ')}</code>
                      ))}
                    </div>
                  </div>
                )}
                {score && score.failures.length > 0 && (
                  <div>
                    <div className="mb-0.5 text-[11.5px] font-medium text-muted-foreground">{tr('eval.failed')}</div>
                    <ul className="flex flex-col gap-1 text-bad">
                      {score.failures.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {score && (
                <div>
                  <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">{tr('eval.answer')}</div>
                  <div className="prose-agent max-h-[360px] overflow-auto rounded-xl border border-border bg-popover px-3 py-2 text-[12.5px]" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function History({ runs, selected, onSelect }: { runs: EvalRunSummary[]; selected: string | null; onSelect: (n: string) => void }) {
  const { tr, lang } = useApp();
  return (
    <CardShell className="overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 text-[13px] font-semibold">{tr('eval.history')}</div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-[11.5px] text-muted-foreground">
              <th className="px-4 py-1.5 text-left font-medium">{tr('eval.when')}</th>
              <th className="px-2 py-1.5 text-left font-medium">{tr('eval.model')}</th>
              <th className="px-4 py-1.5 text-right font-medium">{tr('eval.passed')}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.name} onClick={() => onSelect(r.name)} className={cn('cursor-pointer border-t border-border/70', r.name === selected ? 'bg-primary/[0.07]' : 'hover:bg-primary/[0.04]')}>
                <td className="px-4 py-2 whitespace-nowrap">{when(r, lang)}</td>
                <td className="max-w-[140px] truncate px-2 py-2" title={`${r.meta.model} · ${tr('eval.prompt')} ${r.meta.promptVersion}`}>
                  {r.meta.model}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.summary.passed}/{r.summary.cases}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardShell>
  );
}

export function EvalsPage() {
  const { tr } = useApp();
  const [overview, setOverview] = useState<EvalOverview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [run, setRun] = useState<EvalRun | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getJson<EvalOverview>('/evals')
      .then((o) => {
        setOverview(o);
        setSelected((cur) => (cur && o.runs.some((r) => r.name === cur) ? cur : (o.runs[0]?.name ?? null)));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const running = overview?.status.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      getJson<EvalOverview>('/evals')
        .then((o) => {
          setOverview(o);
          if (!o.status.running && o.status.last_run) setSelected(o.status.last_run);
        })
        .catch((e: Error) => setError(e.message));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!selected) {
      setRun(null);
      return;
    }
    getJson<EvalRun>(`/evals/runs/${encodeURIComponent(selected)}`)
      .then(setRun)
      .catch((e: Error) => setError(e.message));
  }, [selected]);

  const start = () => {
    if (!overview) return;
    const mock = /mock/i.test(overview.model);
    if (!mock && !window.confirm(tr('eval.confirm', { n: overview.cases.length, model: overview.model }))) return;
    setError(null);
    postJson('/evals/runs', {})
      .then(load)
      .catch((e: Error) => setError(e.message));
  };

  if (error && !overview) return <Empty>{tr('common.error', { msg: error })}</Empty>;
  if (!overview) return <div className="h-40 animate-pulse rounded-2xl bg-muted" />;

  const scores = new Map(run?.scores.map((s) => [s.id, s]));
  const st = overview.status;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12.5px] text-muted-foreground">
          {overview.cases.length} {tr('eval.cases')} · {overview.model} · {tr('eval.prompt')} <code className="text-[12px]">{overview.prompt_version}</code>
        </span>
        <div className="ml-auto flex items-center gap-3">
          {st.running && <span className="text-[12.5px] text-primary tabular-nums">{tr('eval.running', { done: st.done, total: st.total, id: st.current ?? '' })}</span>}
          <Button variant="primary" onClick={start} disabled={running || !overview.llm_configured} title={overview.llm_configured ? undefined : tr('eval.noLlm')}>
            <Play size={14} /> {tr('eval.run')}
          </Button>
        </div>
      </div>
      {!overview.llm_configured && <p className="text-[12px] text-warn">{tr('eval.noLlm')}</p>}
      {st.error && <p className="text-[12px] text-bad">{tr('eval.error', { msg: st.error })}</p>}
      {error && <p className="text-[12px] text-bad">{tr('common.error', { msg: error })}</p>}
      {st.running && (
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary/60 shadow-well">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(st.done / Math.max(1, st.total)) * 100}%` }} />
        </div>
      )}

      {overview.runs.length === 0 ? (
        <CardShell className="p-6">
          <Empty>
            <div className="flex flex-col items-center gap-2 text-center">
              <FlaskConical size={18} className="text-primary" />
              {tr('eval.noRuns')}
            </div>
          </Empty>
        </CardShell>
      ) : (
        run && (
          <>
            {run.meta.mock && <p className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">{tr('eval.mock')}</p>}
            <Summary run={run} />
          </>
        )
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <CardShell className="overflow-hidden">
          <div className="px-4 pt-3.5 pb-2 text-[13px] font-semibold">{tr('eval.cases')}</div>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] text-muted-foreground">
                <th className="w-12 px-3 py-1.5 text-left font-medium">{tr('eval.result')}</th>
                <th className="px-2 py-1.5 text-left font-medium">{tr('eval.case')}</th>
                <th className="px-2 py-1.5 text-left font-medium">{tr('eval.question')}</th>
                <th className="px-2 py-1.5 text-left font-medium">{tr('eval.failed')}</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {overview.cases.map((c) => (
                <CaseRow key={c.id} c={c} score={scores.get(c.id)} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
              ))}
            </tbody>
          </table>
        </CardShell>
        {overview.runs.length > 0 && <History runs={overview.runs} selected={selected} onSelect={setSelected} />}
      </div>
    </div>
  );
}
