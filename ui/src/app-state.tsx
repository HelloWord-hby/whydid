/** App-wide state: language, theme, window, catalog, release log, hash route. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getJson } from './lib/api';
import { initialLang, LANG_KEY, t, type DictKey, type Lang } from './lib/i18n';
import { type Catalog, type Health, type ReleaseLog } from './lib/types';

export type Route =
  | { page: 'board'; id: string }
  | { page: 'metrics' }
  | { page: 'metric'; name: string }
  | { page: 'releases' }
  | { page: 'evals' }
  | { page: 'admin' };

function parseRoute(hash: string): Route | null {
  let m: RegExpMatchArray | null;
  if ((m = hash.match(/^#\/b\/([a-z0-9_]+)$/))) return { page: 'board', id: m[1]! };
  if ((m = hash.match(/^#\/m\/(.+)$/))) return { page: 'metric', name: decodeURIComponent(m[1]!) };
  if (hash === '#/metrics') return { page: 'metrics' };
  if (hash === '#/releases') return { page: 'releases' };
  if (hash === '#/evals') return { page: 'evals' };
  if (hash === '#/admin') return { page: 'admin' };
  return null;
}

export function routeHash(r: Route): string {
  if (r.page === 'board') return `#/b/${r.id}`;
  if (r.page === 'metric') return `#/m/${encodeURIComponent(r.name)}`;
  if (r.page === 'releases' || r.page === 'evals' || r.page === 'admin') return `#/${r.page}`;
  return '#/metrics';
}

interface AppState {
  lang: Lang;
  setLang: (l: Lang) => void;
  tr: (key: DictKey, vars?: Record<string, string | number>) => string;
  dark: boolean;
  toggleTheme: () => void;
  days: number;
  setDays: (d: number) => void;
  catalog: Catalog | null;
  health: Health | null;
  /** null while loading or when the server keeps no release log. */
  releases: ReleaseLog | null;
  setReleases: (log: ReleaseLog) => void;
  /** Reload health, catalog and release log after the configuration changed. */
  refresh: () => Promise<void>;
  route: Route | null;
  go: (r: Route) => void;
  loadError: string | null;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => initialLang(localStorage, navigator.language));
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [days, setDays] = useState(7);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [releases, setReleases] = useState<ReleaseLog | null>(null);
  const [hash, setHash] = useState(location.hash);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refresh = useCallback(
    () =>
      Promise.all([
        getJson<Health>('/healthz'),
        getJson<Catalog>('/boards').catch(() => null),
        getJson<ReleaseLog>('/releases').catch(() => null),
      ])
        .then(([h, c, rl]) => {
          setHealth(h);
          setCatalog(c);
          setReleases(rl);
          setLoadError(null);
        })
        .catch((e: Error) => setLoadError(e.message)),
    []
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('whydid.theme', next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const route = useMemo<Route | null>(() => {
    const r = parseRoute(hash);
    if (r) return r;
    if (catalog?.boards[0]) return { page: 'board', id: catalog.boards[0].id };
    return health ? { page: 'metrics' } : null;
  }, [hash, catalog, health]);

  const value = useMemo<AppState>(
    () => ({
      lang,
      setLang,
      tr: (key, vars) => t(lang, key, vars),
      dark,
      toggleTheme,
      days,
      setDays,
      catalog,
      health,
      releases,
      setReleases,
      refresh,
      route,
      go: (r) => {
        location.hash = routeHash(r);
      },
      loadError,
    }),
    [lang, setLang, dark, toggleTheme, days, catalog, health, releases, refresh, route, loadError]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
