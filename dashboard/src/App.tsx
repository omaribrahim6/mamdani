import { lazy, Suspense, useEffect, useState } from 'react';
import { CityProvider } from './lib/city';
import { useAuth0 } from '@auth0/auth0-react';
import { isAdmin, navigate, pathOf, usePage, usePath } from './lib/router';
import { Checking, Login } from './auth/Login';
import { Sidebar, Topbar } from './components/Shell';
import { TipLayer } from './components/ui';
import { Toasts } from './components/Toasts';
import { IssueDrawer } from './components/IssueDrawer';
import { Palette } from './components/Palette';
import { Dock } from './mamdani/Dock';
import { Dive } from './mamdani/Dive';
import { CommandPage } from './pages/Command';

const MapPage = lazy(() => import('./pages/MapPage'));
const QueuePage = lazy(() => import('./pages/Queue'));
const AnalyticsPage = lazy(() => import('./pages/Analytics'));
const BriefPage = lazy(() => import('./pages/Brief'));

// "/" is the sign-in page; the dashboard lives under /admin/. Signed in and on "/"? Straight to
// /admin/. Not signed in and on an /admin/ link? Back to "/", and after signing in you land on
// the page you asked for.
export function App() {
  const { isLoading, isAuthenticated, error } = useAuth0();
  const path = usePath();
  const admin = isAdmin(path);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated && !admin) navigate(pathOf('command'), true);
    if (!isAuthenticated && path !== '/') {
      if (admin) sessionStorage.setItem('mamdani-return', path);
      navigate('/', true);
    }
  }, [isLoading, isAuthenticated, admin, path]);

  if (isLoading) return <Checking />;
  if (!isAuthenticated) {
    if (path !== '/') return <Checking label="Taking you to sign in…" />;
    const returnTo = (() => {
      try {
        return sessionStorage.getItem('mamdani-return') ?? pathOf('command');
      } catch {
        return pathOf('command');
      }
    })();
    return <Login returnTo={returnTo} error={error ? `Sign-in didn’t complete: ${error.message}` : undefined} />;
  }
  if (!admin) return <Checking label="Opening Command…" />;
  return <Dashboard />;
}

export function Dashboard() {
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
      <Dive />
      <TipLayer />
    </CityProvider>
  );
}
