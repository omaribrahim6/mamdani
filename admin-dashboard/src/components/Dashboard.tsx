import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { ChevronRight, LogOut, X } from 'lucide-react';
import type { Status } from '../data/api';
import { category } from '../data/categories';
import { useCity } from '../data/useCity';
import { useStages } from '../gl/GLProvider';
import { useLang, type Key } from '../i18n';
import { BriefingCard } from './BriefingCard';
import { CommandTable } from './CommandTable';
import { GcHeader, GcFooter } from './GcChrome';
import { QueueRow } from './QueueRow';
import { ReportDetail } from './ReportDetail';

type Filter = 'open' | 'urgent' | 'resolved' | 'all';
const FILTER_KEY: Record<Filter, Key> = { open: 'open', urgent: 'urgent', resolved: 'resolved', all: 'all' };

export function Dashboard() {
  const { user, logout } = useAuth0();
  const { fx } = useStages();
  const { t } = useLang();
  const { issues, stats, live, merges, changeStatus, simulateConfirm } = useCity();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [cursor, setCursor] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const rows = useRef(new Map<number, HTMLElement>());
  const seenMerge = useRef(0);

  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);

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

  // a duplicate report flies from the city into its ticket
  useEffect(() => {
    if (!fx) return;
    for (const m of merges) {
      if (m.at <= seenMerge.current) continue;
      seenMerge.current = m.at;
      const el = rows.current.get(m.id) ?? document.querySelector<HTMLElement>(`[data-reports-target="${m.id}"]`);
      const issue = issues.find((i) => i.id === m.id);
      if (!el || !issue) continue;
      const src = document.querySelector('.twin-host')?.getBoundingClientRect();
      fx.burst({ x: src ? src.left + src.width * 0.5 : 200, y: src ? src.top + src.height * 0.5 : 200 }, el, category(issue.category).color);
    }
  }, [merges, fx, issues]);

  useEffect(() => {
    if (!selected) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [selected]);

  // resolving closes the ticket, then its row burns away before it moves to Resolved
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
      const el = rows.current.get(pendingBurn.id);
      const { id, status, note } = pendingBurn;
      setPendingBurn(null);
      if (el) { el.scrollIntoView({ block: 'nearest' }); fx.burn(el, () => void changeStatus(id, status, note)); }
      else void changeStatus(id, status, note);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingBurn, fx, changeStatus]);

  const open = issues.filter((i) => i.status !== 'resolved');
  const urgentCount = open.filter((i) => i.priority >= 70 || i.accessibility.impact === 'critical').length;

  return (
    <div className="gc-page">
      <GcHeader>
        <div className={`feed-state${live ? ' is-live' : ''}`}><i className="live-dot" />{live ? t('live') : t('offline')}</div>
        <div className="operator">
          {user?.picture ? <img src={user.picture} alt="" /> : <span aria-hidden="true">{user?.name?.charAt(0) ?? 'A'}</span>}
          <span className="operator-name">{user?.name ?? 'City operator'}</span>
          <button type="button" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}><LogOut size={15} aria-hidden="true" /><span>{t('signOut')}</span></button>
        </div>
      </GcHeader>

      <main className="ops" id="main">
        <div className="ops-top">
          <div>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <ol><li>{t('crumbOps')}</li><li aria-hidden="true"><ChevronRight size={13} /></li><li aria-current={selected ? undefined : 'page'}>{t('title')}</li>{selected && <><li aria-hidden="true"><ChevronRight size={13} /></li><li aria-current="page">OTT-{String(selected.id).padStart(4, '0')}</li></>}</ol>
            </nav>
            <h1 className="gc-h1">{t('title')}</h1>
          </div>
          <dl className="kpis">
            <div><dt>{t('open')}</dt><dd>{open.length}</dd></div>
            <div className="kpi-danger"><dt>{t('urgent')}</dt><dd>{urgentCount}</dd></div>
            <div className="kpi-success"><dt>{t('fixedToday')}</dt><dd>{stats?.resolvedToday ?? 0}</dd></div>
            <div><dt>{t('medianFix')}</dt><dd>{stats?.medianHoursToFix ? `${Math.round(stats.medianHoursToFix)} h` : '—'}</dd></div>
            <div className="kpi-warning"><dt>{t('barriers')}</dt><dd>{stats?.accessibilityOpen ?? 0}</dd></div>
          </dl>
        </div>

        <div className={`ops-grid${selected ? ' detail-open' : ''}`}>
          <CommandTable
            issues={issues}
            stats={stats}
            selectedId={selectedId}
            cursor={cursor}
            onCursor={setCursor}
            onPick={(ids) => { setPicked(ids.length ? ids : null); if (ids.length === 1) setSelectedId(ids[0]); }}
          />

          <div className="side">
            {selected ? (
              <ReportDetail issue={selected} now={now} onClose={() => setSelectedId(null)} onStatus={onStatus} onSimulateConfirm={() => simulateConfirm(selected.id)} />
            ) : (
              <>
                <BriefingCard issues={issues} stats={stats} now={now} />
                <div className="queue">
                  <div className="queue-head">
                    <div className="chips" role="tablist" aria-label="Filter">
                      {(['open', 'urgent', 'resolved', 'all'] as Filter[]).map((f) => (
                        <button key={f} type="button" role="tab" aria-selected={!picked && filter === f} className={!picked && filter === f ? 'chip active' : 'chip'} onClick={() => { setPicked(null); setFilter(f); }}>{t(FILTER_KEY[f])}</button>
                      ))}
                    </div>
                    {picked && <button type="button" className="chip picked" onClick={() => setPicked(null)}>{picked.length} {t('on')} <X size={12} aria-hidden="true" /></button>}
                  </div>
                  <div className="queue-scroll" ref={(n) => fx?.setClip(n)}>
                    <table className="gc-table">
                      <caption className="sr-only">{t('queueCaption')}</caption>
                      <thead><tr><th scope="col">{t('colId')}</th><th scope="col">{t('colIssue')}</th><th scope="col" className="num">{t('colResidents')}</th><th scope="col" className="num">{t('colPriority')}</th><th scope="col">{t('colStatus')}</th></tr></thead>
                      <tbody>
                        {visible.map((issue) => (
                          <QueueRow key={issue.id} issue={issue} now={at} selected={issue.id === selectedId} onSelect={() => setSelectedId(issue.id)}
                            rowRef={(n) => { if (n) rows.current.set(issue.id, n); else rows.current.delete(issue.id); }} />
                        ))}
                      </tbody>
                    </table>
                    {visible.length === 0 && <p className="queue-empty">{t('empty')}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
      <GcFooter />
    </div>
  );
}
