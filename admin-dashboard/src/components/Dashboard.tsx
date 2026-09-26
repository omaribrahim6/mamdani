import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { FileText, LogOut, Radio, X } from 'lucide-react';
import type { Status } from '../data/api';
import { category } from '../data/categories';
import { useCity } from '../data/useCity';
import { useStages } from '../gl/GLProvider';
import { BrandMark } from './BrandMark';
import { CommandTable } from './CommandTable';
import { ReportCard } from './ReportCard';
import { ReportDetail } from './ReportDetail';

type Filter = 'open' | 'urgent' | 'resolved' | 'all';

export function Dashboard() {
  const { user, logout } = useAuth0();
  const { fx } = useStages();
  const { issues, stats, live, merges, changeStatus, simulateConfirm } = useCity();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [cursor, setCursor] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const cards = useRef(new Map<number, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const seenMerge = useRef(0);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { fx?.setClip(listRef.current); }, [fx]);

  const at = cursor ?? now;
  const visible = useMemo(() => {
    let list = issues.filter((i) => i.firstReportedAt <= at);
    if (picked) list = list.filter((i) => picked.includes(i.id));
    else if (filter === 'open') list = list.filter((i) => i.status !== 'resolved');
    else if (filter === 'urgent') list = list.filter((i) => i.status !== 'resolved' && (i.priority >= 70 || i.accessibility.impact === 'critical'));
    else if (filter === 'resolved') list = list.filter((i) => i.status === 'resolved');
    return [...list].sort((a, b) => (a.status === 'resolved' ? 1 : 0) - (b.status === 'resolved' ? 1 : 0) || b.priority - a.priority);
  }, [issues, picked, filter, at]);

  const selected = issues.find((i) => i.id === selectedId) ?? null;

  // duplicate reports fly into their ticket
  useEffect(() => {
    if (!fx) return;
    for (const m of merges) {
      if (m.at <= seenMerge.current) continue;
      seenMerge.current = m.at;
      const el = cards.current.get(m.id) ?? document.querySelector<HTMLElement>(`[data-reports-target="${m.id}"]`);
      const issue = issues.find((i) => i.id === m.id);
      if (!el || !issue) continue;
      const card = el;
      const src = document.querySelector('.table-host')?.getBoundingClientRect();
      fx.burst({ x: src ? src.left + src.width * 0.5 : 200, y: src ? src.top + src.height * 0.45 : 200 }, card, category(issue.category).color);
    }
  }, [merges, fx, issues]);

  useEffect(() => {
    if (!selected) return;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

  // resolving closes the ticket, then the card burns away in the queue before it moves
  const [pendingBurn, setPendingBurn] = useState<{ id: number; status: Status; note: string } | null>(null);
  const onStatus = (status: Status, note: string, burn: boolean) => {
    if (!selected) return;
    if (burn && fx) setPendingBurn({ id: selected.id, status, note });
    else void changeStatus(selected.id, status, note);
    if (burn) setSelectedId(null);
  };
  useEffect(() => {
    if (!pendingBurn || !fx) return;
    const raf = requestAnimationFrame(() => {
      const el = cards.current.get(pendingBurn.id);
      const { id, status, note } = pendingBurn;
      setPendingBurn(null);
      if (el) { el.scrollIntoView({ block: 'nearest' }); fx.burn(el, () => void changeStatus(id, status, note)); }
      else void changeStatus(id, status, note);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingBurn, fx, changeStatus]);

  const openCount = issues.filter((i) => i.status !== 'resolved').length;
  const urgentCount = issues.filter((i) => i.status !== 'resolved' && (i.priority >= 70 || i.accessibility.impact === 'critical')).length;
  const dateLabel = new Date(now).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <main className="console-canvas">
      <div className={`console-shell${selected ? ' detail-open' : ''}`}>
        <aside className="console-sidebar">
          <BrandMark />
          <nav aria-label="Primary navigation">
            <a href="#reports" className="console-nav-active"><FileText size={18} /><span>Reports</span><b>{openCount}</b></a>
          </nav>
          <div className={`feed-state${live ? ' is-live' : ''}`}><Radio size={14} />{live ? 'Live from the city record' : 'Offline snapshot'}</div>
          <div className="operator-block">
            <div className="operator-identity">
              {user?.picture ? <img src={user.picture} alt="" /> : <span>{user?.name?.charAt(0) ?? 'A'}</span>}
              <div><strong>{user?.name ?? 'City operator'}</strong><small>{user?.email ?? 'Operations staff'}</small></div>
            </div>
            <button type="button" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}><LogOut size={16} /><span>Sign out</span></button>
          </div>
        </aside>

        <section className="ops-workspace" id="reports">
          <header className="ops-header">
            <div><p>{dateLabel}</p><h1>City reports</h1></div>
            <dl className="kpis">
              <div><dt>Open</dt><dd>{openCount}</dd></div>
              <div className="kpi-hot"><dt>Urgent</dt><dd>{urgentCount}</dd></div>
              <div><dt>Fixed today</dt><dd>{stats?.resolvedToday ?? 0}</dd></div>
              <div><dt>Median fix</dt><dd>{stats?.medianHoursToFix ? `${Math.round(stats.medianHoursToFix)} h` : '—'}</dd></div>
              <div><dt>Access barriers</dt><dd>{stats?.accessibilityOpen ?? 0}</dd></div>
            </dl>
          </header>

          <div className="ops-grid">
            <CommandTable
              issues={issues}
              stats={stats}
              selectedId={selectedId}
              cursor={cursor}
              onCursor={setCursor}
              onPick={(ids) => { setPicked(ids.length ? ids : null); if (ids.length === 1) setSelectedId(ids[0]); }}
            />

            <div className="queue-pane">
              {selected ? (
                <ReportDetail
                  issue={selected}
                  now={now}
                  onClose={() => setSelectedId(null)}
                  onStatus={onStatus}
                  onSimulateConfirm={() => simulateConfirm(selected.id)}
                />
              ) : (
                <>
                  <div className="queue-head">
                    <div className="queue-filters" role="tablist" aria-label="Filter the queue">
                      {(['open', 'urgent', 'resolved', 'all'] as Filter[]).map((f) => (
                        <button key={f} type="button" role="tab" aria-selected={!picked && filter === f} className={!picked && filter === f ? 'active' : ''} onClick={() => { setPicked(null); setFilter(f); }}>{f}</button>
                      ))}
                    </div>
                    {picked && <button type="button" className="picked-chip" onClick={() => setPicked(null)}>{picked.length} on this block <X size={13} /></button>}
                  </div>
                  <div className="reports-list" ref={(n) => { listRef.current = n; fx?.setClip(n); }} aria-label="Ticket queue">
                    {visible.map((issue) => (
                      <ReportCard
                        key={issue.id}
                        issue={issue}
                        now={at}
                        selected={issue.id === selectedId}
                        onSelect={() => setSelectedId(issue.id)}
                        cardRef={(n) => { if (n) cards.current.set(issue.id, n); else cards.current.delete(issue.id); }}
                      />
                    ))}
                    {visible.length === 0 && <p className="queue-empty">Nothing here. The city is quiet.</p>}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
