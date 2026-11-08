/** One board card: header (icon chip, title, Ask Agent, hover actions) and its body. */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Activity, AlertTriangle, BarChart3, Coins, Filter, Gauge, GripVertical, LineChart, ListChecks, MessageSquareWarning,
  MoveHorizontal, PieChart, ThumbsDown, Timer, TrendingUp, Users, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../app-state';
import { AskPopover } from '../agent/AskPopover';
import { getJson } from '../lib/api';
import { loc, tl } from '../lib/i18n';
import { type CardResponse, type CatalogCard } from '../lib/types';
import { BarBody, LineBody, PieBody, StatBody, TableBody } from './charts';
import { cn, IconChip } from './ui';

const PROVIDER_ICONS: Record<string, LucideIcon> = {
  trace_count: Activity, trace_average: Timer, score_average: Gauge, score_trend: LineChart, score_overview: ListChecks,
  low_score_rate: AlertTriangle, low_score_samples: AlertTriangle, negative_feedback: ThumbsDown,
  feedback_samples: MessageSquareWarning, metric_stat: Users, metric_trend: TrendingUp, metric_breakdown: BarChart3, funnel: Filter,
};

export function iconFor(card: CatalogCard): LucideIcon {
  if (card.display === 'pie') return PieChart;
  if (card.provider === 'trace_average' && /cost/i.test(JSON.stringify(card.title))) return Coins;
  return PROVIDER_ICONS[card.provider] ?? BarChart3;
}

const cache = new Map<string, CardResponse>();

/** Drop cached card data, e.g. after the configuration changed. */
export function clearCardCache(): void {
  cache.clear();
}

function useCardData(id: string, days: number): { data: CardResponse | null; error: string | null } {
  const key = `${id}|${days}`;
  const [state, setState] = useState<{ key: string; data: CardResponse | null; error: string | null }>(() => ({
    key,
    data: cache.get(key) ?? null,
    error: null,
  }));
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) {
      setState({ key, data: hit, error: null });
      return;
    }
    let alive = true;
    setState({ key, data: null, error: null });
    getJson<CardResponse>(`/cards/${encodeURIComponent(id)}?days=${days}`)
      .then((r) => {
        cache.set(key, r);
        if (alive) setState({ key, data: r, error: null });
      })
      .catch((e: Error) => alive && setState({ key, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [key, id, days]);
  return state.key === key ? state : { data: null, error: null };
}

const SPAN: Record<number, string> = { 1: 'col-span-12 md:col-span-6 xl:col-span-3', 2: 'col-span-12 xl:col-span-6', 3: 'col-span-12 xl:col-span-9', 4: 'col-span-12' };

export function BoardCard({ card, size, onResize, onRemove }: {
  card: CatalogCard;
  size: number;
  onResize: () => void;
  onRemove: () => void;
}) {
  const { lang, days, tr, catalog, releases } = useApp();
  const modelBoard = catalog?.boards.find((b) => b.id === card.board)?.source_kind === 'model_output';
  const { data, error } = useCardData(card.id, days);
  const sortable = useSortable({ id: card.id });
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition };
  const body = data?.data;
  return (
    <section
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-border/60 bg-card shadow-emboss',
        SPAN[size] ?? SPAN[1],
        sortable.isDragging && 'z-10 opacity-60'
      )}
    >
      <header className="flex items-start gap-2.5 px-5 pt-4 pb-2">
        <IconChip icon={iconFor(card)} size={card.display === 'stat' ? 24 : 26} />
        <div className="min-w-0 flex-1">
          <h3 className={cn('truncate leading-[26px] font-semibold', card.display === 'stat' ? 'text-[12.5px] text-muted-foreground font-medium' : 'text-[14px]')}>
            {loc(card.title, lang)}
          </h3>
          {card.description && card.display !== 'stat' && (
            <p className="-mt-0.5 truncate text-[12px] text-muted-foreground">{loc(card.description, lang)}</p>
          )}
        </div>
        {/* Overlay, so hidden actions never take width from the title. */}
        <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-0.5 rounded-full pl-1 group-hover:pointer-events-auto group-hover:bg-card/95 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:bg-card/95">
          <AskPopover card={card} />
          <div className="flex items-center opacity-0 transition group-hover:opacity-100">
            <button type="button" title={tr('card.width')} onClick={onResize} className="rounded-md p-1 text-muted-foreground hover:bg-muted cursor-pointer">
              <MoveHorizontal size={14} />
            </button>
            <button type="button" title={tr('card.remove')} onClick={onRemove} className="rounded-md p-1 text-muted-foreground hover:bg-muted cursor-pointer">
              <X size={14} />
            </button>
            <button type="button" title={tr('card.drag')} className="cursor-grab rounded-md p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing" {...sortable.attributes} {...sortable.listeners}>
              <GripVertical size={14} />
            </button>
          </div>
        </div>
      </header>
      <div className="flex-1 px-4 pt-1 pb-4">
        {error && <p className="px-1 text-[12.5px] text-bad">{error}</p>}
        {!error && !body && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
        {body?.display === 'stat' && <StatBody d={body} />}
        {body?.display === 'line' && <LineBody d={body} releases={modelBoard ? releases?.entries : undefined} />}
        {body?.display === 'bar' && <BarBody d={body} />}
        {body?.display === 'pie' && <PieBody d={body} />}
        {body?.display === 'table' && <TableBody d={body} />}
        {body && body.display !== 'stat' && body.caption && <p className="mt-2 px-1 text-[11.5px] text-muted-foreground">{tl(body.caption, lang)}</p>}
        {data?.notes?.map((n) => (
          <p key={n} className="mt-2 px-1 text-[11.5px] text-warn">⚠ {n}</p>
        ))}
      </div>
    </section>
  );
}
