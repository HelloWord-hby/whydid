/** One card's settings, edited in the draft, with a live preview computed by the server from the draft. */
import { Eye, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app-state';
import { BarBody, LineBody, PieBody, StatBody, TableBody } from '../../components/charts';
import { Button, CardShell, cn, Segmented } from '../../components/ui';
import { loc } from '../../lib/i18n';
import { type CardResponse } from '../../lib/types';
import { semanticOf, useAdmin } from './admin-state';
import { Field, ID_PATTERN, LocalizedInput, NativeSelect, TextInput, Toggle, toId, useT } from './form';
import { ParamFields } from './ParamFields';
import { type RawCard } from './types';

const PREVIEW_DELAY_MS = 600;

function PreviewBody({ r }: { r: CardResponse }) {
  const { tr } = useApp();
  const d = r.data;
  return (
    <div>
      {d.display === 'stat' && <StatBody d={d} />}
      {d.display === 'line' && <LineBody d={d} />}
      {d.display === 'bar' && <BarBody d={d} />}
      {d.display === 'pie' && <PieBody d={d} />}
      {d.display === 'table' && <TableBody d={d} />}
      <p className="mt-2 text-[11px] text-muted-foreground">{r.mode === 'demo' ? tr('board.demo') : 'live'} · {r.window.current.from} → {r.window.current.to}</p>
      {r.notes?.map((n) => <p key={n} className="mt-1 text-[11.5px] text-warn">⚠ {n}</p>)}
    </div>
  );
}

export function CardEditor({ index, isNew, onClose }: { index: number; isNew: boolean; onClose: (keep: boolean) => void }) {
  const t = useT();
  const { lang, days } = useApp();
  const { draft, edit, overview, preview } = useAdmin();
  const card = draft!.boards.cards[index]!;
  const board = draft!.boards.boards.find((b) => b.id === card.board);
  const source = board ? draft!.boards.sources[board.source] : undefined;
  const providers = overview!.providers.filter((p) => p.source === source?.kind);
  const provider = overview!.providers.find((p) => p.name === card.provider);
  const semantic = source?.kind === 'semantic' && board ? semanticOf(draft!, board.source) : undefined;
  const otherIds = draft!.boards.cards.filter((_, i) => i !== index).map((c) => c.id);
  const idError = !ID_PATTERN.test(card.id) ? t('lower_snake_case only', '只能用小写字母、数字和下划线') : otherIds.includes(card.id) ? t('id already used', 'id 已被占用') : null;

  const set = (fn: (c: RawCard) => void) => edit((d) => fn(d.boards.cards[index]!));
  const setOpt = <K extends keyof RawCard>(k: K, v: RawCard[K] | undefined) =>
    set((c) => {
      if (v === undefined) delete c[k];
      else c[k] = v;
    });

  const [result, setResult] = useState<{ r?: CardResponse; error?: string; loading: boolean }>({ loading: true });
  const key = useMemo(() => JSON.stringify([card, semantic, source, days]), [card, semantic, source, days]);
  useEffect(() => {
    if (idError) return;
    setResult((cur) => ({ ...cur, loading: true }));
    const timer = setTimeout(() => {
      preview(card.id, days)
        .then((r) => setResult({ r, loading: false }))
        .catch((e: Error) => setResult({ error: e.message, loading: false }));
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // The key captures everything the preview depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idError]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <CardShell className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-[14px] font-semibold">{isNew ? t('New card', '新卡片') : loc(card.title, lang) || card.id}</h3>
          <span className="text-[12px] text-muted-foreground">{t('on', '位于')} {board ? loc(board.title, lang) : card.board}</span>
          <button type="button" onClick={() => onClose(true)} className="ml-auto grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"><X size={15} /></button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('Title', '标题')} className="md:col-span-2"><LocalizedInput
              value={card.title}
              onChange={(v) =>
                set((c) => {
                  // A new card's id follows its English title until the id is edited by hand.
                  const enOf = (x: RawCard['title'] | undefined) => (typeof x === 'string' ? x : (x?.en ?? ''));
                  const auto = /^card(_\d+)?$/.test(c.id) || c.id === toId(enOf(c.title), otherIds, 'card');
                  c.title = v ?? '';
                  if (isNew && auto && enOf(v)) c.id = toId(enOf(v), otherIds, 'card');
                })
              }
            /></Field>
          <Field label={t('Description', '说明')} className="md:col-span-2"><LocalizedInput value={card.description} onChange={(v) => setOpt('description', v)} /></Field>
          <Field label={t('Data', '数据类型')}>
            <NativeSelect
              value={card.provider}
              onChange={(name) =>
                set((c) => {
                  const p = overview!.providers.find((x) => x.name === name)!;
                  c.provider = name;
                  c.display = p.displays.includes(c.display) ? c.display : p.displays[0]!;
                  delete c.params;
                })
              }
              options={providers.map((p) => ({ value: p.name, label: p.name }))}
            />
          </Field>
          <Field label={t('Display', '展示方式')}>
            <Segmented value={card.display} onChange={(v) => setOpt('display', v)} options={(provider?.displays ?? []).map((d) => ({ value: d, label: d }))} />
          </Field>
        </div>
        <div className="mt-4 border-t border-border/70 pt-4">
          <div className="mb-2 text-[12px] font-semibold">{t('Settings', '参数')}</div>
          <ParamFields fields={provider?.fields ?? []} params={card.params ?? {}} onChange={(p) => setOpt('params', Object.keys(p).length ? p : undefined)} semantic={semantic} scores={overview!.model_scores} />
        </div>
        <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 md:grid-cols-3">
          <Field label="id" hint={idError ?? undefined}><TextInput value={card.id} onChange={(v) => setOpt('id', v.trim())} className={cn('font-mono', idError && 'border-bad/60')} /></Field>
          <Field label={t('Width', '宽度')}>
            <Segmented value={card.size ?? 1} onChange={(v) => setOpt('size', v === 1 ? undefined : v)} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n}/4` }))} />
          </Field>
          <div className="flex items-end pb-1.5"><Toggle checked={Boolean(card.default)} onChange={(v) => setOpt('default', v || undefined)} label={t('On the board by default', '默认显示在看板上')} /></div>
          {source?.kind === 'semantic' && (
            <Field label={t('Preset question for Ask Agent', '"问 Agent" 的预设问题')} className="md:col-span-3"><LocalizedInput value={card.ask} onChange={(v) => setOpt('ask', v)} /></Field>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {isNew && <Button onClick={() => onClose(false)}>{t('Discard card', '放弃这张卡片')}</Button>}
          <Button variant="dark" onClick={() => onClose(true)}>{t('Done', '完成')}</Button>
        </div>
      </CardShell>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><Eye size={13} /> {t('Live preview · not saved yet', '实时预览 · 尚未保存')}</div>
        <CardShell className={cn('min-h-40 p-4 transition', result.loading && 'opacity-60')}>
          <div className="mb-2 text-[13px] font-semibold">{loc(card.title, lang) || card.id}</div>
          {idError ? <p className="text-[12px] text-bad">{idError}</p> : result.error ? <p className="text-[12px] break-words text-bad">{result.error}</p> : result.r ? <PreviewBody r={result.r} /> : <div className="h-24 animate-pulse rounded-lg bg-muted" />}
        </CardShell>
      </div>
    </div>
  );
}
