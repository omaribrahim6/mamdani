import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Accessibility, Copy, HardHat, MapPin, MessageSquare, Printer, ShieldAlert, Sparkles, TriangleAlert, Users, X } from 'lucide-react';
import type { Issue, Report } from '@shared/types';
import { sla } from '@shared/sla';
import { metersBetween as metresBetween } from '@shared/priority';
import { api, type WorkPlan } from '../lib/api';
import { useCity } from '../lib/city';
import { ago, category, hood, hours, money, NEXT_STATUS, stamp, STATUS_ORDER, STATUS_SHORT, street } from '../lib/format';
import { go } from '../lib/router';
import { printAs } from '../lib/print';
import { CategoryIcon, Counter } from './ui';
import './drawer.css';

// One work order, everything about it: the evidence, what Gemini saw, why it ranks where it
// does, its clock against the service target, Gemini's work plan, the history, and the residents'
// own words. The next step is one button.

const PARTS: Array<[keyof Issue['priorityParts'], string, string]> = [
  ['severity', 'Severity', 'var(--ink)'],
  ['safety', 'Safety risk', 'var(--accent)'],
  ['accessibility', 'Accessibility', '#2f6bff'],
  ['confirmations', 'Resident reports', '#8a3fd6'],
  ['age', 'Time open', 'var(--ink-4)'],
];

export function IssueDrawer() {
  const city = useCity();
  const id = city.selectedId;
  const issue = id ? city.byId.get(id) : null;
  const [reports, setReports] = useState<Report[]>([]);
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [planState, setPlanState] = useState<'idle' | 'loading' | 'error'>('idle');
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Issue | null>(null);

  useEffect(() => {
    if (issue) setShown(issue);
  }, [issue]);

  useEffect(() => {
    if (!sheet.current || !scrim.current) return;
    gsap.killTweensOf([sheet.current, scrim.current]);
    if (id) {
      gsap.to(scrim.current, { autoAlpha: 1, duration: 0.3 });
      gsap.fromTo(sheet.current, { x: 0, xPercent: 105 }, { x: 0, xPercent: 0, duration: 0.6, ease: 'expo.out' });
      gsap.fromTo(sheet.current.querySelectorAll('.dr-anim'), { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, stagger: 0.05, delay: 0.12 });
    } else {
      gsap.to(scrim.current, { autoAlpha: 0, duration: 0.3 });
      gsap.to(sheet.current, { x: 0, xPercent: 105, duration: 0.4, ease: 'power3.in' });
    }
  }, [id]);

  useEffect(() => {
    setReports([]);
    setPlan(null);
    setPlanState('idle');
    if (!id) return;
    api.issue(id).then((r) => setReports(r.reports)).catch(() => {});
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && city.open(null);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [city]);

  const makePlan = () => {
    if (!id) return;
    setPlanState('loading');
    api
      .plan(id)
      .then((p) => {
        setPlan(p);
        setPlanState('idle');
      })
      .catch(() => setPlanState('error'));
  };

  const i = issue ?? shown;
  const s = i ? sla(i) : null;
  // other open work within a short walk: batch it into the same crew visit
  const nearby = i
    ? city.issues
        .filter((o) => o.id !== i.id && o.status !== 'resolved')
        .map((o) => ({ i: o, m: metresBetween(i.lat, i.lng, o.lat, o.lng) }))
        .filter((o) => o.m < 900)
        .sort((a, b) => a.m - b.m)
        .slice(0, 4)
    : [];
  const next = i ? NEXT_STATUS[i.status] : undefined;
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

  return (
    <>
      <div className="dr-scrim" ref={scrim} onClick={() => city.open(null)} />
      <aside className="drawer" ref={sheet} aria-label="Work order">
        {i && s && (
          <>
            <header className="dr-head dr-anim">
              <span className="chip mono">#{i.id}</span>
              <span className="chip" style={{ color: category(i.category).color }}>
                {category(i.category).label}
              </span>
              <span className="dr-sp" />
              <button className="icon-btn ghost" onClick={() => printAs('issue')} aria-label="Print work order" title="Print work order">
                <Printer size={16} />
              </button>
              <button className="icon-btn ghost" onClick={() => city.open(null)} aria-label="Close">
                <X size={16} />
              </button>
            </header>

            <div className="dr-body">
              <div className="dr-anim">
                <h2 className="dr-title">{i.title}</h2>
                <button
                  className="dr-addr"
                  onClick={() => {
                    city.show([i.id], street(i.address));
                    go('map');
                  }}
                >
                  <MapPin size={14} /> {i.address}
                </button>
              </div>

              <ol className="stepper dr-anim">
                {STATUS_ORDER.map((st, k) => {
                  const at = STATUS_ORDER.indexOf(i.status);
                  return (
                    <li key={st} className={k < at ? 'done' : k === at ? 'now' : ''}>
                      <i />
                      <span>{STATUS_SHORT[st]}</span>
                    </li>
                  );
                })}
              </ol>

              <figure className="dr-photo dr-anim">
                {i.mediaId ? (
                  <>
                    <img src={api.media(i.mediaId)} alt={`Evidence: ${i.title}`} />
                    {i.box && (
                      <span
                        className="dr-box"
                        style={{ top: `${i.box[0] / 10}%`, left: `${i.box[1] / 10}%`, height: `${(i.box[2] - i.box[0]) / 10}%`, width: `${(i.box[3] - i.box[1]) / 10}%` }}
                      >
                        <em>{category(i.category).stencil}</em>
                      </span>
                    )}
                    <figcaption>Resident photo · faces and plates blurred before storage</figcaption>
                  </>
                ) : (
                  <>
                    <img
                      src={`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l+ff6a13(${i.lng},${i.lat})/${i.lng},${i.lat},17.6,0,40/640x300@2x?access_token=${token}&attribution=false&logo=false`}
                      alt={`Satellite view of ${i.address}`}
                    />
                    <figcaption>Satellite view · no resident photo on file</figcaption>
                  </>
                )}
              </figure>

              <div className="dr-scores dr-anim">
                <Score label="Severity" value={i.severity} icon={<TriangleAlert size={14} />} />
                <Score label="Safety risk" value={i.safetyRisk} icon={<ShieldAlert size={14} />} />
                <div className="score">
                  <span className="score-label">
                    <Accessibility size={14} /> Accessibility
                  </span>
                  <b className={`access access-${i.accessibility.impact}`}>{i.accessibility.impact}</b>
                  <span className="score-sub">{i.accessibility.barrier ? 'Barrier to passage' : 'No barrier'}</span>
                </div>
              </div>

              <section className="dr-sec dr-anim">
                <div className="dr-sec-head">
                  <h3>Why it’s priority {Math.round(i.priority)}</h3>
                  <span className="muted">out of 100</span>
                </div>
                <div className="parts">
                  {PARTS.map(([k, , c]) => (
                    <i key={k} style={{ flex: Math.max(0.001, i.priorityParts[k]), background: c }} />
                  ))}
                  <i style={{ flex: Math.max(0.001, 100 - i.priority), background: 'var(--panel-2)' }} />
                </div>
                <div className="parts-key">
                  {PARTS.map(([k, label, c]) => (
                    <span key={k}>
                      <i style={{ background: c }} />
                      {label} <b className="num">+{i.priorityParts[k]}</b>
                    </span>
                  ))}
                </div>
              </section>

              <section className="dr-sec dr-anim">
                <div className="dr-sec-head">
                  <h3>Service target</h3>
                  <span className={`sla sla-${s.state}`}>{i.status === 'resolved' ? (s.state === 'met' ? 'Met' : 'Missed') : s.state === 'breached' ? `${hours(-s.left)} late` : `${hours(s.left)} left`}</span>
                </div>
                <div className="clockbar">
                  <i style={{ width: `${Math.min(100, (s.used / s.target) * 100)}%` }} className={s.state} />
                </div>
                <p className="muted small">
                  {Math.round(s.target)}h target for {category(i.category).label.toLowerCase()}
                  {i.safetyRisk >= 75 ? ' (halved: high safety risk)' : ''} · open {hours(s.used)} · first reported {ago(i.firstReportedAt)}
                </p>
              </section>

              <section className="dr-sec dr-anim">
                <h3>What Gemini saw</h3>
                <p className="dr-summary">{i.summary}</p>
                {(i.hazards.length > 0 || i.accessibility.notes.length > 0) && (
                  <div className="tags">
                    {i.hazards.map((h) => (
                      <span key={h} className="chip">
                        <TriangleAlert size={12} /> {h}
                      </span>
                    ))}
                    {i.accessibility.notes.map((n) => (
                      <span key={n} className="chip access-note">
                        <Accessibility size={12} /> {n}
                      </span>
                    ))}
                  </div>
                )}
                <p className="muted small">
                  Routed to <b>{i.department}</b>
                </p>
              </section>

              <section className="dr-sec plan dr-anim">
                <div className="dr-sec-head">
                  <h3>
                    <Sparkles size={14} /> Work plan
                  </h3>
                  {plan && <span className="muted small">Gemini estimate</span>}
                </div>
                {!plan && planState !== 'loading' && (
                  <button className="plan-cta" onClick={makePlan}>
                    <HardHat size={18} />
                    <div>
                      <b>{planState === 'error' ? 'Try again' : 'Draft the crew plan'}</b>
                      <span>Crew, cost range, materials, ROI and a note for residents</span>
                    </div>
                  </button>
                )}
                {planState === 'loading' && (
                  <div className="plan-loading">
                    <div className="skeleton" style={{ height: 64 }} />
                    <div className="skeleton" style={{ height: 14, width: '70%' }} />
                    <div className="skeleton" style={{ height: 14, width: '55%' }} />
                  </div>
                )}
                {plan && <Plan plan={plan} />}
              </section>

              {nearby.length > 0 && (
                <section className="dr-sec dr-anim">
                  <div className="dr-sec-head">
                    <h3>Nearby open issues</h3>
                    <button
                      className="btn small soft"
                      onClick={() => {
                        city.show([i.id, ...nearby.map((n) => n.i.id)], `Batch around ${street(i.address)}`, 'route');
                        go('map');
                      }}
                    >
                      Route them together
                    </button>
                  </div>
                  <div className="nearby">
                    {nearby.map(({ i: n, m }) => (
                      <button key={n.id} onClick={() => city.open(n.id)}>
                        <CategoryIcon id={n.category} size={14} />
                        <span className="nearby-text">
                          <b>{n.title}</b>
                          <em>
                            #{n.id} · {Math.round(m)} m away · {STATUS_SHORT[n.status]}
                          </em>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="dr-sec dr-anim">
                <h3>History</h3>
                <ol className="timeline">
                  {[...i.events].reverse().map((e, k) => (
                    <li key={k} className={`ev-${e.kind}`}>
                      <i />
                      <div>
                        <b>{e.note}</b>
                        <span>{stamp(e.at)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {reports.some((r) => r.transcript) && (
                <section className="dr-sec dr-anim">
                  <h3>
                    <Users size={14} /> In residents’ words
                  </h3>
                  <div className="quotes">
                    {reports
                      .filter((r) => r.transcript)
                      .slice(0, 4)
                      .map((r) => (
                        <blockquote key={r.id}>
                          “{r.transcript}”<span>{ago(r.createdAt)}</span>
                        </blockquote>
                      ))}
                  </div>
                </section>
              )}
            </div>

            <footer className="dr-foot">
              <button className="btn soft" onClick={() => city.askMamdani(`Tell me about work order #${i.id} at ${street(i.address)}: what should we do, and is anything similar nearby?`)}>
                <MessageSquare size={16} /> Ask Mamdani
              </button>
              <span className="dr-sp" />
              {next && (
                <button className="btn primary" onClick={() => void city.setStatus([i.id], next.to)}>
                  {next.verb}
                </button>
              )}
            </footer>

          </>
        )}
      </aside>
    </>
  );
}

function Score({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  const segs = 12;
  const on = Math.round((value / 100) * segs);
  return (
    <div className="score">
      <span className="score-label">
        {icon} {label}
      </span>
      <b className="num">
        <Counter value={value} />
      </b>
      <span className="segs">
        {Array.from({ length: segs }, (_, k) => (
          <i key={k} className={k < on ? (value >= 70 ? 'hot' : 'on') : ''} />
        ))}
      </span>
    </div>
  );
}

function Plan({ plan }: { plan: WorkPlan }) {
  const city = useCity();
  return (
    <div className="plan-body">
      <div className="plan-kpis">
        <div>
          <span>Cost range</span>
          <b className="num">
            {money(plan.cost.low)}–{money(plan.cost.high).replace('CA', '')}
          </b>
        </div>
        <div>
          <span>Crew</span>
          <b className="num">
            {plan.crew.size} × {plan.crew.hours}h
          </b>
        </div>
        <div>
          <span>Trade</span>
          <b>{plan.crew.trade}</b>
        </div>
      </div>
      <p className="muted small">{plan.cost.basis}</p>
      <div className="plan-cols">
        <div>
          <h4>Steps</h4>
          <ol>
            {plan.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4>Bring</h4>
          <ul>
            {[...plan.materials, ...plan.equipment].slice(0, 8).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="plan-note">
        <b>Traffic control</b> {plan.trafficControl}
      </div>
      <div className="plan-note warn">
        <b>If it waits</b> {plan.riskIfDelayed}
      </div>
      <div className="plan-note good">
        <b>Return on fixing now</b> {plan.roi}
      </div>
      <div className="resident">
        <div className="resident-head">
          <b>Update for residents</b>
          <button
            className="btn small soft"
            onClick={() => {
              void navigator.clipboard?.writeText(plan.residentUpdate);
              city.toast({ tone: 'good', title: 'Resident update copied' });
            }}
          >
            <Copy size={13} /> Copy
          </button>
        </div>
        <p>{plan.residentUpdate}</p>
      </div>
    </div>
  );
}
