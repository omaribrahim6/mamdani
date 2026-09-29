import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import type { CityStats, Issue } from '@shared/types';
import { api } from '../lib/api';
import { category, hours, street } from '../lib/format';
import { navigate } from '../lib/router';
import { MamdaniCanvas } from '../mamdani/MamdaniCanvas';
import type { Gesture } from '@mayor/portrait';
import './login.css';

// The front door. There's no sign-in — this is a public demo, so clicking through opens the portal
// read-only after a heads-up that the AI is switched off. Everything behind it lives under /admin/.
// The live numbers and the top work order shown here come from the same public API the residents'
// app uses.

export function Login({ returnTo }: { returnTo: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<CityStats | null>(null);
  const [top, setTop] = useState<Issue | null>(null);
  const [gesture, setGesture] = useState<{ g: Gesture; key: number } | null>(null);
  const [notice, setNotice] = useState(false);

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

  const enter = () => navigate(returnTo);

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
            <button className="lg-cta lg-anim" onClick={() => setNotice(true)} onMouseEnter={() => setGesture({ g: 'reassure', key: Date.now() })}>
              View the portal <ArrowRight size={18} />
            </button>
          </div>

          <footer className="lg-foot lg-anim">
            <Sparkles size={15} /> Public demo · AI switched off · open to look around
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

      {notice && (
        <div className="lg-modal" role="dialog" aria-modal="true" aria-labelledby="lg-modal-title" onClick={() => setNotice(false)}>
          <div className="lg-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="lg-modal-x" aria-label="Close" onClick={() => setNotice(false)}>
              <X size={18} />
            </button>
            <div className="lg-modal-icon">
              <Sparkles size={22} />
            </div>
            <h2 id="lg-modal-title">We&apos;ve switched the AI off</h2>
            <p>
              Mamdani&apos;s live analysis and assistant are turned off for this public demo, so nothing here talks to the AI. Everything
              else is real — go ahead and look around the portal to see the project.
            </p>
            <button className="lg-cta" onClick={enter}>
              Continue to the portal <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
