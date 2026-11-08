/** Card bodies for each display type. Values are formatted, never recomputed. */
import { Cell, Line, LineChart, Pie, PieChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApp } from '../app-state';
import { tl } from '../lib/i18n';
import { axisLabel, CHART_COLORS, deltaView, fmt } from '../lib/format';
import { type BarData, type LineData, type PieData, type ReleaseEntry, type StatData, type TableData, type ValueFormat } from '../lib/types';
import { cn, Empty } from './ui';

function ChartTooltip({ active, payload, label, format }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  format: ValueFormat;
}) {
  const { lang } = useApp();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-[12px] shadow-emboss-sm">
      {label && <div className="mb-1 text-muted-foreground">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
          <span className="text-muted-foreground">{tl(p.name, lang)}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{fmt(p.value ?? null, format)}</span>
        </div>
      ))}
    </div>
  );
}

export function StatBody({ d }: { d: StatData }) {
  const { tr, lang } = useApp();
  const delta = deltaView(d);
  const spark = d.spark ?? [];
  return (
    <div className="px-1">
      <div className="text-[40px] leading-none font-[740] tracking-[-0.03em] tabular-nums">{fmt(d.value, d.format)}</div>
      <div className="mt-2.5 flex items-center gap-2 text-[13px]">
        {delta ? (
          <span className={cn('font-semibold tabular-nums', delta.tone === 'good' && 'text-good', delta.tone === 'bad' && 'text-bad', delta.tone === 'flat' && 'text-muted-foreground')}>
            {delta.arrow} {delta.text}
          </span>
        ) : (
          <span className="text-muted-foreground">{tr('card.noBaseline')}</span>
        )}
        <span className="text-[11.5px] text-muted-foreground">{tr('card.prev', { v: fmt(d.previous, d.format) })}</span>
      </div>
      {d.caption && <div className="mt-1 text-[11.5px] text-muted-foreground">{tl(d.caption, lang)}</div>}
      {spark.length > 1 && (
        <div className="mt-3 h-9 rounded-md">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line type="monotone" dataKey="v" stroke="var(--chart-1)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Releases dated inside the chart's range, one marker per day. */
export function releaseMarkers(entries: ReleaseEntry[] | undefined, days: string[]): Array<{ x: string; label: string }> {
  if (!entries?.length || !days.length) return [];
  const inRange = new Set(days.map((t) => t.slice(0, 10)));
  const byDay = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.date || !inRange.has(e.date)) continue;
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e.version ?? e.title.slice(0, 12)]);
  }
  return [...byDay].map(([date, labels]) => ({ x: date.slice(5), label: labels.join(' · ') }));
}

export function LineBody({ d, releases }: { d: LineData; releases?: ReleaseEntry[] }) {
  const { lang } = useApp();
  const days = d.series[0]?.points.map((p) => p.t) ?? [];
  const markers = releaseMarkers(releases, days);
  if (days.length < 2) return <Empty>—</Empty>;
  const rows = days.map((t, i) => {
    const row: Record<string, string | number | null> = { t: t.slice(5) };
    d.series.forEach((s) => (row[s.name] = s.points[i]?.v ?? null));
    return row;
  });
  return (
    <div>
      {d.series.length > 1 && (
        <div className="mb-1 flex flex-wrap justify-end gap-3 px-2 text-[11.5px] text-muted-foreground">
          {d.series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
              {tl(s.name, lang)}
            </span>
          ))}
        </div>
      )}
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: markers.length ? 16 : 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="t" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} minTickGap={16} />
            <YAxis width={44} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickFormatter={(v: number) => axisLabel(v, d.format)} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip format={d.format} />} cursor={{ stroke: 'var(--border)' }} />
            {markers.map((m) => (
              <ReferenceLine
                key={m.x}
                x={m.x}
                stroke="var(--primary)"
                strokeDasharray="4 3"
                strokeOpacity={0.7}
                label={{ value: m.label, position: 'insideTopRight', fontSize: 10.5, fill: 'var(--primary)' }}
                ifOverflow="extendDomain"
              />
            ))}
            {d.series.map((s, i) => (
              <Line key={s.name} type="monotone" dataKey={s.name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function BarBody({ d }: { d: BarData }) {
  const { lang } = useApp();
  if (!d.items.length) return <Empty>—</Empty>;
  const max = Math.max(...d.items.map((i) => Math.abs(i.value ?? 0)), 0) || 1;
  return (
    <div className="flex flex-col gap-2 px-1">
      {d.share_label && <div className="text-right text-[11px] text-muted-foreground">% {tl(d.share_label, lang)}</div>}
      {d.items.map((it) => (
        <div key={it.label} className="group grid grid-cols-[minmax(90px,38%)_1fr_auto] items-center gap-3 text-[12.5px]">
          <span className="truncate" title={it.label}>{tl(it.label, lang)}</span>
          <span className="h-3.5 overflow-hidden rounded-[3px] bg-secondary/50">
            <span className="block h-full rounded-[3px] bg-chart-1 transition group-hover:bg-primary" style={{ width: `${it.value == null ? 0 : Math.max(1, (Math.abs(it.value) / max) * 100)}%` }} />
          </span>
          <span className="min-w-14 text-right tabular-nums">
            {fmt(it.value, d.format)}
            {it.share != null && <span className="ml-2 inline-block min-w-11 text-muted-foreground">{fmt(it.share, 'pct')}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PieBody({ d }: { d: PieData }) {
  const { tr, lang } = useApp();
  if (!d.slices.length) return <Empty>—</Empty>;
  return (
    <div className="flex flex-col items-stretch">
      <div className="relative mx-auto h-[150px] w-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={d.slices} dataKey="value" nameKey="label" innerRadius={52} outerRadius={68} stroke="none" isAnimationActive={false}>
              {d.slices.map((s, i) => (
                <Cell key={s.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip format={d.format} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[24px] leading-none font-[720] tabular-nums">{fmt(d.total, d.format)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{tr('card.total')}</div>
          </div>
        </div>
      </div>
      <ul className="mt-2 flex flex-col">
        {d.slices.map((s, i) => (
          <li key={s.label} className="grid grid-cols-[10px_1fr_auto_52px] items-center gap-2 rounded-md px-2 py-1 text-[12px] hover:bg-primary/5">
            <span className="size-2 rounded-[2px]" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="truncate">{tl(s.label, lang)}</span>
            <span className="tabular-nums">{fmt(s.value, d.format)}</span>
            <span className="text-right text-muted-foreground tabular-nums">{fmt(s.share, 'pct')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TableBody({ d }: { d: TableData }) {
  const { tr, lang } = useApp();
  if (!d.rows.length) return <Empty>{tr('card.noRows')}</Empty>;
  const numeric = (f: ValueFormat) => f !== 'text' && f !== 'datetime';
  return (
    <div className="max-h-[340px] overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {d.columns.map((c) => (
              <th key={c.key} className={cn('sticky top-0 border-b border-border bg-card px-2 py-1.5 text-[11.5px] font-medium whitespace-nowrap text-muted-foreground', numeric(c.format) ? 'text-right' : 'text-left')}>
                {tl(c.label, lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={i} className="hover:bg-primary/[0.045]">
              {d.columns.map((c) => {
                const v = r[c.key];
                return (
                  <td key={c.key} className={cn('border-b border-border/70 px-2 py-1.5', numeric(c.format) ? 'text-right tabular-nums whitespace-nowrap' : c.key === 'comment' ? 'min-w-48 text-muted-foreground' : 'whitespace-nowrap')}>
                    {c.bar && typeof v === 'number' && (
                      <span className="mr-2 inline-block h-1.5 w-14 overflow-hidden rounded-full bg-secondary/60 align-middle shadow-well">
                        <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, Math.min(100, v * 100))}%` }} />
                      </span>
                    )}
                    {c.format === 'text' ? tl(v == null ? '' : String(v), lang) || '—' : fmt(v, c.format)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
