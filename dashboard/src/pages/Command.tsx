import { useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Accessibility, ArrowUpRight, Clock, RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { sla } from '@shared/sla';
import { useCity } from '../lib/city';
import { greeting, hours } from '../lib/format';
import { go } from '../lib/router';
import { Counter } from '../components/ui';
import { QueueTable } from '../components/QueueTable';
import { DotMatrix, hourly } from '../charts/DotMatrix';
import { Funnel } from '../charts/Funnel';
import { MiniDots, TickBar } from '../charts/Small';
import { CityMap, MapLayers } from '../map/CityMap';
import '../charts/charts.css';
import './pages.css';

const DAY = 86400e3;

export function CommandPage() {
  const city = useCity();
  const root = useRef<HTMLDivElement>(null);
  const [heat, setHeat] = useState(true);
  const [buildings, setBuildings] = useState(true);
  const now = Date.now();
  const open = city.issues.filter((i) => i.status !== 'resolved');

  useGSAP(() => {
    gsap.from('.enter', { y: 26, opacity: 0, duration: 0.8, stagger: 0.07, ease: 'power3.out' });
  }, { scope: root });

  const hours48 = useMemo(() => hourly(city.activity, now, 36, 12), [city.activity, Math.floor(now / 60000)]);
  const last24 = city.activity.filter((a) => a.t > now - DAY).length;
  const prev24 = city.activity.filter((a) => a.t <= now - DAY && a.t > now - 2 * DAY).length;
  const delta = prev24 ? Math.round(((last24 - prev24) / prev24) * 100) : null;

  const days = useMemo(() => {
    const out: Array<{ label: string; reports: number; fresh: number }> = [];
    for (let k = 6; k >= 0; k--) {
      const d0 = new Date(now - k * DAY);
      d0.setHours(0, 0, 0, 0);
      const a = d0.getTime();
      const b = a + DAY;
      out.push({
        label: d0.toLocaleDateString('en-CA', { weekday: 'short' }),
        reports: city.activity.filter((p) => p.t >= a && p.t < b).length,
        fresh: city.issues.filter((i) => i.firstReportedAt >= a && i.firstReportedAt < b).length,
      });
    }
    return out;
  }, [city.activity, city.issues, Math.floor(now / 600000)]);

  const late = open.filter((i) => sla(i, now).state === 'breached').length;
  const risk = open.filter((i) => sla(i, now).state === 'at_risk').length;
  const access = open.filter((i) => i.accessibility.impact === 'moderate' || i.accessibility.impact === 'critical');
  const critical = access.filter((i) => i.accessibility.impact === 'critical').length;

  const stages = [
    { label: 'Reported', value: city.issues.length, note: 'Every distinct problem residents reported (duplicates merged)' },
    { label: 'Crew assigned', value: city.issues.filter((i) => i.status !== 'new').length },
    { label: 'Being fixed', value: city.issues.filter((i) => i.status === 'in_progress' || i.status === 'resolved').length },
    { label: 'Fixed', value: city.issues.filter((i) => i.status === 'resolved').length },
  ];

  const depts = useMemo(() => {
    const m = new Map<string, { open: number; late: number }>();
    for (const i of open) {
      const d = i.department.split(' — ')[0];
      const e = m.get(d) ?? { open: 0, late: 0 };
      e.open++;
      if (sla(i, now).state === 'breached') e.late++;
      m.set(d, e);
    }
    return [...m.entries()].sort((a, b) => b[1].open - a[1].open).slice(0, 6);
  }, [open, now]);
  const maxDept = Math.max(1, ...depts.map(([, d]) => d.open));

  return (
    <div className="page" ref={root}>
      <section className="hello enter">
        <div>
          <h1>
            {greeting()}, <span>Ottawa.</span>
          </h1>
          <p>
            {new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })} · Mamdani is watching{' '}
            <b>{open.length} open issues</b> across <b>{new Set(open.map((i) => i.department)).size} departments</b>.
          </p>
        </div>
        <div className="hello-chips">
          {late > 0 && (
            <button className="chip bad" onClick={() => go('queue')}>
              {late} past service target
            </button>
          )}
          {city.fresh.size > 0 && <span className="chip solid">{city.fresh.size} new since you opened this</span>}
        </div>
      </section>

      <div className="grid">
        <section className="card tint span-7 enter">
          <div className="card-head">
            <div>
              <h3 className="card-title">Resident reports</h3>
              <div className="card-sub">Every photo sent through the Mamdani app, per hour</div>
            </div>
            <div className="legend">
              <span>
                <i className="lg-dot" /> Reported
              </span>
              <span>
                <i className="lg-dot proj" /> Projected
              </span>
            </div>
          </div>
          <div className="big-row">
            <span className="big num">
              <Counter value={last24} />
            </span>
            <span className="big-unit">in the last 24 hours</span>
            {delta != null && (
              <span className="chip">
                {delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {delta > 0 ? '+' : ''}
                {delta}% vs day before
              </span>
            )}
            {city.brief && (
              <span className="chip gem" title={city.brief.outlook.reasoning}>
                <Sparkles size={12} /> Gemini expects ~{city.brief.outlook.expectedReports} tomorrow
              </span>
            )}
          </div>
          <DotMatrix data={hours48} height={230} />
        </section>

        <section className="card span-5 enter">
          <div className="card-head">
            <div>
              <h3 className="card-title">Resolution pipeline</h3>
              <div className="card-sub">
                Median time to fix <b>{city.stats?.medianHoursToFix != null ? hours(city.stats.medianHoursToFix) : '—'}</b> · {city.stats?.resolvedToday ?? 0} fixed today
              </div>
            </div>
            <button className="icon-btn" onClick={() => go('analytics')} aria-label="Analytics">
              <ArrowUpRight size={16} />
            </button>
          </div>
          <Funnel stages={stages} height={292} />
        </section>

        <section className="card span-3 enter kpi">
          <div className="kpi-head">
            <span>Open issues</span>
            <span className="chip">{city.issues.filter((i) => i.firstReportedAt > now - DAY).length} new today</span>
          </div>
          <div className="kpi-row">
            <b className="kpi-num">
              <Counter value={open.length} />
            </b>
            <MiniDots values={days.map((d) => d.fresh)} labels={days.map((d) => d.label)} color="var(--ink)" />
          </div>
        </section>

        <section className="card span-3 enter kpi">
          <div className="kpi-head">
            <span>Resident reports · 7 days</span>
            <span className="chip">{city.issues.reduce((s, i) => s + i.reports, 0)} total</span>
          </div>
          <div className="kpi-row">
            <b className="kpi-num">
              <Counter value={days.reduce((s, d) => s + d.reports, 0)} />
            </b>
            <MiniDots values={days.map((d) => d.reports)} labels={days.map((d) => d.label)} color="#12995a" />
          </div>
        </section>

        <section className="card span-3 enter kpi">
          <div className="kpi-head">
            <span>
              <Clock size={13} /> Service targets
            </span>
            <button className="chip" onClick={() => go('queue')}>
              View late
            </button>
          </div>
          <div className="kpi-row col">
            <b className="kpi-num" style={{ color: late ? 'var(--bad)' : undefined }}>
              <Counter value={late} />
              <small>late</small>
            </b>
            <div className="seg">
              <i style={{ flex: late || 0.001, background: 'var(--bad)' }} />
              <i style={{ flex: risk || 0.001, background: 'var(--st-progress)' }} />
              <i style={{ flex: Math.max(0.001, open.length - late - risk), background: 'var(--good)' }} />
            </div>
            <div className="seg-key">
              <span>
                <i style={{ background: 'var(--bad)' }} />
                {late} late
              </span>
              <span>
                <i style={{ background: 'var(--st-progress)' }} />
                {risk} at risk
              </span>
              <span>
                <i style={{ background: 'var(--good)' }} />
                {open.length - late - risk} on track
              </span>
            </div>
          </div>
        </section>

        <section className="card span-3 enter kpi">
          <div className="kpi-head">
            <span>
              <Accessibility size={13} /> Accessibility barriers
            </span>
            <span className="chip">{critical} critical</span>
          </div>
          <div className="kpi-row col">
            <b className="kpi-num">
              <Counter value={access.length} />
              <small>blocking passage</small>
            </b>
            <button
              className="kpi-link"
              onClick={() => {
                city.show(
                  access.map((i) => i.id),
                  'Accessibility barriers',
                );
                go('map');
              }}
            >
              See them on the map <ArrowUpRight size={14} />
            </button>
          </div>
        </section>

        <section className="card flush span-8 enter map-card">
          <div className="map-head">
            <div className="map-title">
              <h3 className="card-title">Live city</h3>
              <span className="chip">
                <i className="live-dot" /> {open.length} open
              </span>
            </div>
            <MapLayers heat={heat} setHeat={setHeat} buildings={buildings} setBuildings={setBuildings} />
          </div>
          <CityMap issues={city.issues} variant="compact" heat={heat} buildings={buildings} />
        </section>

        <div className="span-4 stack">
          <section className="insight enter">
            <div className="brief-grain" />
            <div className="insight-top">
              <span className="brief-tag">
                <Sparkles size={13} /> Mamdani’s read
              </span>
              <button className="insight-refresh" onClick={() => city.loadBrief(true)} aria-label="Rewrite" title="Rewrite with fresh data">
                <RefreshCw size={14} className={city.briefState === 'loading' ? 'spin' : ''} />
              </button>
            </div>
            {city.brief ? (
              <>
                <p className="insight-big">{city.brief.headline}</p>
                <p className="insight-body">{city.brief.summary}</p>
                <div className="insight-steps">
                  {city.brief.priorities.slice(0, 3).map((p, k) => (
                    <button key={p.issueId} onClick={() => city.open(p.issueId)}>
                      <span className="n">{k + 1}</span>
                      <span className="t">
                        <b>#{p.issueId}</b> {p.action}
                      </span>
                    </button>
                  ))}
                </div>
                <button className="insight-cta" onClick={() => go('brief')}>
                  Read today’s brief <ArrowUpRight size={14} />
                </button>
              </>
            ) : (
              <div className="insight-wait">
                <p className="insight-big">{city.briefState === 'error' ? 'Gemini is unavailable right now.' : 'Reading the city…'}</p>
                <div className="brief-bar">
                  <i />
                </div>
              </div>
            )}
          </section>

          <section className="card enter">
            <div className="card-head">
              <div>
                <h3 className="card-title">Department load</h3>
                <div className="card-sub">Open work orders by who fixes them</div>
              </div>
            </div>
            <div className="depts">
              {depts.map(([d, v]) => (
                <div key={d} className="dept">
                  <span className="dept-name">{d}</span>
                  <b className="num">{v.open}</b>
                  <TickBar share={v.open / maxDept} color={v.late ? 'var(--bad)' : 'var(--ink)'} />
                  <span className="dept-late">{v.late ? `${v.late} late` : 'on track'}</span>
                </div>
              ))}
              {!depts.length && <div className="empty">No open work. Suspicious.</div>}
            </div>
          </section>
        </div>

        <section className="card span-12 enter">
          <QueueTable issues={city.issues} limit={8} title="Work queue" />
          <button className="see-all" onClick={() => go('queue')}>
            Open the full queue <ArrowUpRight size={14} />
          </button>
        </section>
      </div>
    </div>
  );
}
