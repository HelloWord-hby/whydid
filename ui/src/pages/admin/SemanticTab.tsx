/** Semantic layer editor: table, time column, metrics and dimensions of one SQL source. */
import { Layers, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, CardShell, IconChip, Segmented } from '../../components/ui';
import { semanticOf, testCall, useAdmin } from './admin-state';
import { Field, NativeSelect, TextArea, TextInput, Toggle, toId, useT } from './form';
import { type Bundle, type DbInspection, type RawDimension, type RawMetric, type RawSemantic } from './types';

/** Rename a key while keeping the object's order. */
function renameKey<T>(obj: Record<string, T>, from: string, to: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
}

function valuesToText(values: Record<string, string> | undefined): string {
  return Object.entries(values ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
}

function textToValues(text: string): Record<string, string> | undefined {
  const pairs = text.split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2 && p[0]!.trim());
  return pairs.length ? Object.fromEntries(pairs.map(([k, ...v]) => [k!.trim(), v.join('=').trim()])) : undefined;
}

/** Tables and columns of the layer's database. Loads when the layer changes and on demand, not per keystroke. */
function useInspection(layer: string, table: string) {
  const [info, setInfo] = useState<DbInspection | null>(null);
  const [loading, setLoading] = useState(false);
  const tableRef = useRef(table);
  tableRef.current = table;
  const load = useCallback(() => {
    setLoading(true);
    testCall<DbInspection>('/admin/test/database', { source: layer, table: tableRef.current || undefined })
      .then(setInfo)
      .catch((e: Error) => setInfo({ ok: false, error: e.message }))
      .finally(() => setLoading(false));
  }, [layer]);
  useEffect(load, [load]);
  return { info, loading, load };
}

function MetricRow({ name, m, onRename, onChange, onRemove }: { name: string; m: RawMetric; onRename: (n: string) => void; onChange: (m: RawMetric) => void; onRemove: () => void }) {
  const t = useT();
  const set = <K extends keyof RawMetric>(k: K, v: RawMetric[K] | '') => {
    const next = { ...m };
    if (v === '' || v === undefined) delete next[k];
    else next[k] = v as RawMetric[K];
    onChange(next);
  };
  return (
    <div className="grid gap-2 rounded-xl border border-border/70 bg-popover/40 p-3 md:grid-cols-[150px_110px_minmax(0,1fr)_32px]">
      <Field label={t('Name', '名称')}><TextInput value={name} onChange={(v) => onRename(v.trim())} className="font-mono" /></Field>
      <Field label={t('Kind', '类型')}>
        <NativeSelect value={m.kind} onChange={(v) => onChange({ ...m, kind: v as RawMetric['kind'] })} options={[{ value: 'additive', label: t('additive', '可加') }, { value: 'rate', label: t('rate', '比率') }]} />
      </Field>
      {m.kind === 'additive' ? (
        <Field label={t('SQL aggregate', 'SQL 聚合表达式')} hint="COUNT(*) · COUNT(DISTINCT user_id) · SUM(amount)">
          <TextInput value={m.expr} onChange={(v) => set('expr', v)} className="font-mono" placeholder="COUNT(*)" />
        </Field>
      ) : (
        <Field label={t('Per-row value, averaged', '每行取值（求平均）')} hint="CASE WHEN resolved THEN 1.0 ELSE 0.0 END · latency_ms">
          <TextInput value={m.of} onChange={(v) => set('of', v)} className="font-mono" placeholder="CASE WHEN … THEN 1.0 ELSE 0.0 END" />
        </Field>
      )}
      <button type="button" onClick={onRemove} title={t('Remove', '删除')} className="mt-5 grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-bad"><Trash2 size={14} /></button>
      <div className="grid gap-2 md:col-span-4 md:grid-cols-[1fr_100px_1fr_auto]">
        <Field label={t('Label', '显示名')}><TextInput value={m.label} onChange={(v) => set('label', v)} /></Field>
        <Field label={t('Unit', '单位')}><TextInput value={m.unit} onChange={(v) => set('unit', v)} placeholder="ms · usd" /></Field>
        <Field label={t('Caveat for the agent', '给 agent 的注意事项')}><TextInput value={m.note} onChange={(v) => set('note', v)} /></Field>
        <div className="flex items-end pb-1.5"><Toggle checked={m.decompose !== false} onChange={(v) => set('decompose', v ? undefined : false)} label={t('Decompose', '允许拆解')} /></div>
      </div>
    </div>
  );
}

function DimensionRow({ name, d, columns, listId, onRename, onChange, onRemove }: { name: string; d: RawDimension; columns: string[]; listId: string; onRename: (n: string) => void; onChange: (d: RawDimension) => void; onRemove: () => void }) {
  const t = useT();
  const set = <K extends keyof RawDimension>(k: K, v: RawDimension[K] | '') => {
    const next = { ...d };
    if (v === '' || v === undefined) delete next[k];
    else next[k] = v as RawDimension[K];
    onChange(next);
  };
  return (
    <div className="grid gap-2 rounded-xl border border-border/70 bg-popover/40 p-3 md:grid-cols-[150px_160px_1fr_1fr_32px]">
      <Field label={t('Name', '名称')}><TextInput value={name} onChange={(v) => onRename(v.trim())} className="font-mono" /></Field>
      <Field label={t('Column', '列')}><TextInput value={d.column} onChange={(v) => set('column', v)} list={listId} className={columns.length && !columns.includes(d.column) ? 'border-bad/60 font-mono' : 'font-mono'} /></Field>
      <Field label={t('Label', '显示名')}><TextInput value={d.label} onChange={(v) => set('label', v)} /></Field>
      <Field label={t('Caveat', '注意事项')}><TextInput value={d.note} onChange={(v) => set('note', v)} /></Field>
      <button type="button" onClick={onRemove} title={t('Remove', '删除')} className="mt-5 grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-bad"><Trash2 size={14} /></button>
      <Field label={t('Value labels (raw=label, one per line)', '取值显示名（原值=显示名，每行一个）')} className="md:col-span-5">
        <TextArea rows={2} mono value={valuesToText(d.values)} onChange={(v) => set('values', textToValues(v))} placeholder={'billing=Billing\nhow_to=How-to question'} />
      </Field>
    </div>
  );
}

export function SemanticTab({ layer, setLayer }: { layer: string; setLayer: (l: string) => void }) {
  const t = useT();
  const { draft, edit } = useAdmin();
  const layers = ['main', ...Object.keys(draft!.semantic)];
  const current = layers.includes(layer) ? layer : 'main';
  const cfg = semanticOf(draft!, current)!;
  const { info, loading, load } = useInspection(current, cfg.table);
  const columns = info?.columns?.map((c) => c.name) ?? [];
  const tables = info?.tables?.map((x) => (x.schema === 'public' ? x.name : `${x.schema}.${x.name}`)) ?? [];
  const listId = `cols-${current}`;

  const change = (fn: (s: RawSemantic) => void) =>
    edit((d: Bundle) => {
      fn(current === 'main' ? d.main : d.semantic[current]!);
    });
  const setField = (k: 'table' | 'time_column' | 'timezone' | 'data_start' | 'context', v: string) =>
    change((s) => {
      if (v === '' && k !== 'table' && k !== 'time_column') delete s[k];
      else s[k] = v;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={current} onChange={setLayer} options={layers.map((l) => ({ value: l, label: l === 'main' ? t('main', 'main（主数据源）') : l }))} />
      </div>
      <CardShell className="p-5">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
          <IconChip icon={Layers} /> {t('Table', '数据表')}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {t('Read schema', '读取表结构')}</Button>
        </div>
        {info && !info.ok && <p className="mb-3 rounded-lg bg-bad/5 px-3 py-2 text-[12px] text-bad">{t('Cannot read the database: ', '读不到数据库：')}{info.error}</p>}
        <datalist id={`tables-${current}`}>{tables.map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id={listId}>{info?.columns?.map((c) => <option key={c.name} value={c.name}>{c.type}</option>)}</datalist>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label={t('Table or view', '表或视图')} hint={tables.length ? t(`${tables.length} found`, `找到 ${tables.length} 张`) : undefined}>
            <TextInput value={cfg.table} onChange={(v) => setField('table', v.trim())} list={`tables-${current}`} className="font-mono" placeholder="public.events" />
          </Field>
          <Field label={t('Time column', '时间列')} hint={columns.length ? t(`${columns.length} columns`, `${columns.length} 列`) : undefined}>
            <TextInput value={cfg.time_column} onChange={(v) => setField('time_column', v.trim())} list={listId} className="font-mono" placeholder="created_at" />
          </Field>
          <Field label={t('Timezone', '时区')}><TextInput value={cfg.timezone} onChange={(v) => setField('timezone', v.trim())} placeholder="UTC" /></Field>
          <Field label={t('Data starts', '数据起始日')}><TextInput value={cfg.data_start} onChange={(v) => setField('data_start', v.trim())} placeholder="2026-01-01" /></Field>
          <Field label={t('Context for the agent', '给 agent 的业务背景')} className="md:col-span-4">
            <TextArea rows={2} value={cfg.context} onChange={(v) => setField('context', v)} placeholder={t('What one row is, what the product does, known data gaps.', '一行代表什么、产品做什么、已知的数据缺口。')} />
          </Field>
        </div>
      </CardShell>

      <CardShell className="p-5">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
          {t('Metrics', '指标')} <span className="text-[12px] font-normal text-muted-foreground">{Object.keys(cfg.metrics).length}</span>
          <Button size="sm" className="ml-auto" onClick={() => change((s) => (s.metrics[toId('metric', Object.keys(s.metrics), 'metric')] = { kind: 'additive', expr: 'COUNT(*)' }))}>
            <Plus size={13} /> {t('Add metric', '添加指标')}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {Object.entries(cfg.metrics).map(([name, m], i) => (
            <MetricRow
              key={i}
              name={name}
              m={m}
              onRename={(n) => n && n !== name && !Object.hasOwn(cfg.metrics, n) && change((s) => (s.metrics = renameKey(s.metrics, name, n)))}
              onChange={(next) => change((s) => (s.metrics[name] = next))}
              onRemove={() => change((s) => delete s.metrics[name])}
            />
          ))}
          {Object.keys(cfg.metrics).length === 0 && <p className="text-[12.5px] text-warn">{t('Add at least one metric.', '至少需要一个指标。')}</p>}
        </div>
      </CardShell>

      <CardShell className="p-5">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
          {t('Dimensions', '维度')} <span className="text-[12px] font-normal text-muted-foreground">{Object.keys(cfg.dimensions).length}</span>
          <Button size="sm" className="ml-auto" onClick={() => change((s) => (s.dimensions[toId('dimension', Object.keys(s.dimensions), 'dimension')] = { column: '' }))}>
            <Plus size={13} /> {t('Add dimension', '添加维度')}
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {Object.entries(cfg.dimensions).map(([name, d], i) => (
            <DimensionRow
              key={i}
              name={name}
              d={d}
              columns={columns}
              listId={listId}
              onRename={(n) => n && n !== name && !Object.hasOwn(cfg.dimensions, n) && change((s) => (s.dimensions = renameKey(s.dimensions, name, n)))}
              onChange={(next) => change((s) => (s.dimensions[name] = next))}
              onRemove={() => change((s) => delete s.dimensions[name])}
            />
          ))}
        </div>
      </CardShell>
    </div>
  );
}
