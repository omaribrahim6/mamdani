import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Accessibility, CalendarDays, CloudRain, Globe, Layers, Printer, RefreshCw, Route as RouteIcon, TrendingUp, Volume2, VolumeX } from 'lucide-react';
import { useCity } from '../lib/city';
import { category, clock, hours, street } from '../lib/format';
import { go } from '../lib/router';
import { MamdaniCanvas } from '../mamdani/MamdaniCanvas';
import './brief.css';

// Today's brief, written by Gemini from the city record and the web: the memo a supervisor reads
// before sending crews out. Mamdani can read it aloud.

const KIND = { weather: CloudRain, trend: TrendingUp, equity: Accessibility, backlog: Layers, event: CalendarDays };

export default function BriefPage() {
  const city = useCity();
  const b = city.brief;
  const root = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState(false);

  useGSAP(
    () => {
      if (!b) return;
      gsap.from('.enter', { y: 24, opacity: 0, duration: 0.8, stagger: 0.06 });
      gsap.from('.bf-head-word', { yPercent: 110, duration: 0.9, stagger: 0.04, ease: 'power4.out' });
    },
    { scope: root, dependencies: [b?.generatedAt] },
  );

  useEffect(() => () => speechSynthesis?.cancel(), []);

  const read = () => {
    if (!b) return;
    if (reading) {
      speechSynthesis.cancel();
      setReading(false);
      return;
    }
    const text = [b.greeting, b.headline + '.', b.summary, ...b.priorities.map((p, k) => `Number ${k + 1}: ${p.action}.`), b.signoff].join(' ');
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => /en-(CA|US|GB)/.test(x.lang) && /male|daniel|guy|david|george|ryan/i.test(x.name));
    if (v) u.voice = v;
    u.rate = 1.03;
    u.onend = u.onerror = () => setReading(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setReading(true);
  };

  if (!b)
    return (
      <div className="page">
        <section className="card bf-wait">
          <MamdaniCanvas className="bf-wait-canvas" framing="bust" behavior="think" expression="THINKING" />
          <h2>{city.briefState === 'error' ? 'The brief couldn’t be written just now.' : 'Mamdani is writing today’s brief…'}</h2>
          <p className="muted">Reading the city record in Tiger Data and checking conditions with Google Search.</p>
          {city.briefState === 'error' && (
            <button className="btn primary" onClick={() => city.loadBrief(true)}>
              Try again
            </button>
          )}
        </section>
      </div>
    );

  const n = b.numbers;
  const delta = n.residentReportsPrevious24h ? Math.round(((n.residentReportsLast24h - n.residentReportsPrevious24h) / n.residentReportsPrevious24h) * 100) : null;

  return (
    <div className="page brief" ref={root}>
      <section className="bf-hero enter">
        <div className="brief-grain" />
        <div className="bf-hero-text">
          <div className="bf-kicker">
            <span className="brief-tag">Today’s brief · {new Date(b.generatedAt).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          </div>
          <h1 className="bf-head">
            {b.headline.split(' ').map((w, k) => (
              <span key={k} className="bf-mask">
                <span className="bf-head-word">{w}&nbsp;</span>
              </span>
            ))}
          </h1>
          <p className="bf-greet">“{b.greeting}”</p>
          <div className="bf-actions">
            <button className="btn bf-light" onClick={read}>
              {reading ? <VolumeX size={16} /> : <Volume2 size={16} />} {reading ? 'Stop' : 'Read it to me'}
            </button>
            <button className="btn bf-ghost" onClick={() => city.loadBrief(true)} disabled={city.briefState === 'loading'}>
              <RefreshCw size={16} className={city.briefState === 'loading' ? 'spin' : ''} /> Rewrite
            </button>
            <button className="btn bf-ghost" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </button>
          </div>
        </div>
        <div className="bf-hero-mamdani">
          <MamdaniCanvas className="bf-canvas" framing="waist" behavior={reading ? 'talk' : 'watch'} expression={reading ? 'CHEERFUL' : 'NEUTRAL'} />
        </div>
      </section>

      <section className="bf-numbers enter">
        <Num label="Open issues" v={String(n.openIssues)} />
        <Num label="New in 24h" v={String(n.newLast24h)} />
        <Num label="Resident reports, 24h" v={String(n.residentReportsLast24h)} sub={delta != null ? `${delta > 0 ? '+' : ''}${delta}% vs day before` : undefined} />
        <Num label="Past service target" v={String(n.serviceTargets.breached)} sub={`${n.serviceTargets.atRisk} at risk`} tone={n.serviceTargets.breached ? 'bad' : undefined} />
        <Num label="Median time to fix" v={n.medianHoursToFix != null ? hours(n.medianHoursToFix) : '—'} />
        <Num label="Accessibility barriers" v={String(n.accessibilityBarriersOpen)} />
      </section>

      <div className="bf-grid">
        <div className="bf-main">
          <section className="card enter">
            <h2 className="bf-h">The short version</h2>
            <p className="bf-summary">{b.summary}</p>
          </section>

          <section className="card enter">
            <h2 className="bf-h">Act on these first</h2>
            <ol className="bf-prio">
              {b.priorities.map((p, k) => {
                const i = city.byId.get(p.issueId);
                return (
                  <li key={p.issueId}>
                    <span className="bf-n">{k + 1}</span>
                    <div className="bf-prio-body">
                      <button className="bf-prio-title" onClick={() => city.open(p.issueId)}>
                        <b className="mono">#{p.issueId}</b> {i?.title ?? ''}
                        {i && <span> · {street(i.address)}</span>}
                      </button>
                      <p>{p.why}</p>
                      <div className="bf-do">
                        <b>Do:</b> {p.action}
                      </div>
                    </div>
                    {i && <span className="bf-cat" style={{ background: category(i.category).color }} />}
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="card enter">
            <h2 className="bf-h">Crew plan</h2>
            <div className="bf-crews">
              {b.crewPlan.map((c) => (
                <div key={c.department} className="bf-crew">
                  <b>{c.department}</b>
                  <p>{c.focus}</p>
                  <div className="bf-crew-ids">
                    {c.issueIds.map((id) => (
                      <button key={id} className="chip mono" onClick={() => city.open(id)}>
                        #{id}
                      </button>
                    ))}
                  </div>
                  {c.issueIds.length > 1 && (
                    <button
                      className="btn small soft"
                      onClick={() => {
                        city.show(c.issueIds, `${c.department} run`, 'route');
                        go('map');
                      }}
                    >
                      <RouteIcon size={14} /> Route this crew
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="bf-side">
          <section className="card enter">
            <h2 className="bf-h">Watch list</h2>
            <div className="bf-watch">
              {b.watchlist.map((w) => {
                const I = KIND[w.kind] ?? Layers;
                return (
                  <div key={w.title} className={`bf-w bf-w-${w.kind}`}>
                    <span className="bf-w-ico">
                      <I size={16} />
                    </span>
                    <div>
                      <b>{w.title}</b>
                      <p>{w.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card enter bf-outlook">
            <span className="muted">Next 24 hours</span>
            <b className="big num">~{b.outlook.expectedReports}</b>
            <span>resident reports expected</span>
            <p>{b.outlook.reasoning}</p>
          </section>

          {b.conditions.answer && (
            <section className="card enter">
              <h2 className="bf-h">
                <Globe size={15} /> Conditions, from the web
              </h2>
              <p className="bf-cond">{b.conditions.answer}</p>
              <div className="sources">
                {b.conditions.sources.map((s) => (
                  <a key={s.uri} href={s.uri} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                ))}
              </div>
            </section>
          )}

          <p className="bf-sign enter">
            “{b.signoff}”<span>— Mamdani · {b.model} · {clock(b.generatedAt)}</span>
          </p>
        </aside>
      </div>
    </div>
  );
}

function Num({ label, v, sub, tone }: { label: string; v: string; sub?: string; tone?: 'bad' }) {
  return (
    <div className="bf-num">
      <span>{label}</span>
      <b className={`num ${tone ?? ''}`}>{v}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}
