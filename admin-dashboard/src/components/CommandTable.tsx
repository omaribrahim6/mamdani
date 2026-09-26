import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiIssue, ApiStats } from '../data/api';
import { category } from '../data/categories';
import { clock, ticketId } from '../data/view';
import { CityTable } from '../gl/cityTable';
import { useStages } from '../gl/GLProvider';
import { Timeline } from '../gl/timeline';

interface Props {
  issues: ApiIssue[];
  stats: ApiStats | null;
  selectedId: number | null;
  cursor: number | null;
  onCursor: (ms: number | null) => void;
  onPick: (ids: number[]) => void;
}

export function CommandTable({ issues, stats, selectedId, cursor, onCursor, onPick }: Props) {
  const { back } = useStages();
  const tableHost = useRef<HTMLDivElement>(null);
  const lineHost = useRef<HTMLDivElement>(null);
  const table = useRef<CityTable | null>(null);
  const line = useRef<Timeline | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    if (!back || !tableHost.current || !lineHost.current) return;
    const t = new CityTable(tableHost.current, (ids) => pickRef.current(ids));
    let lastFocus = '';
    t.onFocus = (p) => {
      const k = p ? `${Math.round(p.x)},${Math.round(p.y)}` : '';
      if (k !== lastFocus) { lastFocus = k; setFocus(p); }
    };
    const l = new Timeline(lineHost.current);
    table.current = t;
    line.current = l;
    const offT = back.add(t), offL = back.add(l);
    return () => { offT(); offL(); table.current = null; line.current = null; };
  }, [back]);

  useEffect(() => { table.current?.setIssues(issues); }, [issues, back]);
  useEffect(() => { table.current?.setSelected(selectedId); }, [selectedId, back]);
  useEffect(() => { table.current?.setCursor(cursor); }, [cursor, back]);

  const hours = stats?.hourly ?? [];
  const t0 = hours[0]?.t ?? Date.now() - 48 * 3600_000;
  const t1 = (hours[hours.length - 1]?.t ?? Date.now()) + 3600_000;
  useEffect(() => { line.current?.setData(hours.map((h) => h.count)); }, [hours, back]);
  useEffect(() => {
    const x = cursor === null ? 1 : (cursor - t0) / (t1 - t0);
    line.current?.setCursor(Math.min(1, Math.max(0, x)));
  }, [cursor, t0, t1, back]);
  useEffect(() => { line.current?.setHover(hoverX ?? -1); }, [hoverX]);

  const selected = issues.find((i) => i.id === selectedId) ?? null;
  const open = issues.filter((i) => i.status !== 'resolved');
  const legend = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of open) seen.set(i.category, (seen.get(i.category) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [open]);

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
    setHoverX(x);
    if (e.buttons === 1) onCursor(x > 0.985 ? null : t0 + x * (t1 - t0));
  };

  return (
    <section className="command-table" aria-label="City table: open reports across downtown Ottawa">
      <div ref={tableHost} className="table-host">
        {!back && <div className="table-fallback">3D city table needs WebGL.</div>}
        <div className="table-hud">
          <span className="hud-kicker">Downtown Ottawa · {cursor ? `rewound to ${clock(cursor)}` : 'live'}</span>
          <ul className="hud-legend">
            {legend.map(([c, n]) => (
              <li key={c}><i style={{ background: category(c).color }} />{category(c).label}<b>{n}</b></li>
            ))}
          </ul>
        </div>
        {selected && focus && (
          <div className="table-pin" style={{ left: focus.x, top: focus.y }}>
            <span style={{ borderColor: category(selected.category).color }}>
              <small>{ticketId(selected)}</small>{selected.title}
            </span>
          </div>
        )}
        <div className="table-hint">drag to turn · click a tower</div>
      </div>
      <div className="timeline-wrap">
        <div className="timeline-labels"><span>48 h ago</span><span>{cursor ? clock(cursor) : 'now'}</span></div>
        <div
          ref={lineHost}
          className="timeline-host"
          role="slider"
          aria-label="Rewind the city"
          aria-valuemin={0}
          aria-valuemax={48}
          aria-valuenow={cursor ? Math.round((cursor - t0) / 3600_000) : 48}
          tabIndex={0}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
          onPointerMove={scrub}
          onPointerLeave={() => setHoverX(null)}
          onDoubleClick={() => onCursor(null)}
          onKeyDown={(e) => {
            const step = 3600_000;
            const cur = cursor ?? t1;
            if (e.key === 'ArrowLeft') onCursor(Math.max(t0, cur - step));
            if (e.key === 'ArrowRight') onCursor(cur + step >= t1 ? null : cur + step);
            if (e.key === 'End') onCursor(null);
          }}
        />
      </div>
    </section>
  );
}
