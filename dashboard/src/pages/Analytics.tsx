import { useMemo, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Sparkles } from 'lucide-react';
import { sla, slaHours } from '@shared/sla';
import type { CategoryId } from '@shared/categories';
import { useCity } from '../lib/city';
import { CATEGORIES, hood, hours } from '../lib/format';
import { Heatmap, StackBlocks, StepBars } from '../charts/Big';
import { TickBar } from '../charts/Small';
import { tip } from '../components/ui';
import '../charts/charts.css';
import './pages.css';
import './analytics.css';

// How the city is doing over time: backlog, when reports arrive, where the work sits, how old
// it is against its targets, and who's waiting longest. Every card can be handed to Mamdani.

const H = 3600e3;

function Explain({ q }: { q: string }) {
  const city = useCity();
  return (
    <button className="explain" onClick={() => city.askMamdani(q)} title="Ask Mamdani to explain this">
      <Sparkles size={13} /> Explain
    </button>
  );
}

export default function AnalyticsPage() {
  const city = useCity();
  const root = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const open = city.issues.filter((i) => i.status !== 'resolved');

  useGSAP(() => {
    gsap.from('.enter', { y: 24, opacity: 0, duration: 0.7, stagger: 0.07 });
  }, { scope: root });

  // open backlog every 3 hours for 3 days
  const backlog = useMemo(() => {
    const out: Array<{ t: number; v: number; label: string }> = [];
    const end = Math.floor(now / (3 * H)) * 3 * H;
    for (let t = end - 71 * H; t <= end; t += 3 * H) {
      const v = city.issues.filter((i) => i.firstReportedAt <= t && (!i.resolvedAt || i.resolvedAt > t)).length;
      out.push({ t, v, label: new Date(t).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric' }) });
    }
    return out;
  }, [city.issues, Math.floor(now / 600000)]);

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const heat = useMemo(() => {
    const g = DAYS.map(() => new Array(24).fill(0) as number[]);
    for (const a of city.activity) {
      const d = new Date(a.t);
      g[(d.getDay() + 6) % 7][d.getHours()]++;
    }
    return g;
  }, [city.activity]);
  const hoursLabels = Array.from({ length: 24 }, (_, h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`));

  const depts = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const i of open) {
      const d = i.department.split(' — ')[0];
      const parts = m.get(d) ?? [0, 0, 0];
      parts[i.status === 'new' ? 0 : i.status === 'assigned' ? 1 : 2]++;
      m.set(d, parts);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].reduce((x, y) => x + y) - a[1].reduce((x, y) => x + y))
      .slice(0, 6)
      .map(([label, parts]) => ({ label, parts }));
  }, [open]);

  const ages = useMemo(() => {
    const m = new Map<CategoryId, number[]>();
    for (const i of open) m.set(i.category, [...(m.get(i.category) ?? []), (now - i.firstReportedAt) / H]);
    return [...m.entries()]
      .map(([c, list]) => {
        const s = [...list].sort((a, b) => a - b);
        return { c, median: s[Math.floor(s.length / 2)], oldest: s[s.length - 1], target: slaHours({ category: c, safetyRisk: 0 }), n: s.length };
      })
      .sort((a, b) => b.oldest / b.target - a.oldest / a.target);
  }, [open, now]);
  const ageMax = Math.max(1, ...ages.map((a) => Math.max(a.oldest, a.target)));

  const hoods = useMemo(() => {
    const m = new Map<string, { open: number; barriers: number; late: number }>();
    for (const i of open) {
      const h = hood(i.address) || 'Unknown';
      const e = m.get(h) ?? { open: 0, barriers: 0, late: 0 };
      e.open++;
      if (i.accessibility.impact === 'moderate' || i.accessibility.impact === 'critical') e.barriers++;
      if (sla(i, now).state === 'breached') e.late++;
      m.set(h, e);
    }
    return [...m.entries()].sort((a, b) => b[1].open - a[1].open).slice(0, 8);
  }, [open, now]);
  const hoodMax = Math.max(1, ...hoods.map(([, v]) => v.open));

  const peak = backlog.reduce((a, b) => (b.v > a.v ? b : a), backlog[0] ?? { v: 0, label: '' });
  const change = backlog.length > 8 ? backlog[backlog.length - 1].v - backlog[backlog.length - 9].v : 0;

  return (
    <div className="page" ref={root}>
      <section className="phead enter">
        <div>
          <h1>Analytics</h1>
          <p>Backlog, timing, workload and equity — computed live from the city record in Tiger Data.</p>
        </div>
      </section>

      <div className="grid">
        <section className="card span-8 enter">
          <div className="card-head">
            <div>
              <h3 className="card-title">Open backlog</h3>
              <div className="card-sub">Issues open at each point in the last 72 hours</div>
            </div>
            <Explain q="Explain how the open backlog changed over the last 72 hours and what's driving it." />
          </div>
          <div className="big-row">
            <span className="big num">{open.length}</span>
            <span className="big-unit">open now</span>
            <span className={`chip ${change > 0 ? 'bad' : 'good'}`}>
              {change > 0 ? '+' : ''}
              {change} in 24h
            </span>
            <span className="chip">peak {peak?.v} · {peak?.label}</span>
          </div>
          <StepBars data={backlog} />
        </section>

        <section className="card span-4 enter">
          <div className="card-head">
            <div>
              <h3 className="card-title">Workload by department</h3>
              <div className="card-sub">Open work orders by stage</div>
            </div>
          </div>
          <StackBlocks
            columns={depts.slice(0, 4)}
            keys={[
              { label: 'Waiting', color: 'var(--ink)' },
              { label: 'Crew assigned', color: 'color-mix(in srgb, var(--ink) 55%, var(--panel))' },
              { label: 'Being fixed', color: 'color-mix(in srgb, var(--ink) 25%, var(--panel))' },
            ]}
          />
          <div className="legend center">
            <span>
              <i className="lg-sq" style={{ background: 'var(--ink)' }} /> Waiting
            </span>
            <span>
              <i className="lg-sq" style={{ background: 'color-mix(in srgb, var(--ink) 55%, var(--panel))' }} /> Crew assigned
            </span>
            <span>
              <i className="lg-sq" style={{ background: 'color-mix(in srgb, var(--ink) 25%, var(--panel))' }} /> Being fixed
            </span>
          </div>
        </section>

        <section className="card span-7 enter">
          <div className="card-head">
            <div>
              <h3 className="card-title">When residents report</h3>
              <div className="card-sub">Reports by weekday and hour, last 7 days · schedule inspectors where the pulse is</div>
            </div>
            <Explain q="Looking at when residents report problems by weekday and hour, when should we staff inspectors and crews?" />
          </div>
          <Heatmap grid={heat} rows={DAYS} cols={hoursLabels} />
        </section>

        <section className="card span-5 enter">
          <div className="card-head">
            <div>
              <h3 className="card-title">Age against service target</h3>
              <div className="card-sub">Bar: oldest open · dot: median · line: target</div>
            </div>
          </div>
          <div className="bullets">
            {ages.map((a) => (
              <div
                key={a.c}
                className="bullet"
                onMouseMove={(e) =>
                  tip.show(
                    e,
                    <>
                      <div className="tip-title">{CATEGORIES[a.c].label}</div>
                      <div className="tip-row">
                        <span className="tip-key">Open</span>
                        <b>{a.n}</b>
                      </div>
                      <div className="tip-row">
                        <span className="tip-key">Oldest</span>
                        <b>{hours(a.oldest)}</b>
                      </div>
                      <div className="tip-row">
                        <span className="tip-key">Median</span>
                        <b>{hours(a.median)}</b>
                      </div>
                      <div className="tip-row">
                        <span className="tip-key">Target</span>
                        <b>{hours(a.target)}</b>
                      </div>
                    </>,
                  )
                }
                onMouseLeave={tip.hide}
              >
                <span className="bullet-label">
                  <i style={{ background: CATEGORIES[a.c].color }} />
                  {CATEGORIES[a.c].label}
                </span>
                <span className="bullet-track">
                  <i className={`bullet-bar ${a.oldest > a.target ? 'late' : ''}`} style={{ width: `${(a.oldest / ageMax) * 100}%` }} />
                  <i className="bullet-med" style={{ left: `${(a.median / ageMax) * 100}%` }} />
                  <i className="bullet-target" style={{ left: `${(a.target / ageMax) * 100}%` }} />
                </span>
                <b className="num">{hours(a.oldest)}</b>
              </div>
            ))}
          </div>
        </section>

        <section className="card span-12 enter">
          <div className="card-head">
            <div>
              <h3 className="card-title">Neighbourhoods</h3>
              <div className="card-sub">Open issues, accessibility barriers and late work by area — is anyone waiting longer than everyone else?</div>
            </div>
            <Explain q="Is any Ottawa neighbourhood getting slower service or more accessibility barriers than others? Be specific." />
          </div>
          <div className="hoods">
            {hoods.map(([h, v]) => (
              <div key={h} className="hood">
                <span className="hood-name">{h}</span>
                <TickBar share={v.open / hoodMax} color={v.late ? 'var(--bad)' : 'var(--ink)'} />
                <b className="num">{v.open}</b>
                <span className="hood-meta">
                  {v.barriers ? `${v.barriers} barrier${v.barriers > 1 ? 's' : ''}` : '—'} · {v.late ? `${v.late} late` : 'on time'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
