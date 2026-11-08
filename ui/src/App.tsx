/** Routes: boards from the catalog, the Metrics overview, a metric drill-down, release notes and the eval set. */
import { AgentProvider } from './agent/agent-state';
import { AgentRail } from './agent/AgentRail';
import { AppProvider, useApp } from './app-state';
import { Shell } from './components/Shell';
import { Empty } from './components/ui';
import { loc } from './lib/i18n';
import { AdminPage } from './pages/admin/AdminPage';
import { BoardPage } from './pages/BoardPage';
import { EvalsPage } from './pages/EvalsPage';
import { MetricDetail } from './pages/MetricDetail';
import { MetricsPage } from './pages/MetricsPage';
import { ReleasesPage } from './pages/ReleasesPage';

function Routes() {
  const { route, catalog, health, lang, tr, loadError } = useApp();
  if (loadError) {
    return (
      <Shell title="whydid">
        <Empty>{tr('common.error', { msg: loadError })}</Empty>
      </Shell>
    );
  }
  if (!route) {
    return (
      <Shell title="whydid">
        <Empty>…</Empty>
      </Shell>
    );
  }
  if (route.page === 'board' && catalog) {
    const board = catalog.boards.find((b) => b.id === route.id);
    if (board) {
      return (
        <Shell title={loc(board.title, lang)} subtitle={loc(board.description, lang)} rail={<AgentRail />}>
          <BoardPage key={board.id} board={board} cards={catalog.cards.filter((c) => c.board === board.id)} />
        </Shell>
      );
    }
  }
  if (route.page === 'releases') {
    return (
      <Shell title={tr('rel.title')} subtitle={tr('rel.sub')} rail={<AgentRail />}>
        <ReleasesPage />
      </Shell>
    );
  }
  if (route.page === 'admin') {
    return (
      <Shell title={tr('nav.admin')} subtitle={tr('admin.sub')}>
        <AdminPage />
      </Shell>
    );
  }
  if (route.page === 'evals') {
    return (
      <Shell title={tr('eval.title')} subtitle={tr('eval.sub')}>
        <EvalsPage />
      </Shell>
    );
  }
  if (route.page === 'metric' && health?.metrics.some((m) => m.name === route.name)) {
    const m = health.metrics.find((x) => x.name === route.name)!;
    return (
      <Shell title={loc(m.label, lang)} subtitle={tr('metrics.title')} rail={<AgentRail />}>
        <MetricDetail metric={m} />
      </Shell>
    );
  }
  return (
    <Shell title={tr('metrics.title')} subtitle={health ? tr('metrics.sub', { table: health.table }) : undefined} rail={<AgentRail />}>
      <MetricsPage />
    </Shell>
  );
}

export function App() {
  return (
    <AppProvider>
      <AgentProvider>
        <Routes />
      </AgentProvider>
    </AppProvider>
  );
}
