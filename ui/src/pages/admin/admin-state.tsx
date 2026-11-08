/**
 * Admin page state: the server's overview, a draft of the config bundle,
 * and save / discard. Every edit produces a new draft (structuredClone,
 * then change the copy); "dirty" compares the draft with the saved bundle.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../../app-state';
import { clearCardCache } from '../../components/BoardCard';
import { getJson, postJson, putJson } from '../../lib/api';
import { type CardResponse } from '../../lib/types';
import { type AdminOverview, type Bundle } from './types';

interface AdminState {
  overview: AdminOverview | null;
  error: string | null;
  draft: Bundle | null;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  savedAt: number | null;
  edit: (fn: (draft: Bundle) => void) => void;
  save: () => Promise<void>;
  discard: () => void;
  reload: () => Promise<void>;
  preview: (card: string, days: number) => Promise<CardResponse>;
}

const Ctx = createContext<AdminState | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const { refresh } = useApp();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [draft, setDraft] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const reload = useCallback(
    () =>
      getJson<AdminOverview>('/admin/config')
        .then((o) => {
          setOverview(o);
          setDraft(structuredClone(o.bundle));
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    []
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const edit = useCallback((fn: (d: Bundle) => void) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      return next;
    });
    setSaveError(null);
  }, []);

  const dirty = useMemo(() => Boolean(overview && draft && JSON.stringify(overview.bundle) !== JSON.stringify(draft)), [overview, draft]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await putJson('/admin/config', { bundle: draft });
      clearCardCache();
      await Promise.all([reload(), refresh()]);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [draft, reload, refresh]);

  const discard = useCallback(() => {
    if (overview) setDraft(structuredClone(overview.bundle));
    setSaveError(null);
  }, [overview]);

  const preview = useCallback(
    (card: string, days: number) => postJson<CardResponse>('/admin/preview', { bundle: draft, card, days }),
    [draft]
  );

  const value = useMemo<AdminState>(
    () => ({ overview, error, draft, dirty, saving, saveError, savedAt, edit, save, discard, reload, preview }),
    [overview, error, draft, dirty, saving, saveError, savedAt, edit, save, discard, reload, preview]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdmin outside AdminProvider');
  return v;
}

/** Small helpers shared by the tabs. */
export const testCall = <T,>(path: string, payload: unknown) => postJson<T>(path, payload);

export function semanticOf(draft: Bundle, layer: string) {
  return layer === 'main' ? draft.main : draft.semantic[layer];
}
