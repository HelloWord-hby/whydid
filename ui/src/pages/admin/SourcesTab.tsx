/** Data sources: model output (Langfuse or demo) and SQL sources with their database connections. */
import { Bot, Database, PlugZap, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { putJson } from '../../lib/api';
import { Button, CardShell, IconChip } from '../../components/ui';
import { testCall, useAdmin } from './admin-state';
import { Field, ID_PATTERN, NumberInput, OriginTag, TestBadge, TextInput, useT } from './form';
import { type DbInspection, type TestResult } from './types';

type Test = { running: boolean; ok?: boolean; text?: string } | null;

function LangfuseCard() {
  const t = useT();
  const { overview, reload } = useAdmin();
  const s = overview!.settings.langfuse;
  const [host, setHost] = useState(s.host.value ?? '');
  const [pk, setPk] = useState('');
  const [sk, setSk] = useState('');
  const [test, setTest] = useState<Test>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const live = s.public_key.origin !== 'none' && s.secret_key.origin !== 'none';

  const runTest = () => {
    setTest({ running: true });
    testCall<TestResult>('/admin/test/langfuse', { host: host || undefined, public_key: pk || undefined, secret_key: sk || undefined })
      .then((r) => setTest({ running: false, ok: r.ok, text: r.ok ? t(`Connected · ${String(r.traces ?? '?')} traces`, `已连接 · 共 ${String(r.traces ?? '?')} 条 trace`) : `${r.status ? `HTTP ${r.status}: ` : ''}${r.error ?? ''}` }))
      .catch((e: Error) => setTest({ running: false, ok: false, text: e.message }));
  };
  const save = (clear = false) => {
    const langfuse: Record<string, string | null> = clear ? { public_key: null, secret_key: null } : { host: host || null };
    if (!clear && pk) langfuse.public_key = pk;
    if (!clear && sk) langfuse.secret_key = sk;
    putJson('/admin/settings', { langfuse })
      .then(async () => {
        setPk('');
        setSk('');
        await reload();
        setMsg({ ok: true, text: t('Saved. The model board reloads with these keys.', '已保存，模型看板已按新 key 重新加载。') });
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  };

  return (
    <div className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
        Langfuse
        <span className={live ? 'rounded-full bg-good/15 px-2 py-px text-[11px] text-good' : 'rounded-full bg-warn/15 px-2 py-px text-[11px] text-warn'}>
          {live ? t('live', '实时数据') : t('no keys · demo data', '未配置 · 使用演示数据')}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Host" hint={<OriginTag origin={s.host.origin} />}>
          <TextInput value={host} onChange={setHost} placeholder="https://cloud.langfuse.com" />
        </Field>
        <Field label="Public key" hint={<span className="inline-flex gap-1.5"><OriginTag origin={s.public_key.origin} />{s.public_key.value && <code className="text-[11px]">{s.public_key.value}</code>}</span>}>
          <TextInput value={pk} onChange={setPk} autoComplete="off" placeholder={s.public_key.value ? t('leave empty to keep', '留空则保留') : 'pk-lf-…'} />
        </Field>
        <Field label="Secret key" hint={<span className="inline-flex gap-1.5"><OriginTag origin={s.secret_key.origin} />{s.secret_key.value && <code className="text-[11px]">{s.secret_key.value}</code>}</span>}>
          <TextInput type="password" value={sk} onChange={setSk} autoComplete="off" placeholder={s.secret_key.value ? t('leave empty to keep', '留空则保留') : 'sk-lf-…'} />
        </Field>
      </div>
      {host.replace(/\/+$/, '') !== (s.host.value ?? '').replace(/\/+$/, '') && live && (!pk || !sk) && (
        <p className="mt-2 text-[12px] text-warn">{t('The host changed: enter both keys for it. Saved keys are only sent to the host they were saved for.', '地址变了，请填写这个地址的两个 key。已保存的 key 只会发给保存时的那个地址。')}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={runTest} disabled={test?.running}><PlugZap size={14} /> {t('Test', '测试连接')}</Button>
        <Button variant="primary" onClick={() => save()} disabled={!overview!.writable}><Save size={14} /> {t('Save keys', '保存 key')}</Button>
        {s.public_key.origin === 'saved' && <Button variant="ghost" onClick={() => save(true)}>{t('Remove saved keys', '删除已保存的 key')}</Button>}
        <TestBadge state={test} />
      </div>
      {msg && <p className={msg.ok ? 'mt-2 text-[12px] text-good' : 'mt-2 text-[12px] text-bad'}>{msg.text}</p>}
    </div>
  );
}

function DatabaseRow({ id, label, path, onRemove }: { id: string; label: string; path: string | null; onRemove?: () => void }) {
  const t = useT();
  const { overview, reload } = useAdmin();
  const own = overview!.settings.databases.sources[id];
  const fallback = overview!.settings.databases.default;
  const [url, setUrl] = useState('');
  const [test, setTest] = useState<Test>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const runTest = () => {
    setTest({ running: true });
    testCall<DbInspection>('/admin/test/database', url ? { url } : { source: id })
      .then((r) => setTest({ running: false, ok: r.ok, text: r.ok ? t(`${r.database} · ${r.tables?.length ?? 0} tables`, `${r.database} · ${r.tables?.length ?? 0} 张表`) : r.error }))
      .catch((e: Error) => setTest({ running: false, ok: false, text: e.message }));
  };
  const save = (value: string | null) =>
    putJson('/admin/settings', { databases: { [id]: value } })
      .then(async () => {
        setUrl('');
        setMsg(null);
        await reload();
      })
      .catch((e: Error) => setMsg(e.message));

  return (
    <div className="grid gap-3 border-t border-border/70 py-4 first:border-t-0 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <div className="font-mono text-[13px] font-semibold">{id}</div>
        <div className="text-[12px] text-muted-foreground">{label}</div>
        {path && <code className="text-[11px] text-muted-foreground">{path}</code>}
      </div>
      <div className="min-w-0">
        <Field
          label={t('Database URL', '数据库连接')}
          hint={own ? <span className="inline-flex gap-1.5"><OriginTag origin="saved" /><code className="text-[11px]">{own}</code></span> : <span className="inline-flex gap-1.5"><OriginTag origin={fallback.origin} />{fallback.value && <code className="text-[11px]">DATABASE_URL · {fallback.value}</code>}</span>}
        >
          <TextInput type="password" autoComplete="off" value={url} onChange={setUrl} placeholder="postgres://user:password@host:5432/db" />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runTest} disabled={test?.running}><PlugZap size={13} /> {t('Test', '测试连接')}</Button>
          <Button size="sm" variant="primary" onClick={() => save(url)} disabled={!url || !overview!.writable}><Save size={13} /> {t('Save URL', '保存连接')}</Button>
          {own && <Button size="sm" variant="ghost" onClick={() => save(null)}>{t('Use DATABASE_URL', '改用 DATABASE_URL')}</Button>}
          {onRemove && <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={onRemove}><Trash2 size={13} /> {t('Remove source', '删除数据源')}</Button>}
          <TestBadge state={test} />
        </div>
        {msg && <p className="mt-1 text-[12px] text-bad">{msg}</p>}
      </div>
    </div>
  );
}

export function SourcesTab({ onEditLayer }: { onEditLayer: (id: string) => void }) {
  const t = useT();
  const { overview, draft, edit } = useAdmin();
  const [newId, setNewId] = useState('');
  const sources = draft!.boards.sources;
  const modelIds = Object.keys(sources).filter((id) => sources[id]!.kind === 'model_output');
  const sqlIds = Object.keys(sources).filter((id) => sources[id]!.kind === 'semantic');
  const usedBy = (id: string) => draft!.boards.boards.filter((b) => b.source === id).map((b) => b.id);
  const idError = newId && (!ID_PATTERN.test(newId) ? t('lower_snake_case only', '只能用小写字母、数字和下划线') : Object.hasOwn(sources, newId) || newId === 'main' ? t('already exists', '已存在') : null);

  const addSource = () => {
    const id = newId;
    edit((d) => {
      d.boards.sources[id] = { kind: 'semantic' };
      d.semantic[id] = { table: '', time_column: '', metrics: {}, dimensions: {} };
    });
    setNewId('');
    onEditLayer(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <CardShell className="p-5">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold"><IconChip icon={Bot} /> {t('Model output', '模型输出')}</div>
        {modelIds.map((id) => {
          const src = sources[id]!;
          const set = (k: 'feedback_score' | 'negative_feedback_value' | 'low_score_threshold' | 'max_pages', v: string | number | undefined) =>
            edit((d) => {
              const s = d.boards.sources[id]!;
              if (v === undefined || v === '') delete s[k];
              else (s as unknown as Record<string, unknown>)[k] = v;
            });
          return (
            <div key={id} className="grid gap-3 md:grid-cols-4">
              <Field label={t('Feedback score name', '用户反馈评分名')} hint={t('default user_feedback', '默认 user_feedback')}>
                <TextInput value={src.feedback_score} onChange={(v) => set('feedback_score', v)} placeholder="user_feedback" />
              </Field>
              <Field label={t('Thumbs-down value', '点踩对应的值')} hint={t('default 0', '默认 0')}>
                <NumberInput value={src.negative_feedback_value} onChange={(v) => set('negative_feedback_value', v)} placeholder="0" />
              </Field>
              <Field label={t('Low-score threshold', '低分阈值')} hint={t('scores below count as low · default 0.5', '低于此分算低分 · 默认 0.5')}>
                <NumberInput value={src.low_score_threshold} onChange={(v) => set('low_score_threshold', v)} step={0.05} min={0} max={1} placeholder="0.5" />
              </Field>
              <Field label={t('Page cap per fetch', '每次拉取页数上限')} hint={t('100 items per page · default 100', '每页 100 条 · 默认 100')}>
                <NumberInput value={src.max_pages} onChange={(v) => set('max_pages', v)} min={1} placeholder="100" />
              </Field>
            </div>
          );
        })}
        {modelIds.length === 0 && <p className="text-[12.5px] text-muted-foreground">{t('No model-output source configured.', '没有配置模型输出数据源。')}</p>}
        <LangfuseCard />
      </CardShell>

      <CardShell className="p-5">
        <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold"><IconChip icon={Database} /> {t('SQL sources (PostgreSQL)', 'SQL 数据源（PostgreSQL）')}</div>
        <p className="mb-2 text-[12px] text-muted-foreground">{t('Each source is one table with its own semantic layer. Connections are read-only.', '每个数据源对应一张表和它的语义层。连接是只读的。')}</p>
        <DatabaseRow id="main" label={t('Main · agent and Metrics page', '主数据源 · agent 与指标总览')} path={overview!.files.main} />
        {sqlIds.map((id) => {
          const boards = usedBy(id);
          return (
            <div key={id}>
              <DatabaseRow
                id={id}
                label={boards.length ? t(`Used by ${boards.join(', ')}`, `被看板 ${boards.join('、')} 使用`) : t('Not used by a board yet', '还没有看板使用')}
                path={overview!.semantic_paths[id] ?? t('new file on save', '保存时新建文件')}
                onRemove={
                  boards.length
                    ? undefined
                    : () =>
                        edit((d) => {
                          delete d.boards.sources[id];
                          delete d.semantic[id];
                        })
                }
              />
              <button type="button" onClick={() => onEditLayer(id)} className="-mt-2 mb-2 cursor-pointer text-[12px] text-primary hover:underline lg:ml-[232px]">
                {t('Edit semantic layer →', '编辑语义层 →')}
              </button>
            </div>
          );
        })}
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/70 pt-4">
          <Field label={t('New source id', '新数据源 id')} hint={idError || t('e.g. orders', '例如 orders')}>
            <TextInput value={newId} onChange={(v) => setNewId(v.trim())} placeholder="orders" />
          </Field>
          <Button onClick={addSource} disabled={!newId || Boolean(idError)}><Plus size={14} /> {t('Add SQL source', '添加 SQL 数据源')}</Button>
        </div>
      </CardShell>
    </div>
  );
}
