/** Form controls for the admin page, styled like the rest of the dashboard. */
import { Check, Loader2, X } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode } from 'react';
import { useApp } from '../../app-state';
import { cn } from '../../components/ui';
import { type Localized } from '../../lib/types';

/** Inline bilingual text: t('Save', '保存'). Keeps admin strings next to their controls. */
export function useT(): (en: string, zh: string) => string {
  const { lang } = useApp();
  return (en, zh) => (lang === 'zh' ? zh : en);
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[11.5px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground/90">{hint}</span>}
    </label>
  );
}

const INPUT = 'h-8 w-full rounded-lg border border-border bg-popover px-2.5 text-[12.5px] shadow-well outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 disabled:opacity-60';

export function TextInput({ value, onChange, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string | undefined; onChange: (v: string) => void }) {
  return <input {...rest} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cn(INPUT, className)} />;
}

export function NumberInput({ value, onChange, min, max, step, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      className={INPUT}
    />
  );
}

export function TextArea({ value, onChange, rows = 3, placeholder, mono }: { value: string | undefined; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  return (
    <textarea
      value={value ?? ''}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn('w-full resize-y rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[12.5px] shadow-well outline-none focus:border-primary/60', mono && 'font-mono text-[12px]')}
    />
  );
}

export function NativeSelect({ value, onChange, options, placeholder }: { value: string | undefined; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; placeholder?: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cn(INPUT, 'cursor-pointer pr-7')}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="inline-flex cursor-pointer items-center gap-2 text-[12.5px]">
      <span className={cn('relative h-[18px] w-8 rounded-full transition', checked ? 'bg-primary' : 'bg-secondary shadow-well')}>
        <span className={cn('absolute top-[2px] size-[14px] rounded-full bg-popover shadow-emboss-sm transition-all', checked ? 'left-[16px]' : 'left-[2px]')} />
      </span>
      {label}
    </button>
  );
}

/** Pick several values in order from a list; unknown current values stay visible. */
export function MultiPick({ value, onChange, options, max }: { value: string[]; onChange: (v: string[]) => void; options: string[]; max?: number }) {
  const all = [...new Set([...value, ...options])];
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((o) => {
        const i = value.indexOf(o);
        const on = i >= 0;
        const full = !on && max !== undefined && value.length >= max;
        return (
          <button
            key={o}
            type="button"
            disabled={full}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-40',
              on ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-popover text-muted-foreground hover:text-foreground',
              !options.includes(o) && 'border-bad/50 text-bad'
            )}
          >
            {on && <span className="text-[10.5px] tabular-nums">{i + 1}</span>}
            {o}
          </button>
        );
      })}
      {all.length === 0 && <span className="text-[12px] text-muted-foreground">—</span>}
    </div>
  );
}

/** A display text that may be one string or {en, zh}. Empty languages are dropped. */
export function LocalizedInput({ value, onChange, placeholder }: { value: Localized | undefined; onChange: (v: Localized | undefined) => void; placeholder?: string }) {
  const en = typeof value === 'string' ? value : (value?.en ?? '');
  const zh = typeof value === 'string' ? '' : (value?.zh ?? '');
  const set = (nextEn: string, nextZh: string) => {
    if (!nextEn && !nextZh) onChange(undefined);
    else if (!nextZh) onChange(nextEn);
    else onChange({ en: nextEn || nextZh, zh: nextZh });
  };
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <TextInput value={en} onChange={(v) => set(v, zh)} placeholder={placeholder ? `${placeholder} · EN` : 'English'} />
      <TextInput value={zh} onChange={(v) => set(en, v)} placeholder={placeholder ? `${placeholder} · 中文` : '中文'} />
    </div>
  );
}

export function TestBadge({ state }: { state: { running: boolean; ok?: boolean; text?: string } | null }) {
  if (!state) return null;
  if (state.running) return <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Loader2 size={13} className="animate-spin" /></span>;
  return (
    <span className={cn('inline-flex min-w-0 items-start gap-1 text-[12px] break-all', state.ok ? 'text-good' : 'text-bad')}>
      {state.ok ? <Check size={13} className="mt-0.5 shrink-0" /> : <X size={13} className="mt-0.5 shrink-0" />}
      {state.text}
    </span>
  );
}

export function OriginTag({ origin }: { origin: 'saved' | 'env' | 'default' | 'none' }) {
  const t = useT();
  const text = { saved: t('saved here', '本页保存'), env: t('from .env', '来自 .env'), default: t('default', '默认值'), none: t('not set', '未设置') }[origin];
  return <span className={cn('rounded-full px-1.5 py-px text-[10.5px]', origin === 'none' ? 'bg-warn/15 text-warn' : 'bg-secondary/70 text-muted-foreground')}>{text}</span>;
}

export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** lower_snake_case id from free text; falls back to a prefix + number. */
export function toId(text: string, taken: Iterable<string>, prefix: string): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || prefix;
  const clean = ID_PATTERN.test(base) ? base : `${prefix}_${base}`.replace(/_+/g, '_');
  const used = new Set(taken);
  if (!used.has(clean)) return clean;
  let i = 2;
  while (used.has(`${clean}_${i}`)) i++;
  return `${clean}_${i}`;
}
