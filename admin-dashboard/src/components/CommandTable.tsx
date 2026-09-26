import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiIssue, ApiStats } from '../data/api';
import { category } from '../data/categories';
import { clock, STATUS_LABEL, ticketId } from '../data/view';
import { CityTwin } from '../gl/cityTwin';
import { useStages } from '../gl/GLProvider';
import { Timeline } from '../gl/timeline';
import { useLang } from '../i18n';

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
  const { t } = useLang();
  const host = useRef<HTMLDivElement>(null);
  const lineHost = useRef<HTMLDivElement>(null);
  const twin = useRef<CityTwin | null>(null);
  const line = useRef<Timeline | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ issue: ApiIssue; x: number; y: number } | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    if (!back || !host.current || !lineHost.current) return;
    const tw = new CityTwin(host.current, (ids) => pickRef.current(ids));
    let last = '';
    tw.onFocus = (p) => { const k = p ? `${Math.round(p.x)},${Math.round(p.y)}` : ''; if (k !== last) { last = k; setFocus(p); } };
    tw.onHover = (issue, p) => setHover(issue && p ? { issue, ...p } : null);
    const l = new Timeline(lineHost.current);
    twin.current = tw; line.current = l;
    const a = back.add(tw), b = back.add(l);
    return () => { a(); b(); twin.current = null; line.current = null; };
  }, [back]);

  useEffect(() => { twin.current?.setIssues(issues); }, [issues, back]);
  useEffect(() => { twin.current?.setSelected(selectedId); }, [selectedId, back]);
  useEffect(() => { twin.current?.setCursor(cursor); }, [cursor, back]);

  const hours = stats?.hourly ?? [];
  const t0 = hours[0]?.t ?? Date.now() - 48 * 3600_000;
  const t1 = (hours[hours.length - 1]?.t ?? Date.now()) + 3600_000;
  useEffect(() => { line.current?.setData(hours.map((h) => h.count)); }, [hours, back]);
  useEffect(() => { line.current?.setCursor(cursor === null ? 1 : Math.min(1, Math.max(0, (cursor - t0) / (t1 - t0)))); }, [cursor, t0, t1, back]);
  useEffect(() => { line.current?.setHover(hoverX ?? -1); }, [hoverX]);

  const selected = issues.find((i) => i.id === selectedId) ?? null;
  const legend = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) if (i.status !== 'resolved') m.set(i.category, (m.get(i.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [issues]);

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width));
    setHoverX(x);
    if (e.buttons === 1) onCursor(x > 0.985 ? null : t0 + x * (t1 - t0));
  };

  return (
    <section className="twin" aria-label={t('twin')}>
      <div ref={host} className="twin-host">
        {!back && <div className="twin-fallback">WebGL is needed for the 3D city.</div>}
        <div className="twin-hud">
          <p className="twin-kicker">{t('twin')}</p>
          <p className="twin-state">{cursor ? `${t('rewound')} ${clock(cursor)}` : <><i className="live-dot" /> {t('live')}</>}</p>
          <ul className="twin-legend">
            {legend.map(([c, n]) => <li key={c}><i style={{ background: category(c).color }} />{category(c).label}<b>{n}</b></li>)}
          </ul>
        </div>
        {selected && focus && (
          <div className="twin-pin" style={{ left: focus.x, top: focus.y }}>
            <span style={{ borderColor: category(selected.category).color }}><small>{ticketId(selected)} · {STATUS_LABEL[selected.status]}</small>{selected.title}</span>
          </div>
        )}
        {hover && hover.issue.id !== selectedId && (
          <div className="twin-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <small>{ticketId(hover.issue)} · priority {hover.issue.priority}</small>
            <strong>{hover.issue.title}</strong>
            <span>{hover.issue.address} · {hover.issue.reports} residents</span>
          </div>
        )}
        <p className="twin-hint">{t('dragHint')}</p>
        <p className="twin-attrib">© OpenStreetMap contributors</p>
      </div>
      <div className="timeline">
        <div className="timeline-labels"><span>{t('hoursAgo')}</span><span>{cursor ? clock(cursor) : t('now')}</span></div>
        <div
          ref={lineHost}
          className="timeline-host"
          role="slider"
          aria-label="Rewind the city (48 hours)"
          aria-valuemin={0}
          aria-valuemax={48}
          aria-valuenow={cursor ? Math.round((cursor - t0) / 3600_000) : 48}
          tabIndex={0}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
          onPointerMove={scrub}
          onPointerLeave={() => setHoverX(null)}
          onDoubleClick={() => onCursor(null)}
          onKeyDown={(e) => {
            const cur = cursor ?? t1;
            if (e.key === 'ArrowLeft') onCursor(Math.max(t0, cur - 3600_000));
            if (e.key === 'ArrowRight') onCursor(cur + 3600_000 >= t1 ? null : cur + 3600_000);
            if (e.key === 'End') onCursor(null);
          }}
        />
      </div>
    </section>
  );
}
