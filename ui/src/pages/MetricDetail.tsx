/** One metric: trend with outliers, period comparison, and the decomposition by a dimension. */
import { GitBranch, LineChart as LineIcon, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CartesianGrid, Dot, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../app-state';
import { useAgent } from '../agent/agent-state';
import { Button, CardShell, cn, Empty, IconChip, Segmented, Select } from '../components/ui';
import { axisLabel, deltaView, fmt } from '../lib/format';
import { loc, tl } from '../lib/i18n';
import { lastDays, metricFormat, shiftDays, tool, type CompareResult, type MetricDef, type TrendResult } from './metric-utils';

interface Driver {
  segment: string;
  label?: string;
  period_a?: number;
  period_b?: number;
  delta?: number;
  contribution_share?: number | null;
  abs_contribution_share?: number;
  rate_a?: number;
  rate_b?: number;
  weight_a?: number;
  weight_b?: number;
  behavior_contribution?: number;
  mix_contribution?: number;
  interaction_contribution?: number;
  total_contribution?: number;
}
interface Decomp {
  growth_drivers?: Driver[];
  drag_drivers?: Driver[];
  stability?: string;
  drivers?: Driver[];
  mix_effect?: number;
  behavior_effect?: number;
  interaction?: number;
  interaction_warning?: boolean;
}

function signed(v: number | undefined | null): string {
  if (v == null) return '—';
  const s = Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
  return (v > 0 ? '+' : '') + s;
}

function SectionHead({ icon, title, right }: { icon: typeof LineIcon; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-6 pt-5 pb-3">
      <IconChip icon={icon} />
      <span className="text-[14px] font-semibold">{title}</span>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  );
}

export function MetricDetail({ metric }: { metric: MetricDef }) {
  const { health, lang, tr, go } = useApp();
  const agent = useAgent();
  const [days, setDays] = useState(7);
  const [dim, setDim] = useState(health?.dimensions[0]?.name ?? '');
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [decomp, setDecomp] = useState<Decomp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const format = metricFormat(metric);

  useEffect(() => {
    const current = lastDays(days);
    setCmp(null);
    setTrend(null);
    setError(null);
    tool<CompareResult>('compare_periods', { metric: metric.name, period_b: current, compare_to: 'prev_period' }).then(setCmp, (e: Error) => setError(e.message));
    tool<TrendResult>('get_metric_trend', { metric: metric.name, period: lastDays(days * 2), granularity: days >= 30 ? 'week' : 'day' }).then(setTrend, (e: Error) => setError(e.message));
  }, [metric, days]);

  useEffect(() => {
    if (!metric.decompose || !dim) return;
    const current = lastDays(days);
    setDecomp(null);
    tool<Decomp>(metric.kind === 'additive' ? 'decompose_change_additive' : 'decompose_change_rate', {
      metric: metric.name,
      period_a: { from: shiftDays(current.from, -days), to: current.from },
      period_b: current,
      dimension: dim,
      top_n: 12,
    }).then(setDecomp, (e: Error) => setError(e.message));
  }, [metric, days, dim]);

  const delta = cmp ? deltaView({ delta: cmp.delta, delta_pct: cmp.delta_pct == null ? null : cmp.delta_pct / 100, format, good_direction: 'none' }) : null;
  const dimLabel = loc(health?.dimensions.find((d) => d.name === dim)?.label ?? dim, lang);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go({ page: 'metrics' })} className="text-[12.5px] text-muted-foreground hover:text-foreground cursor-pointer">← {tr('metrics.back')}</button>
        <div className="ml-auto flex items-center gap-2">
          <Segmented value={days} onChange={setDays} options={[7, 14, 30].map((n) => ({ value: n, label: `${n}d` }))} />
          <Select value={dim} onChange={setDim} className="w-44" options={(health?.dimensions ?? []).map((d) => ({ value: d.name, label: loc(d.label, lang) }))} />
          {agent.status && (
            <Button variant="dark" disabled={agent.running || !agent.status.llm_configured} onClick={() => agent.send(
              lang === 'zh'
                ? `${loc(metric.label, lang)}（${metric.name}）近 ${days} 天和前 ${days} 天相比为什么变了？主要是哪个${dimLabel}带来的？`
                : `Why did ${metric.name} change in the last ${days} days vs the previous ${days}? Which ${dim} drove it?`
            )}>
              <Sparkles size={14} /> {tr('card.ask')}
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-[12.5px] text-bad">{error}</p>}

      <div className="grid grid-cols-12 gap-4">
        <CardShell className="col-span-12 xl:col-span-4">
          <div className="grid h-full grid-cols-1 gap-px overflow-hidden rounded-2xl bg-border">
            {[
              [tr('metrics.current'), cmp?.period_b_total, cmp ? `${cmp.period_b.from} → ${cmp.period_b.to}` : ''],
              [tr('metrics.baseline'), cmp?.period_a_total, cmp ? `${cmp.period_a.from} → ${cmp.period_a.to}` : ''],
            ].map(([label, v, range]) => (
              <div key={String(label)} className="bg-card px-7 py-5">
                <div className="text-[12px] text-muted-foreground">{label} <span className="ml-1 text-[11px]">{range}</span></div>
                <div className="mt-1 text-[32px] font-[740] tracking-[-0.03em] tabular-nums">{fmt(v as number | null | undefined, format)}</div>
              </div>
            ))}
            <div className="bg-card px-7 py-5 text-[15px] font-semibold">
              {delta && <span className={cn(delta.tone === 'flat' && 'text-muted-foreground')}>{delta.arrow} {delta.text}</span>}
            </div>
          </div>
        </CardShell>
        <CardShell className="col-span-12 xl:col-span-8">
          <SectionHead icon={LineIcon} title={tr('metrics.trend')} />
          <div className="h-[240px] px-3 pb-4">
            {trend && trend.points.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.points.map((p) => ({ ...p, t: p.bucket.slice(5, 10) }))} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="t" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} minTickGap={16} />
                  <YAxis width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickFormatter={(v: number) => axisLabel(v, format)} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v) => fmt(Number(v), format)} contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--popover)', fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    isAnimationActive={false}
                    dot={(p: { cx?: number; cy?: number; payload?: { outlier?: string }; index?: number }) =>
                      p.payload?.outlier ? (
                        <Dot key={p.index} cx={p.cx} cy={p.cy} r={4} fill={p.payload.outlier === 'high' ? 'var(--warn)' : 'var(--bad)'} stroke="none" />
                      ) : (
                        <g key={p.index} />
                      )
                    }
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty>…</Empty>
            )}
          </div>
        </CardShell>
      </div>

      <CardShell>
        <SectionHead icon={GitBranch} title={`${tr('metrics.decomp')} · ${tr('metrics.by')} ${dimLabel}`} />
        <div className="px-4 pb-5">
          {!metric.decompose ? <Empty>—</Empty> : !decomp ? <div className="h-24 animate-pulse rounded-lg bg-muted" /> : metric.kind === 'additive' ? <AdditiveTable d={decomp} format={format} /> : <RateTable d={decomp} format={format} />}
        </div>
      </CardShell>
    </div>
  );
}

function ContribBar({ share, positive }: { share: number; positive: boolean }) {
  return (
    <span className="inline-block h-2 w-24 overflow-hidden rounded-full bg-secondary/60 align-middle shadow-well">
      <span className={cn('block h-full rounded-full', positive ? 'bg-good' : 'bg-bad')} style={{ width: `${Math.max(3, Math.min(100, Math.abs(share) * 100))}%` }} />
    </span>
  );
}

function AdditiveTable({ d, format }: { d: Decomp; format: ReturnType<typeof metricFormat> }) {
  const { tr, lang } = useApp();
  const rows = [...(d.growth_drivers ?? []), ...(d.drag_drivers ?? [])].sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  if (!rows.length) return <Empty>—</Empty>;
  const unstable = d.stability === 'unstable';
  return (
    <>
      {unstable && <p className="mb-2 px-2 text-[12px] text-warn">⚠ {tr('metrics.unstable')}</p>}
      <table className="w-full text-[12.5px]">
        <thead className="text-[11.5px] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-2 py-1.5 text-left font-medium">{tr('metrics.segment')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr('metrics.baseline')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr('metrics.current')}</th>
            <th className="px-2 py-1.5 text-right font-medium">Δ</th>
            <th className="px-2 py-1.5 text-left font-medium">{tr('metrics.contribution')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.segment} className="border-b border-border/70 hover:bg-primary/[0.045]">
              <td className="px-2 py-1.5">{tl(x.label ?? x.segment, lang)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(x.period_a, format)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(x.period_b, format)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{(x.delta ?? 0) > 0 ? '+' : ''}{fmt(x.delta, format)}</td>
              <td className="px-2 py-1.5">
                <ContribBar share={x.abs_contribution_share ?? 0} positive={(x.delta ?? 0) > 0} />
                <span className="ml-2 text-[11.5px] text-muted-foreground">
                  {unstable ? fmt(x.abs_contribution_share, 'pct') : x.contribution_share == null ? '—' : fmt(x.contribution_share, 'pct')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RateTable({ d, format }: { d: Decomp; format: ReturnType<typeof metricFormat> }) {
  const { tr, lang } = useApp();
  const rows = d.drivers ?? [];
  if (!rows.length) return <Empty>—</Empty>;
  const maxAbs = Math.max(...rows.map((x) => Math.abs(x.total_contribution ?? 0))) || 1;
  return (
    <>
      <div className="mb-3 grid grid-cols-3 gap-3 px-2">
        {[[tr('metrics.mix'), d.mix_effect], [tr('metrics.behavior'), d.behavior_effect], [tr('metrics.interaction'), d.interaction]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl bg-secondary/50 px-4 py-2.5 shadow-well">
            <div className="text-[11.5px] text-muted-foreground">{l}</div>
            <div className="text-[18px] font-semibold tabular-nums">{signed(v as number | undefined)}</div>
          </div>
        ))}
      </div>
      {d.interaction_warning && <p className="mb-2 px-2 text-[12px] text-warn">⚠ {tr('metrics.interactionWarn')}</p>}
      <table className="w-full text-[12.5px]">
        <thead className="text-[11.5px] text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-2 py-1.5 text-left font-medium">{tr('metrics.segment')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr('metrics.rate')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr('metrics.weight')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr('metrics.behavior')}</th>
            <th className="px-2 py-1.5 text-right font-medium">{tr('metrics.mix')}</th>
            <th className="px-2 py-1.5 text-left font-medium">{tr('metrics.contribution')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.segment} className="border-b border-border/70 hover:bg-primary/[0.045]">
              <td className="px-2 py-1.5">{tl(x.label ?? x.segment, lang)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(x.rate_a, format)} → {fmt(x.rate_b, format)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmt(x.weight_a, 'pct')} → {fmt(x.weight_b, 'pct')}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{signed(x.behavior_contribution)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{signed(x.mix_contribution)}</td>
              <td className="px-2 py-1.5"><ContribBar share={(x.total_contribution ?? 0) / maxAbs} positive={(x.total_contribution ?? 0) > 0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
