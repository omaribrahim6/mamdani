import { lazy, Suspense, useEffect, useState } from 'react';
import { CityProvider } from './lib/city';
import { usePage } from './lib/router';
import { Sidebar, Topbar } from './components/Shell';
import { TipLayer } from './components/ui';
import { Toasts } from './components/Toasts';
import { IssueDrawer } from './components/IssueDrawer';
import { Palette } from './components/Palette';
import { Dock } from './mamdani/Dock';
import { CommandPage } from './pages/Command';

const MapPage = lazy(() => import('./pages/MapPage'));
const QueuePage = lazy(() => import('./pages/Queue'));
const AnalyticsPage = lazy(() => import('./pages/Analytics'));
const BriefPage = lazy(() => import('./pages/Brief'));

export function App() {
  const page = usePage();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.title = `${{ command: 'Command', map: 'Live map', queue: 'Work queue', analytics: 'Analytics', brief: 'Today’s brief' }[page]} · Mamdani`;
    scrollTo({ top: 0 });
  }, [page]);

  return (
    <CityProvider>
      <div className="shell">
        <Sidebar page={page} />
        <main className="main">
          <Topbar onSearch={() => setPalette(true)} />
          <Suspense fallback={<div className="page" />}>
            {page === 'command' && <CommandPage />}
            {page === 'map' && <MapPage />}
            {page === 'queue' && <QueuePage />}
            {page === 'analytics' && <AnalyticsPage />}
            {page === 'brief' && <BriefPage />}
          </Suspense>
        </main>
      </div>
      <IssueDrawer />
      <Palette open={palette} onClose={() => setPalette(false)} />
      <Toasts />
      <Dock />
      <TipLayer />
    </CityProvider>
  );
}
