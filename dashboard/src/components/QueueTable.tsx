import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowUpDown, Check, ChevronRight, Users } from 'lucide-react';
import type { Issue, Status } from '@shared/types';
import { sla } from '@shared/sla';
import { useCity } from '../lib/city';
import { ago, category, hood, NEXT_STATUS, STATUS_SHORT, street } from '../lib/format';
import { CategoryIcon, PriorityMeter, SlaChip, StatusLabel } from './ui';
import './queue.css';

// The work queue: every issue, filterable by status, sortable, with the next step one click away.
// The same table sits on the Command page (top of the queue) and the Queue page (all of it,
// with bulk actions).

type Sort = 'priority' | 'newest' | 'target' | 'reports';
type Tab = 'open' | Status | 'late';

export function QueueTable({ issues, limit, selectable = false, query = '', title }: { issues: Issue[]; limit?: number; selectable?: boolean; query?: string; title?: string }) {
  const city = useCity();
  const [tab, setTab] = useState<Tab>('open');
  const [sort, setSort] = useState<Sort>('priority');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const body = useRef<HTMLTableSectionElement>(null);
  const now = Date.now();

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { open: 0, new: 0, assigned: 0, in_progress: 0, resolved: 0, late: 0 };
    for (const i of issues) {
      c[i.status]++;
      if (i.status !== 'resolved') c.open++;
      if (i.status !== 'resolved' && sla(i, now).state === 'breached') c.late++;
    }
    return c;
  }, [issues, now]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = issues.filter((i) =>
      tab === 'open' ? i.status !== 'resolved' : tab === 'late' ? i.status !== 'resolved' && sla(i, now).state === 'breached' : i.status === tab,
    );
    if (q) list = list.filter((i) => `#${i.id} ${i.title} ${i.address} ${i.department} ${category(i.category).label}`.toLowerCase().includes(q));
    const by: Record<Sort, (a: Issue, b: Issue) => number> = {
      priority: (a, b) => b.priority - a.priority,
      newest: (a, b) => b.firstReportedAt - a.firstReportedAt,
      target: (a, b) => sla(a, now).left - sla(b, now).left,
      reports: (a, b) => b.reports - a.reports,
    };
    return [...list].sort(by[sort]).slice(0, limit ?? Infinity);
  }, [issues, tab, sort, query, limit, now]);

  useLayoutEffect(() => {
    if (!body.current) return;
    gsap.fromTo(body.current.querySelectorAll('tr'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.025, ease: 'power3.out' });
  }, [tab, sort, rows.length]);

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulk = (status: Status) => {
    void city.setStatus([...picked], status);
    setPicked(new Set());
  };

  const TABS: Array<[Tab, string]> = [
    ['open', 'All open'],
    ['new', STATUS_SHORT.new],
    ['assigned', STATUS_SHORT.assigned],
    ['in_progress', STATUS_SHORT.in_progress],
    ['late', 'Past target'],
    ['resolved', STATUS_SHORT.resolved],
  ];

  return (
    <div className="queue">
      <div className="queue-bar">
        {title && (
          <div className="queue-title">
            <h2>{title}</h2>
            <span className="chip num">{counts.open} open</span>
          </div>
        )}
        <div className="tabs">
          {TABS.map(([t, label]) => (
            <button key={t} className={`tab ${tab === t ? 'on' : ''} ${t === 'late' && counts.late ? 'tab-late' : ''}`} onClick={() => setTab(t)}>
              {label} <span className="count">{counts[t]}</span>
            </button>
          ))}
          <button
            className="icon-btn"
            style={{ height: 40, width: 40 }}
            title={`Sorted by ${sort}`}
            onClick={() => setSort((s) => (s === 'priority' ? 'target' : s === 'target' ? 'newest' : s === 'newest' ? 'reports' : 'priority'))}
          >
            <ArrowUpDown size={16} />
          </button>
          <span className="sort-label">by {{ priority: 'priority', target: 'time left', newest: 'newest', reports: 'most reported' }[sort]}</span>
        </div>
      </div>

      {selectable && picked.size > 0 && (
        <div className="bulk">
          <b>{picked.size} selected</b>
          <button className="btn small soft" onClick={() => bulk('assigned')}>
            <Users size={14} /> Assign crew
          </button>
          <button className="btn small soft" onClick={() => bulk('in_progress')}>
            Start work
          </button>
          <button className="btn small soft" onClick={() => bulk('resolved')}>
            <Check size={14} /> Mark fixed
          </button>
          <button
            className="btn small primary"
            onClick={() => {
              city.show([...picked], `Crew run · ${picked.size} stops`, 'route');
              location.hash = '/map';
            }}
          >
            Plan crew route
          </button>
          <button className="btn small" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="queue-scroll">
        <table className="qt">
          <thead>
            <tr>
              {selectable && <th className="qt-check" />}
              <th>Work order</th>
              <th>Issue</th>
              <th>Location</th>
              <th>Department</th>
              <th>Priority</th>
              <th>Service target</th>
              <th className="r">Reports</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody ref={body}>
            {rows.map((i) => {
              const next = NEXT_STATUS[i.status];
              return (
                <tr key={i.id} className={`${city.selectedId === i.id ? 'sel' : ''} ${city.fresh.has(i.id) ? 'fresh' : ''}`} onClick={() => city.open(i.id)}>
                  {selectable && (
                    <td className="qt-check" onClick={(e) => (e.stopPropagation(), toggle(i.id))}>
                      <span className={`check ${picked.has(i.id) ? 'on' : ''}`}>{picked.has(i.id) && <Check size={12} />}</span>
                    </td>
                  )}
                  <td className="mono qt-id">#{i.id}</td>
                  <td>
                    <div className="qt-issue">
                      <CategoryIcon id={i.category} />
                      <div>
                        <b>{i.title}</b>
                        <span>
                          {category(i.category).label} · {ago(i.firstReportedAt, now)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="qt-loc">
                      <b>{street(i.address)}</b>
                      <span>{hood(i.address)}</span>
                    </div>
                  </td>
                  <td className="qt-dept">{i.department.split(' — ')[0]}</td>
                  <td>
                    <PriorityMeter value={i.priority} />
                  </td>
                  <td>
                    <SlaChip issue={i} now={now} />
                  </td>
                  <td className="r num">{i.reports}</td>
                  <td>
                    <StatusLabel status={i.status} />
                  </td>
                  <td className="qt-act" onClick={(e) => e.stopPropagation()}>
                    {next && (
                      <button className="btn small soft" onClick={() => void city.setStatus([i.id], next.to)}>
                        {next.verb}
                      </button>
                    )}
                    <button className="icon-btn ghost" onClick={() => city.open(i.id)} aria-label="Open">
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Nothing here. Mamdani approves.</div>}
      </div>
    </div>
  );
}
