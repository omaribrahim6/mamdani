import { lazy, Suspense, useEffect, useState } from 'react';
import { CityProvider } from './lib/city';
import { isAdmin, pathOf, usePage, usePath } from './lib/router';
import { Login } from './auth/Login';
import { Feed } from './social/Feed';
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

// "/" is the front door; the dashboard lives under /admin/. There's no sign-in — clicking through
// on "/" opens the portal read-only (AI is off), and any /admin/ link goes straight to Command.
export function App() {
  const path = usePath();
  const admin = isAdmin(path);

  // Mamdani Social: public — /feed here, or the whole site on its own domain
  if (path.startsWith('/feed') || location.hostname.startsWith('mamdani-social')) return <Feed />;
  if (!admin) return <Login returnTo={pathOf('command')} />;
  return <Dashboard />;
}

export function Dashboard({ children }: { children?: React.ReactNode }) {
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
      {children}
      <TipLayer />
    </CityProvider>
  );
}
