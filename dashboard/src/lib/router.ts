import { useSyncExternalStore, type MouseEvent } from 'react';

// Real paths, no hash: "/" is the sign-in page, and the dashboard lives under /admin/.
//   /admin/           Command        /admin/queue       Work queue
//   /admin/map        Live map       /admin/analytics   Analytics
//   /admin/brief      Today's brief
// Vite's dev server and Vercel (vercel.json) both serve index.html for any of these.

export type Page = 'command' | 'map' | 'queue' | 'analytics' | 'brief';

const PATHS: Record<Page, string> = {
  command: '/admin/',
  map: '/admin/map',
  queue: '/admin/queue',
  analytics: '/admin/analytics',
  brief: '/admin/brief',
};

export const pathOf = (p: Page) => PATHS[p];
export const isAdmin = (path: string) => path === '/admin' || path.startsWith('/admin/');

function pageOf(path: string): Page {
  const p = path.replace(/\/+$/, '') || '/';
  return ((Object.keys(PATHS) as Page[]).find((k) => PATHS[k].replace(/\/+$/, '') === p) ?? 'command') as Page;
}

const subs = new Set<() => void>();
addEventListener('popstate', () => subs.forEach((f) => f()));

export function navigate(path: string, replace = false) {
  if (location.pathname + location.search === path) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  subs.forEach((f) => f());
}

export const go = (p: Page) => navigate(PATHS[p]);

export function usePath() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => location.pathname,
  );
}

export const usePage = () => pageOf(usePath());

/** onClick for an <a href="/admin/..."> so it navigates in place (ctrl/cmd-click still opens a tab). */
export function follow(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute('href') ?? '/admin/');
}
