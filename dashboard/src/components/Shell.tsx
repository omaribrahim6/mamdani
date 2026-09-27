import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ArrowUpRight, Bell, ChartNoAxesColumn, Download, LayoutGrid, ListChecks, Map as MapIcon, Moon, Newspaper, Search, Sparkles, Sun } from 'lucide-react';
import { useCity } from '../lib/city';
import { ago, category, STATUS_SHORT } from '../lib/format';
import { go, type Page } from '../lib/router';
import { sla } from '@shared/sla';

const NAV: Array<{ page: Page; label: string; icon: typeof LayoutGrid }> = [
  { page: 'command', label: 'Command', icon: LayoutGrid },
  { page: 'map', label: 'Live map', icon: MapIcon },
  { page: 'queue', label: 'Work queue', icon: ListChecks },
  { page: 'analytics', label: 'Analytics', icon: ChartNoAxesColumn },
];

export function Sidebar({ page }: { page: Page }) {
  const { issues, fresh, brief, briefState, storeKind, lastSync, offline } = useCity();
  const root = useRef<HTMLElement>(null);
  const open = issues.filter((i) => i.status !== 'resolved').length;
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  useGSAP(
    () => {
      gsap.from('.side-anim', { y: 14, opacity: 0, duration: 0.7, stagger: 0.06, ease: 'power3.out', delay: 0.05 });
    },
    { scope: root },
  );

  return (
    <aside className="side" ref={root}>
      <div className="brand side-anim">
        <img src="/mamdani-face.png" alt="" className="brand-face" />
        <div>
          <div className="brand-word">MAMDANI</div>
          <div className="brand-sub">Command · City of Ottawa</div>
        </div>
      </div>

      <div className="user side-anim">
        <div className="user-av">OS</div>
        <div className="user-meta">
          <b>Operations desk</b>
          <span>Public Works & Environmental</span>
        </div>
        <button className="icon-btn ghost user-bell" aria-label={`${fresh.size} new reports`} onClick={() => go('queue')}>
          <Bell size={16} />
          {fresh.size > 0 && <i className="bell-dot">{fresh.size}</i>}
        </button>
      </div>

      <nav className="nav side-anim">
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <a key={p} href={`#/${p}`} className={`nav-tile ${page === p ? 'on' : ''} ${p === 'command' ? 'wide' : ''}`}>
            <Icon size={p === 'command' ? 20 : 18} strokeWidth={1.7} />
            <span>{label}</span>
            {p === 'queue' && <em className="nav-count num">{open}</em>}
          </a>
        ))}
      </nav>

      <div className="side-fill" />

      <a href="#/brief" className={`brief-teaser side-anim ${page === 'brief' ? 'on' : ''}`}>
        <div className="brief-grain" />
        <div className="brief-top">
          <span className="brief-tag">
            <Sparkles size={13} /> Today’s brief
          </span>
          <ArrowUpRight size={18} />
        </div>
        {brief ? (
          <>
            <p className="brief-head">{brief.headline}</p>
            <p className="brief-meta">Written by Gemini · {ago(brief.generatedAt)}</p>
          </>
        ) : (
          <>
            <p className="brief-head">{briefState === 'error' ? 'Brief unavailable right now' : 'Mamdani is writing today’s brief…'}</p>
            <div className="brief-bar">
              <i />
            </div>
          </>
        )}
      </a>

      <div className="side-foot side-anim">
        <span className={offline ? 'foot-dot off' : 'live-dot'} />
        <span>
          {offline ? 'Reconnecting…' : `Live · ${storeKind === 'tiger' ? 'Tiger Data' : storeKind === 'memory' ? 'Demo city' : '…'}`}
        </span>
        <span className="muted">{lastSync ? `synced ${ago(lastSync)}` : ''}</span>
      </div>
    </aside>
  );
}

export function Topbar({ onSearch }: { onSearch: () => void }) {
  const { issues } = useCity();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme as 'dark') || 'light');

  const flip = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('mamdani-theme', next);
    } catch {
      /* private window */
    }
  };

  const exportCsv = () => {
    const now = Date.now();
    const head = ['work_order', 'type', 'title', 'address', 'department', 'status', 'priority', 'severity', 'safety_risk', 'accessibility', 'reports', 'first_reported', 'service_target'];
    const rows = issues.map((i) => [
      i.id,
      category(i.category).label,
      i.title,
      i.address,
      i.department,
      STATUS_SHORT[i.status],
      Math.round(i.priority),
      i.severity,
      i.safetyRisk,
      i.accessibility.impact,
      i.reports,
      new Date(i.firstReportedAt).toISOString(),
      sla(i, now).state,
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `mamdani-work-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <header className="top">
      <button className="search" onClick={onSearch}>
        <Search size={16} />
        <span>Search work orders, streets, or describe a problem…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="top-actions">
        <button className="icon-btn" onClick={flip} aria-label="Toggle theme">
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <button className="btn soft" onClick={exportCsv}>
          <Download size={16} /> Export
        </button>
        <a className="btn primary" href="#/brief">
          <Newspaper size={16} /> Today’s brief
        </a>
      </div>
    </header>
  );
}
