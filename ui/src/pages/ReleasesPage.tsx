/** Release notes: the team's changelog as a timeline, editable as Markdown or replaced by an uploaded file. */
import { CalendarClock, FileUp, Info, Pencil, Rocket, Save } from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useApp } from '../app-state';
import { markdownToHtml } from '../agent/markdown';
import { putJson } from '../lib/api';
import { type ReleaseEntry, type ReleaseLog } from '../lib/types';
import { Button, CardShell, cn, Empty, IconChip } from '../components/ui';

const MAX_UPLOAD_BYTES = 256 * 1024;

function EntryItem({ e }: { e: ReleaseEntry }) {
  const { tr } = useApp();
  const html = useMemo(() => markdownToHtml(e.body), [e.body]);
  return (
    <li className="relative pl-7">
      <span className={cn('absolute top-1.5 left-0 size-3 rounded-full border-2 bg-card', e.date ? 'border-primary' : 'border-muted-foreground/50')} />
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {e.version && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-semibold text-primary">{e.version}</span>}
        <span className={cn('text-[12.5px] tabular-nums', e.date ? 'text-muted-foreground' : 'text-warn')}>{e.date ?? tr('rel.undated')}</span>
        {!e.version && <span className="text-[13px] font-medium">{e.title}</span>}
      </div>
      {e.body && <div className="prose-agent mt-1.5 text-[13px]" dangerouslySetInnerHTML={{ __html: html }} />}
    </li>
  );
}

function Editor({ initial, note, onCancel, onSaved }: {
  initial: string;
  note: string | null;
  onCancel: () => void;
  onSaved: (log: ReleaseLog) => void;
}) {
  const { tr } = useApp();
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setSaving(true);
    setError(null);
    putJson<ReleaseLog>('/releases', { markdown: text })
      .then(onSaved)
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };
  return (
    <CardShell className="p-4">
      <p className="mb-2 text-[12px] text-muted-foreground">{note ?? tr('rel.format')}</p>
      <textarea
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        spellCheck={false}
        className="h-[60vh] w-full resize-y rounded-xl border border-border bg-popover p-3 font-mono text-[12.5px] leading-relaxed shadow-well outline-none focus:border-primary/60"
      />
      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onCancel} disabled={saving}>{tr('rel.cancel')}</Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          <Save size={14} /> {saving ? tr('rel.saving') : tr('rel.save')}
        </Button>
      </div>
    </CardShell>
  );
}

function HowItWorks() {
  const { tr } = useApp();
  return (
    <CardShell className="p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <IconChip icon={Info} size={24} /> {tr('rel.how')}
      </div>
      <ul className="flex flex-col gap-2 text-[12.5px] text-muted-foreground">
        {(['rel.how1', 'rel.how2', 'rel.how3'] as const).map((k) => (
          <li key={k} className="flex gap-2">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
            {tr(k)}
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-border pt-3 text-[12px] text-muted-foreground">{tr('rel.format')}</p>
    </CardShell>
  );
}

export function ReleasesPage() {
  const { releases, setReleases, tr, lang } = useApp();
  const [editing, setEditing] = useState<{ text: string; note: string | null } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!releases) return <Empty>{tr('rel.unavailable')}</Empty>;
  const dated = releases.entries.filter((e) => e.date).length;
  const undated = releases.entries.length - dated;

  const onFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setFlash(tr('common.error', { msg: '> 256 KB' }));
      return;
    }
    void file.text().then((text) => setEditing({ text, note: tr('rel.uploadNote', { name: file.name }) }));
  };

  const status =
    releases.origin === 'demo'
      ? tr('rel.demo', { file: releases.file })
      : releases.origin === 'file'
        ? tr('rel.file', { file: releases.file, time: releases.updated_at ? new Date(releases.updated_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB') : '—' })
        : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {releases.origin === 'demo' && <span className="rounded-full bg-warn/15 px-2.5 py-1 text-[11.5px] font-medium text-warn">{tr('board.demo')}</span>}
          {releases.entries.length > 0 && <span className="text-[12.5px] text-muted-foreground">{tr('rel.count', { n: releases.entries.length, d: dated })}</span>}
          <div className="ml-auto flex gap-2">
            <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden" onChange={onFile} />
            <Button onClick={() => fileInput.current?.click()} disabled={Boolean(editing)}>
              <FileUp size={14} /> {tr('rel.upload')}
            </Button>
            <Button variant="dark" onClick={() => setEditing({ text: releases.markdown, note: null })} disabled={Boolean(editing)}>
              <Pencil size={14} /> {tr('rel.edit')}
            </Button>
          </div>
        </div>
        {status && <p className="text-[12px] text-muted-foreground">{status}</p>}
        {flash && <p className="text-[12px] text-good">{flash}</p>}

        {editing ? (
          <Editor
            initial={editing.text}
            note={editing.note}
            onCancel={() => setEditing(null)}
            onSaved={(log) => {
              setReleases(log);
              setEditing(null);
              setFlash(tr('rel.saved', { file: log.file }));
            }}
          />
        ) : releases.entries.length === 0 ? (
          <CardShell className="p-6">
            <Empty>
              <div className="flex flex-col items-center gap-2 text-center">
                <IconChip icon={Rocket} />
                {tr('rel.empty')}
              </div>
            </Empty>
          </CardShell>
        ) : (
          <CardShell className="p-5">
            {undated > 0 && (
              <p className="mb-4 flex items-center gap-1.5 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">
                <CalendarClock size={14} /> {tr('rel.undatedHint')}
              </p>
            )}
            <ol className="relative flex flex-col gap-6 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-border">
              {releases.entries.map((e) => (
                <EntryItem key={e.id} e={e} />
              ))}
            </ol>
          </CardShell>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <HowItWorks />
      </div>
    </div>
  );
}
