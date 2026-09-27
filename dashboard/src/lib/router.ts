import { useEffect, useState } from 'react';

export type Page = 'command' | 'map' | 'queue' | 'analytics' | 'brief';
const PAGES: Page[] = ['command', 'map', 'queue', 'analytics', 'brief'];

function read(): Page {
  const p = location.hash.replace(/^#\/?/, '').split('?')[0] as Page;
  return PAGES.includes(p) ? p : 'command';
}

export const go = (p: Page) => {
  if (read() !== p) location.hash = `/${p}`;
};

export function usePage() {
  const [page, set] = useState<Page>(read);
  useEffect(() => {
    const on = () => set(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return page;
}
