/**
 * Configuration back office. Four tabs, one draft: data sources, semantic
 * layers, boards and cards are saved together with "Save and apply" (the
 * server validates, writes the YAML files and reloads). Connection settings
 * (LLM, Langfuse keys, database URLs) are saved on their own, right away.
 */
import { AlertTriangle, CheckCircle2, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Empty, Segmented } from '../../components/ui';
import { AdminProvider, useAdmin } from './admin-state';
import { BoardsTab } from './BoardsTab';
import { useT } from './form';
import { LlmTab } from './LlmTab';
import { SemanticTab } from './SemanticTab';
import { SourcesTab } from './SourcesTab';

type Tab = 'llm' | 'sources' | 'semantic' | 'boards';
const TAB_KEY = 'whydid.admin.tab';

function SaveBar() {
  const t = useT();
  const { dirty, saving, saveError, savedAt, save, discard, overview } = useAdmin();
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [savedAt]);
  if (!dirty && !saveError && !justSaved) return null;
  return (
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        {saveError ? (
          <span className="flex min-w-0 flex-1 items-start gap-1.5 text-[12.5px] text-bad"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span className="break-words">{saveError}</span></span>
        ) : dirty ? (
          <span className="flex-1 text-[12.5px] text-muted-foreground">{t('Unsaved changes. Saving validates everything first; nothing is written if a check fails.', '有未保存的修改。保存时先整体校验，任何一项不通过都不会写入。')}</span>
        ) : (
          <span className="flex flex-1 items-center gap-1.5 text-[12.5px] text-good"><CheckCircle2 size={14} /> {t('Saved and applied. Boards, agent and evals now use the new configuration.', '已保存并生效。看板、agent 和评估集都已切到新配置。')}</span>
        )}
        {dirty && (
          <>
            <Button onClick={discard} disabled={saving}><RotateCcw size={14} /> {t('Discard', '放弃修改')}</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving || !overview?.writable}><Save size={14} /> {saving ? t('Saving…', '保存中…') : t('Save and apply', '保存并生效')}</Button>
          </>
        )}
      </div>
    </div>
  );
}

function AdminBody() {
  const t = useT();
  const { overview, error, draft } = useAdmin();
  const [tab, setTabState] = useState<Tab>(() => (localStorage.getItem(TAB_KEY) as Tab | null) ?? 'llm');
  const [layer, setLayer] = useState('main');
  const setTab = (next: Tab) => {
    localStorage.setItem(TAB_KEY, next);
    setTabState(next);
  };
  if (error && !overview) return <Empty>{error}</Empty>;
  if (!overview || !draft) return <div className="h-40 animate-pulse rounded-2xl bg-muted" />;
  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'llm', label: t('Model', '模型') },
            { value: 'sources', label: t('Data sources', '数据源') },
            { value: 'semantic', label: t('Semantic layer', '语义层') },
            { value: 'boards', label: t('Boards & cards', '看板与卡片') },
          ]}
        />
        <span className="ml-auto text-[11.5px] text-muted-foreground">
          <code>{overview.files.boards}</code> · <code>{overview.files.main}</code> · {t('prompt', '提示词')} <code>{overview.prompt_version}</code>
        </span>
      </div>
      {!overview.writable && (
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">
          {t('Read-only: this server is reachable beyond localhost without WHYDID_SERVE_TOKEN, so configuration cannot be changed here.', '只读：这个服务对外开放且没有设置 WHYDID_SERVE_TOKEN，不能在这里修改配置。')}
        </p>
      )}
      <div className="flex-1">
        {tab === 'llm' && <LlmTab />}
        {tab === 'sources' && (
          <SourcesTab
            onEditLayer={(id) => {
              setLayer(id);
              setTab('semantic');
            }}
          />
        )}
        {tab === 'semantic' && <SemanticTab layer={layer} setLayer={setLayer} />}
        {tab === 'boards' && <BoardsTab />}
      </div>
      <SaveBar />
    </div>
  );
}

export function AdminPage() {
  return (
    <AdminProvider>
      <AdminBody />
    </AdminProvider>
  );
}
