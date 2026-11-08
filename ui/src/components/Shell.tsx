/** App shell: collapsible grouped sidebar, inset content panel with a top bar. */
import { BarChart3, Bot, Languages, LayoutDashboard, Moon, PanelLeft, Sparkles, Sun, Activity, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useApp, type Route } from '../app-state';
import { useAgent } from '../agent/agent-state';
import { loc } from '../lib/i18n';
import { Button, cn, Select } from './ui';

const BOARD_ICONS: Record<string, LucideIcon> = { model_output: Bot, semantic: Activity };

function NavItem({ icon: Icon, label, active, collapsed, onClick }: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={collapsed ? label : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg p-2 text-[13px] transition cursor-pointer',
        collapsed && 'justify-center',
        active ? 'bg-popover font-medium text-foreground shadow-emboss-sm' : 'text-foreground/80 hover:bg-sidebar-accent'
      )}
    >
      <Icon size={16} strokeWidth={2} className={active ? 'text-primary' : ''} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { catalog, route, go, lang, tr, dark, toggleTheme, setLang, health } = useApp();
  const isActive = (r: Route) =>
    route?.page === r.page && (r.page !== 'board' || (route.page === 'board' && route.id === r.id));
  return (
    <aside className={cn('flex shrink-0 flex-col py-3 transition-[width] duration-200', collapsed ? 'w-12 px-1.5' : 'w-64 px-3')}>
      <div className={cn('mb-4 flex items-center gap-2.5', collapsed ? 'justify-center' : 'px-1')}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-[15px] font-bold text-background shadow-emboss-sm">w</span>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight">whydid</div>
            <div className="text-[12.5px] font-medium text-muted-foreground">{tr('app.tagline')}</div>
          </div>
        )}
      </div>
      {!collapsed && <div className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">{tr('nav.boards')}</div>}
      <nav className="flex flex-col gap-0.5">
        {catalog?.boards.map((b) => (
          <NavItem
            key={b.id}
            icon={BOARD_ICONS[b.id] ?? BOARD_ICONS[b.source_kind] ?? LayoutDashboard}
            label={loc(b.title, lang)}
            active={isActive({ page: 'board', id: b.id })}
            collapsed={collapsed}
            onClick={() => go({ page: 'board', id: b.id })}
          />
        ))}
      </nav>
      {health && (
        <>
          {!collapsed && <div className="mt-5 mb-1 px-2 text-[11px] font-medium text-muted-foreground">{tr('nav.analysis')}</div>}
          <nav className={cn('flex flex-col gap-0.5', collapsed && 'mt-4')}>
            <NavItem
              icon={BarChart3}
              label={tr('nav.metrics')}
              active={route?.page === 'metrics' || route?.page === 'metric'}
              collapsed={collapsed}
              onClick={() => go({ page: 'metrics' })}
            />
          </nav>
        </>
      )}
      <div className="mt-auto flex flex-col gap-0.5">
        <NavItem icon={dark ? Sun : Moon} label={tr('nav.theme')} active={false} collapsed={collapsed} onClick={toggleTheme} />
        <NavItem icon={Languages} label={tr('nav.language')} active={false} collapsed={collapsed} onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} />
      </div>
    </aside>
  );
}

function TopBar({ title, subtitle, onToggleSidebar }: { title: string; subtitle?: string; onToggleSidebar: () => void }) {
  const { days, setDays, tr, dark, toggleTheme, lang, setLang, route } = useApp();
  const agent = useAgent();
  const windowed = route?.page === 'board';
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <Button variant="ghost" size="icon" className="size-9" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <PanelLeft size={17} />
      </Button>
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-[15px] font-[680] tracking-[-0.01em]">{title}</h1>
        {subtitle && <span className="hidden truncate text-[11.5px] text-muted-foreground md:inline">{subtitle}</span>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {windowed && (
          <Select
            className="w-[128px]"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[7, 14, 30].map((n) => ({ value: String(n), label: tr('top.window', { n }) }))}
          />
        )}
        <Button variant="outline" size="icon" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title={tr('nav.language')}>
          <Languages size={15} />
        </Button>
        <Button variant="outline" size="icon" onClick={toggleTheme} title={tr('nav.theme')}>
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </Button>
        {agent.status && (
          <Button
            variant={agent.open ? 'primary' : 'outline'}
            size="icon"
            className="size-9"
            onClick={() => agent.setOpen(!agent.open)}
            title={tr('top.agent')}
          >
            <Sparkles size={16} />
          </Button>
        )}
      </div>
    </header>
  );
}

export function Shell({ title, subtitle, children, rail }: { title: string; subtitle?: string; children: ReactNode; rail?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('whydid.sidebar') === 'collapsed');
  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem('whydid.sidebar', c ? 'open' : 'collapsed');
      return !c;
    });
  };
  return (
    <div className="flex h-full bg-sidebar">
      <Sidebar collapsed={collapsed} />
      <div className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-emboss-lg">
        <TopBar title={title} subtitle={subtitle} onToggleSidebar={toggle} />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto p-4">{children}</main>
          {rail}
        </div>
      </div>
    </div>
  );
}
