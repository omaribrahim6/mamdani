import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { Pause, Play, Route as RouteIcon, Search, X } from 'lucide-react';
import type { CategoryId } from '@shared/categories';
import type { Status } from '@shared/types';
import { sla } from '@shared/sla';
import { useCity } from '../lib/city';
import { CATEGORIES, category, stamp, STATUS_SHORT, street } from '../lib/format';
import { CityMap, MapLayers } from '../map/CityMap';
import { CategoryIcon, SlaChip } from '../components/ui';
import './map-page.css';

// The whole city on one screen: filter what's shown, pick stops for a crew run and let Mapbox
// order them, or replay the last week of reports hour by hour to see where problems cluster.

const DAY = 86400e3;

export default function MapPage() {
  const city = useCity();
  const [cats, setCats] = useState<Set<CategoryId>>(new Set());
  const [status, setStatus] = useState<'open' | Status | 'late'>('open');
  const [q, setQ] = useState('');
  const [heat, setHeat] = useState(true);
  const [buildings, setBuildings] = useState(true);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const tween = useRef<gsap.core.Tween | null>(null);
  const now = Date.now();
  const start = now - 7 * DAY;

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return city.issues.filter((i) => {
      if (cats.size && !cats.has(i.category)) return false;
      if (status === 'open' && i.status === 'resolved') return false;
      if (status === 'late' && (i.status === 'resolved' || sla(i, now).state !== 'breached')) return false;
      if (status !== 'open' && status !== 'late' && i.status !== status) return false;
      if (replayAt != null && i.firstReportedAt > replayAt) return false;
      if (text && !`#${i.id} ${i.title} ${i.address}`.toLowerCase().includes(text)) return false;
      return true;
    });
  }, [city.issues, cats, status, q, replayAt, now]);

  const present = useMemo(() => [...new Set(city.issues.map((i) => i.category))], [city.issues]);

  const togglePick = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else if (n.size < 11) n.add(id);
      return n;
    });

  const play = () => {
    if (playing) {
      tween.current?.pause();
      setPlaying(false);
      return;
    }
    const o = { t: replayAt != null && replayAt < now - 3600e3 ? replayAt : start };
    setPlaying(true);
    tween.current = gsap.to(o, {
      t: now,
      duration: 14,
      ease: 'none',
      onUpdate: () => setReplayAt(o.t),
      onComplete: () => {
        setPlaying(false);
        setReplayAt(null);
      },
    });
  };

  useEffect(() => () => void tween.current?.kill(), []);

  const replayCount = replayAt == null ? 0 : city.activity.filter((a) => a.t <= replayAt && a.t > replayAt - DAY).length;

  return (
    <div className="page mappage">
      <div className="mp-wrap card flush">
        <CityMap
          issues={shown}
          variant="full"
          heat={heat}
          buildings={buildings}
          replayAt={replayAt}
          picking={picked}
          onPick={picking ? togglePick : undefined}
        />

        <aside className="mp-panel">
          <div className="mp-head">
            <h1>Live map</h1>
            <span className="chip">
              <i className="live-dot" /> {shown.length} shown
            </span>
          </div>
          <label className="field mp-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Street, number, or title" />
          </label>
          <div className="mp-status">
            {(['open', 'new', 'assigned', 'in_progress', 'late', 'resolved'] as const).map((s) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {s === 'open' ? 'Open' : s === 'late' ? 'Late' : STATUS_SHORT[s]}
              </button>
            ))}
          </div>
          <div className="mp-cats">
            {present.map((c) => (
              <button
                key={c}
                className={cats.has(c) ? 'on' : ''}
                onClick={() =>
                  setCats((p) => {
                    const n = new Set(p);
                    if (n.has(c)) n.delete(c);
                    else n.add(c);
                    return n;
                  })
                }
              >
                <i style={{ background: CATEGORIES[c].color }} />
                {CATEGORIES[c].label}
              </button>
            ))}
          </div>

          {picking ? (
            <div className="mp-route">
              <b>Plan a crew run</b>
              <span>Click pins on the map to add stops (up to 11). Mapbox finds the fastest order from the Public Works yard.</span>
              <div className="mp-picked">
                {[...picked].map((id) => {
                  const i = city.byId.get(id);
                  return i ? (
                    <button key={id} onClick={() => togglePick(id)}>
                      #{id} {street(i.address)} <X size={12} />
                    </button>
                  ) : null;
                })}
              </div>
              <div className="mp-route-btns">
                <button
                  className="btn small primary"
                  disabled={picked.size < 2}
                  onClick={() => {
                    city.show([...picked], `Crew run · ${picked.size} stops`, 'route');
                    setPicking(false);
                    setPicked(new Set());
                  }}
                >
                  <RouteIcon size={14} /> Optimize route
                </button>
                <button className="btn small soft" onClick={() => (setPicking(false), setPicked(new Set()))}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="btn soft mp-plan" onClick={() => (city.clearFocus(), setPicking(true))}>
              <RouteIcon size={16} /> Plan a crew run
            </button>
          )}

          <div className="mp-list">
            {shown.slice(0, 40).map((i) => (
              <button
                key={i.id}
                className={`mp-item ${city.selectedId === i.id ? 'on' : ''} ${picked.has(i.id) ? 'picked' : ''}`}
                onClick={() => (picking ? togglePick(i.id) : city.open(i.id))}
                onMouseEnter={() => document.querySelector(`.pin[data-id="${i.id}"]`)?.classList.add('selected')}
                onMouseLeave={() => city.selectedId !== i.id && document.querySelector(`.pin[data-id="${i.id}"]`)?.classList.remove('selected')}
              >
                <CategoryIcon id={i.category} size={15} />
                <div className="mp-item-main">
                  <b>{i.title}</b>
                  <span>
                    #{i.id} · {street(i.address)} · {category(i.category).label}
                  </span>
                </div>
                <SlaChip issue={i} now={now} />
              </button>
            ))}
          </div>
        </aside>

        <div className="mp-tools">
          <MapLayers heat={heat} setHeat={setHeat} buildings={buildings} setBuildings={setBuildings} />
        </div>

        <div className="mp-replay">
          <button className="replay-btn" onClick={play} aria-label={playing ? 'Pause replay' : 'Replay the week'}>
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <div className="replay-track">
            <div className="replay-meta">
              <b>{replayAt == null ? 'Replay the last 7 days' : stamp(replayAt)}</b>
              <span>{replayAt == null ? 'Watch reports arrive, hour by hour' : `${replayCount} reports in the 24h before`}</span>
            </div>
            <input
              type="range"
              min={start}
              max={now}
              step={3600e3}
              value={replayAt ?? now}
              onChange={(e) => {
                tween.current?.kill();
                setPlaying(false);
                const v = Number(e.target.value);
                setReplayAt(v >= now - 3600e3 ? null : v);
              }}
              style={{ ['--p' as string]: `${(((replayAt ?? now) - start) / (now - start)) * 100}%` }}
            />
            <div className="replay-days">
              {Array.from({ length: 8 }, (_, k) => (
                <span key={k}>{new Date(start + k * DAY).toLocaleDateString('en-CA', { weekday: 'short' })}</span>
              ))}
            </div>
          </div>
          {replayAt != null && (
            <button className="icon-btn ghost" onClick={() => (tween.current?.kill(), setPlaying(false), setReplayAt(null))} aria-label="Back to now">
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
