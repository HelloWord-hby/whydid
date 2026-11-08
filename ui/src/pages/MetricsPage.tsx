/** Every metric of the main config as a KPI strip; click one to drill down. */
import { ArrowUpRight, Gauge, Hash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../app-state';
import { StatBody } from '../components/charts';
import { IconChip } from '../components/ui';
import { loc } from '../lib/i18n';
import { type StatData } from '../lib/types';
import { lastDays, metricFormat, tool, type CompareResult, type MetricDef, type TrendResult } from './metric-utils';

function MetricCell({ m }: { m: MetricDef }) {
  const { lang, tr, go } = useApp();
  const [data, setData] = useState<StatData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      tool<CompareResult>('compare_periods', { metric: m.name, period_b: lastDays(7), compare_to: 'prev_period' }),
      tool<TrendResult>('get_metric_trend', { metric: m.name, period: lastDays(14), granularity: 'day' }),
    ])
      .then(([cmp, trend]) =>
        setData({
          display: 'stat',
          value: cmp.period_b_total,
          previous: cmp.period_a_total,
          delta: cmp.delta,
          delta_pct: cmp.delta_pct == null ? null : cmp.delta_pct / 100,
          format: metricFormat(m),
          good_direction: 'none',
          spark: trend.points.map((p) => ({ t: p.bucket, v: p.value })),
        })
      )
      .catch((e: Error) => setError(e.message));
  }, [m]);
  return (
    <button
      type="button"
      onClick={() => go({ page: 'metric', name: m.name })}
      className="group bg-card px-7 pt-6 pb-5 text-left transition hover:bg-primary/[0.03] cursor-pointer"
    >
      <div className="mb-3 flex items-center gap-2">
        <IconChip icon={m.kind === 'additive' ? Hash : Gauge} size={24} />
        <span className="text-[12px] text-muted-foreground">{loc(m.label, lang)}</span>
        <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-primary opacity-0 transition group-hover:opacity-100">
          {tr('metrics.decomp')} <ArrowUpRight size={12} />
        </span>
      </div>
      {error ? <p className="text-[12px] text-bad">{error}</p> : data ? <StatBody d={data} /> : <div className="h-20 animate-pulse rounded-lg bg-muted" />}
    </button>
  );
}

export function MetricsPage() {
  const { health } = useApp();
  if (!health) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 shadow-emboss">
      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2 xl:grid-cols-4">
        {health.metrics.map((m) => (
          <MetricCell key={m.name} m={m} />
        ))}
        {/* Fill the last row so no divider background shows through. */}
        {Array.from({ length: (4 - (health.metrics.length % 4)) % 4 }, (_, i) => (
          <div key={`xl${i}`} className="hidden bg-card xl:block" />
        ))}
        {health.metrics.length % 2 === 1 && <div className="hidden bg-card md:block xl:hidden" />}
      </div>
    </div>
  );
}
