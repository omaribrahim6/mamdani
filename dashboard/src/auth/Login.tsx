import { useEffect, useRef, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { CityStats, Issue } from '@shared/types';
import { api } from '../lib/api';
import { category, hours, street } from '../lib/format';
import { MamdaniCanvas } from '../mamdani/MamdaniCanvas';
import type { Gesture } from '@mayor/portrait';
import './login.css';

// The front door: city staff sign in with Auth0 (the same tenant and app as the admin branch).
// Everything behind it lives under /admin/. The live numbers and the top work order shown here
// come from the same public API the residents' app uses.

export function Login({ returnTo, error }: { returnTo: string; error?: string }) {
  const { loginWithRedirect } = useAuth0();
  const root = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<CityStats | null>(null);
  const [top, setTop] = useState<Issue | null>(null);
  const [gesture, setGesture] = useState<{ g: Gesture; key: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api
      .issues()
      .then((r) => setTop(r.issues.find((i) => i.status !== 'resolved') ?? null))
      .catch(() => {});
  }, []);

  useGSAP(
    () => {
      gsap.from('.lg-anim', { y: 22, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out' });
      gsap.from('.lg-float', { y: 30, opacity: 0, scale: 0.94, duration: 1, stagger: 0.15, delay: 0.5, ease: 'back.out(1.6)' });
      gsap.to('.lg-float', { y: '-=8', duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.6, delay: 1.6 });
    },
    { scope: root },
  );

  const signIn = () => {
    setBusy(true);
    void loginWithRedirect({ appState: { returnTo } });
  };

  return (
    <div className="login" ref={root}>
      <main className="lg-card">
        <section className="lg-left">
          <div className="lg-brand lg-anim">
            <img src="/mamdani-face.png" alt="" />
            <div>
              <div className="brand-word">
                mamdani<i>.</i>
              </div>
              <div className="brand-sub">Command · City of Ottawa</div>
            </div>
          </div>

          <div className="lg-copy">
            <h1 className="lg-anim">
              Every resident report.
              <br />
              <span>One clear next step.</span>
            </h1>
            <p className="lg-anim">
              Residents point their phone and talk to Mamdani. You get the result here: deduplicated, ranked, mapped and costed work orders, a
              morning brief, and an assistant that knows the whole record.
            </p>
            <button className="lg-cta lg-anim" onClick={signIn} disabled={busy} onMouseEnter={() => setGesture({ g: 'reassure', key: Date.now() })}>
              {busy ? 'Opening Auth0…' : 'Sign in to Command'} <ArrowRight size={18} />
            </button>
            {error && <p className="lg-error lg-anim">{error}</p>}
          </div>

          <footer className="lg-foot lg-anim">
            <ShieldCheck size={15} /> Secured by Auth0 · city staff accounts only
          </footer>
        </section>

        <section className="lg-right" aria-hidden>
          <div className="lg-sun" />
          <div className="lg-rings" />
          <MamdaniCanvas className="lg-canvas" framing="waist" outfit="construction" follow="always" gesture={gesture} />

          {stats && (
            <div className="lg-float lg-stats">
              <div>
                <b className="num">{stats.openCount}</b>
                <span>open issues</span>
              </div>
              <div>
                <b className="num">{stats.medianHoursToFix != null ? hours(stats.medianHoursToFix) : '—'}</b>
                <span>median fix</span>
              </div>
              <div>
                <b className="num">{stats.accessibilityOpen}</b>
                <span>access barriers</span>
              </div>
            </div>
          )}

          {top && (
            <div className="lg-float lg-issue">
              <div className="lg-issue-top">
                <span className="lg-prio">Priority {Math.round(top.priority)}</span>
                <span className="mono">#{top.id}</span>
              </div>
              <b>{top.title}</b>
              <span>
                {category(top.category).label} · {street(top.address)}
              </span>
            </div>
          )}

          <div className="lg-float lg-live">
            <i className="live-dot" /> Live from Tiger Data
          </div>
        </section>
      </main>
    </div>
  );
}

/** Full-screen state while Auth0 checks the session or finishes a redirect. */
export function Checking({ label = 'Checking your credentials…' }: { label?: string }) {
  return (
    <div className="login lg-checking">
      <img src="/mamdani-face.png" alt="" />
      <p>{label}</p>
    </div>
  );
}
