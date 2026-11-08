/** Card params as form controls, driven by the provider's field descriptors. */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { useApp } from '../../app-state';
import { Field, MultiPick, NativeSelect, NumberInput, TextInput, Toggle, useT } from './form';
import { type ParamField, type RawSemantic } from './types';

type Params = Record<string, unknown>;

interface Props {
  fields: ParamField[];
  params: Params;
  onChange: (p: Params) => void;
  semantic?: RawSemantic;
  scores: string[];
}

const isEmpty = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function FiltersEditor({ value, onChange, dims }: { value: Record<string, string | string[]>; onChange: (v: Record<string, string | string[]>) => void; dims: string[] }) {
  const t = useT();
  const rows = Object.entries(value);
  const set = (next: Array<[string, string | string[]]>) => onChange(Object.fromEntries(next));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([dim, vals], i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_32px] gap-1.5">
          <NativeSelect value={dim} onChange={(d) => set(rows.map((r, k) => (k === i ? [d, r[1]] : r)))} options={dims.map((d) => ({ value: d, label: d }))} />
          <TextInput
            value={Array.isArray(vals) ? vals.join(', ') : vals}
            onChange={(text) => {
              const list = text.split(',').map((x) => x.trim()).filter(Boolean);
              set(rows.map((r, k) => (k === i ? [r[0], list.length === 1 ? list[0]! : list] : r)));
            }}
            placeholder={t('value, value', '取值，多个用逗号')}
          />
          <button type="button" onClick={() => set(rows.filter((_, k) => k !== i))} className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:text-bad"><Trash2 size={13} /></button>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="self-start" disabled={!dims.length} onClick={() => set([...rows, [dims.find((d) => !(d in value)) ?? dims[0]!, '']])}>
        <Plus size={13} /> {t('Add filter', '添加筛选')}
      </Button>
    </div>
  );
}

function StepsEditor({ value, onChange, metrics, max }: { value: Array<{ metric: string; label?: string }>; onChange: (v: Array<{ metric: string; label?: string }>) => void; metrics: string[]; max?: number }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((s, i) => (
        <div key={i} className="grid grid-cols-[20px_1fr_1fr_32px] items-center gap-1.5">
          <span className="text-center text-[11.5px] text-muted-foreground tabular-nums">{i + 1}</span>
          <NativeSelect value={s.metric} onChange={(m) => onChange(value.map((x, k) => (k === i ? { ...x, metric: m } : x)))} options={metrics.map((m) => ({ value: m, label: m }))} />
          <TextInput value={s.label} onChange={(l) => onChange(value.map((x, k) => (k === i ? (l ? { ...x, label: l } : { metric: x.metric }) : x)))} placeholder={t('Step label', '步骤名')} />
          <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:text-bad"><Trash2 size={13} /></button>
        </div>
      ))}
      <Button size="sm" variant="ghost" className="self-start" disabled={!metrics.length || (max !== undefined && value.length >= max)} onClick={() => onChange([...value, { metric: metrics[0]! }])}>
        <Plus size={13} /> {t('Add step', '添加步骤')}
      </Button>
    </div>
  );
}

export function ParamFields({ fields, params, onChange, semantic, scores }: Props) {
  const { lang } = useApp();
  const t = useT();
  const metrics = Object.keys(semantic?.metrics ?? {});
  const dims = Object.keys(semantic?.dimensions ?? {});
  const set = (key: string, v: unknown) => {
    const next = { ...params };
    if (isEmpty(v)) delete next[key];
    else next[key] = v;
    onChange(next);
  };
  if (!fields.length) return <p className="text-[12px] text-muted-foreground">{t('This card has no settings.', '这类卡片没有可调参数。')}</p>;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((f) => {
        const label = `${f.label[lang]}${f.required ? ' *' : ''}`;
        const v = params[f.key];
        const fallback = f.default !== undefined ? t(`default: ${String(f.default)}`, `默认：${String(f.default)}`) : t('(default)', '（默认）');
        const wide = ['metrics', 'scores', 'filters', 'steps'].includes(f.type);
        let control;
        switch (f.type) {
          case 'metric':
            control = <NativeSelect value={v as string} onChange={(x) => set(f.key, x)} placeholder={t('Choose a metric', '选择指标')} options={metrics.map((m) => ({ value: m, label: semantic?.metrics[m]?.label ? `${m} · ${semantic.metrics[m]!.label}` : m }))} />;
            break;
          case 'dimension':
            control = <NativeSelect value={v as string} onChange={(x) => set(f.key, x)} placeholder={t('Choose a dimension', '选择维度')} options={dims.map((d) => ({ value: d, label: semantic?.dimensions[d]?.label ? `${d} · ${semantic.dimensions[d]!.label}` : d }))} />;
            break;
          case 'metrics':
            control = <MultiPick value={(v as string[]) ?? []} onChange={(x) => set(f.key, x)} options={metrics} max={f.max} />;
            break;
          case 'score':
            control = <NativeSelect value={v as string} onChange={(x) => set(f.key, x)} placeholder={f.required ? t('Choose a score', '选择评分') : t('All scores', '全部评分')} options={[...new Set([...(v ? [v as string] : []), ...scores])].map((s) => ({ value: s, label: s }))} />;
            break;
          case 'scores':
            control = <MultiPick value={(v as string[]) ?? []} onChange={(x) => set(f.key, x)} options={scores} />;
            break;
          case 'enum':
            control = <NativeSelect value={v as string} onChange={(x) => set(f.key, x)} placeholder={f.required ? t('Choose', '请选择') : fallback} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />;
            break;
          case 'number':
            control = <NumberInput value={v as number | undefined} onChange={(x) => set(f.key, x)} min={f.min} max={f.max} placeholder={f.default !== undefined ? String(f.default) : undefined} />;
            break;
          case 'boolean':
            control = <div className="pt-1"><Toggle checked={(v as boolean | undefined) ?? Boolean(f.default)} onChange={(x) => set(f.key, x === Boolean(f.default) ? undefined : x)} label="" /></div>;
            break;
          case 'filters':
            control = <FiltersEditor value={(v as Record<string, string | string[]>) ?? {}} onChange={(x) => set(f.key, Object.keys(x).length ? x : undefined)} dims={dims} />;
            break;
          case 'steps':
            control = <StepsEditor value={(v as Array<{ metric: string; label?: string }>) ?? []} onChange={(x) => set(f.key, x)} metrics={metrics} max={f.max} />;
            break;
        }
        return (
          <Field key={f.key} label={label} className={wide ? 'md:col-span-2' : undefined}>
            {control}
          </Field>
        );
      })}
    </div>
  );
}

