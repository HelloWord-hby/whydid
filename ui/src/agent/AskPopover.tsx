/** Per-card "Ask Agent" chip: a popover of preset questions that sends on click. */
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app-state';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui';
import { loc, t, type Lang } from '../lib/i18n';
import { type CatalogCard } from '../lib/types';
import { useAgent } from './agent-state';

const SAMPLE_PROVIDERS = new Set(['low_score_samples', 'feedback_samples']);

/** Preset questions per card, by what it shows. A configured `ask` comes first. */
export function presetsFor(card: CatalogCard, days: number, lang: Lang): string[] {
  const title = loc(card.title, lang);
  let list: string[];
  if (SAMPLE_PROVIDERS.has(card.provider)) {
    list = [t(lang, 'preset.samples1'), t(lang, 'preset.samples2')];
  } else if (card.display === 'stat') {
    list = [t(lang, 'preset.stat1', { title, n: days }), t(lang, 'preset.stat2', { title })];
  } else if (card.display === 'line') {
    list = [t(lang, 'preset.line1', { title, n: days })];
  } else {
    list = [t(lang, 'preset.table1', { title }), t(lang, 'preset.table2')];
  }
  return card.ask ? [loc(card.ask, lang), ...list].slice(0, 3) : list;
}

export function AskPopover({ card }: { card: CatalogCard }) {
  const { tr, lang, days } = useApp();
  const agent = useAgent();
  const [open, setOpen] = useState(false);
  if (!agent.status) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-popover px-2.5 text-[11px] font-medium text-primary opacity-0 shadow-emboss-sm transition group-hover:opacity-100 data-[state=open]:opacity-100 cursor-pointer"
        >
          {tr('card.ask')} <ArrowUpRight size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="mb-2 text-[11.5px] text-muted-foreground">{tr('card.about', { title: loc(card.title, lang) })}</div>
        <div className="flex flex-col gap-1.5">
          {presetsFor(card, days, lang).map((q) => (
            <button
              key={q}
              type="button"
              disabled={agent.running || !agent.status?.llm_configured}
              onClick={() => {
                setOpen(false);
                agent.send(q, { entry: 'card', card: card.id });
              }}
              className="group/q flex items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-[12px] hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50 cursor-pointer"
            >
              <MessageSquare size={13} className="mt-0.5 shrink-0 text-primary" />
              <span className="flex-1">{q}</span>
              <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-primary opacity-0 group-hover/q:opacity-100" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
