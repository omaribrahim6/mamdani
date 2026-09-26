'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Mayor, type MayorHandle } from '@/components/mayor/Mayor';
import { SprayMark } from '@/components/marks/Spray';
import { category } from '@/lib/categories';
import type { Analysis, SubmitResult } from '@/lib/types';
import { frameFromVideoFile, saveMine, speak, unlockAudio, useCamera, useLocation, useRecorder } from './hooks';
import { MyReports } from './MyReports';
import { Ticket } from './Ticket';
import s from './capture.module.css';

type Phase =
  | { kind: 'camera' }
  | { kind: 'analyzing'; photo: string }
  | { kind: 'result'; photo: string; analysis: Analysis; result: SubmitResult | null }
  | { kind: 'error'; photo: string | null; message: string };

const HOLD_MS = 280;
const MAX_REC_S = 10;

export function CaptureApp() {
  const cam = useCamera();
  const rec = useRecorder(cam.stream);
  const loc = useLocation();
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [showMine, setShowMine] = useState(false);
  const [lift, setLift] = useState(0); // photo slides up so the ticket never covers the problem

  // ── capture ──
  const holdTimer = useRef<number>(0);
  const recStart = useRef(0);
  const [recProgress, setRecProgress] = useState(0);

  useEffect(() => {
    void cam.start();
  }, [cam.start]);

  const submit = useCallback(
    async (photo: Blob, video: Blob | null) => {
      const url = URL.createObjectURL(photo);
      setPhase({ kind: 'analyzing', photo: url });
      const fd = new FormData();
      fd.append('photo', photo, 'photo.jpg');
      if (video) fd.append('video', video, video.type.includes('mp4') ? 'clip.mp4' : 'clip.webm');
      fd.append('lat', String(loc.lat));
      fd.append('lng', String(loc.lng));
      try {
        const r = await fetch('/api/report', { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'The report didn’t go through.');
        const result = j.result as SubmitResult | null;
        if (result) {
          saveMine({
            issueId: result.issue.id,
            title: result.issue.title,
            category: result.issue.category,
            address: result.issue.address,
            at: Date.now(),
            duplicate: result.duplicate,
          });
        }
        setPhase({ kind: 'result', photo: url, analysis: j.analysis, result });
      } catch (e) {
        setPhase({ kind: 'error', photo: url, message: e instanceof Error ? e.message : 'The report didn’t go through.' });
      }
    },
    [loc.lat, loc.lng],
  );

  const onShutterDown = (e: React.PointerEvent) => {
    if (cam.state !== 'live') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    unlockAudio();
    holdTimer.current = window.setTimeout(() => {
      if (cam.hasAudio && rec.start()) {
        recStart.current = performance.now();
        navigator.vibrate?.(15);
      }
    }, HOLD_MS);
  };

  const onShutterUp = async () => {
    clearTimeout(holdTimer.current);
    if (cam.state !== 'live') return;
    if (rec.recording) {
      const photo = await cam.snap();
      const video = await rec.stop();
      if (photo) void submit(photo, video);
    } else {
      const photo = await cam.snap();
      if (photo) void submit(photo, null);
    }
  };

  // recording ring + auto-stop
  useEffect(() => {
    if (!rec.recording) return setRecProgress(0);
    let raf = 0;
    const tick = () => {
      const p = (performance.now() - recStart.current) / 1000 / MAX_REC_S;
      setRecProgress(Math.min(1, p));
      if (p >= 1) void onShutterUp();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.recording]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    unlockAudio();
    if (f.type.startsWith('video/')) {
      const frame = await frameFromVideoFile(f);
      if (frame) void submit(frame, f);
    } else {
      void submit(f, null);
    }
  };

  const again = () => {
    if (phase.kind !== 'camera' && phase.photo) URL.revokeObjectURL(phase.photo);
    setPhase({ kind: 'camera' });
    setLift(0);
    if (cam.state !== 'live') void cam.start();
  };

  return (
    <div className={s.shell}>
      <aside className={s.intro}>
        <p className={s.introKicker}>For residents of {process.env.NEXT_PUBLIC_CITY || 'Ottawa'}</p>
        <h1 className={`stencil ${s.introTitle}`}>Mamdani, fix this.</h1>
        <p className={s.introBody}>
          Point your phone at what’s broken and say it out loud. Mamdani figures out what it is, how bad it is and which
          department fixes it, then sends the city a report it can act on.
        </p>
        <p className={s.introBody}>No forms. No department names. No ticket numbers to look up.</p>
        <Link className="btn" href="/city">
          Open the city’s Command Center
        </Link>
      </aside>

      <main className={s.phone}>
        <Stage phase={phase} cam={cam} lift={lift} />

        {phase.kind === 'camera' && (
          <>
            <header className={s.top}>
              <span className={`stencil ${s.wordmark}`}>Mamdani</span>
              <button className={s.mineBtn} onClick={() => setShowMine(true)}>
                My reports
              </button>
            </header>
            <p className={s.where} aria-live="polite">
              <PinIcon />
              {loc.approximate ? 'Finding where you are…' : loc.label ? `Near ${loc.label}` : 'Location found'}
            </p>

            {cam.state === 'denied' || cam.state === 'unavailable' ? (
              <div className={s.permission}>
                <h2>{cam.state === 'denied' ? 'Mamdani needs to see the problem' : 'No camera found'}</h2>
                <p>
                  {cam.state === 'denied'
                    ? 'Allow camera access in your browser settings, or upload a photo you already took.'
                    : 'Upload a photo or a short video of the problem instead.'}
                </p>
                <div className={s.permissionActions}>
                  {cam.state === 'denied' && (
                    <button className="btn btn-primary" onClick={() => cam.start()}>
                      Try the camera again
                    </button>
                  )}
                  <label className="btn">
                    Upload a photo
                    <input type="file" accept="image/*,video/*" className="visually-hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                  </label>
                </div>
              </div>
            ) : (
              <>
                <Guides />
                <footer className={s.bottom}>
                  <p className={`stencil ${s.say}`}>{rec.recording ? 'Tell Mamdani what’s wrong' : 'Mamdani, fix this.'}</p>
                  <div className={s.shutterRow}>
                    <label className={s.sideBtn} aria-label="Upload a photo or video">
                      <UploadIcon />
                      <input type="file" accept="image/*,video/*" className="visually-hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                    </label>
                    <button
                      className={s.shutter}
                      data-rec={rec.recording}
                      onPointerDown={onShutterDown}
                      onPointerUp={onShutterUp}
                      onPointerCancel={onShutterUp}
                      onContextMenu={(e) => e.preventDefault()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void onShutterUp();
                        }
                      }}
                      aria-label={rec.recording ? 'Stop recording and send' : 'Take a photo. Hold to record video with your voice.'}
                      disabled={cam.state !== 'live'}
                    >
                      <svg viewBox="0 0 100 100" aria-hidden="true">
                        <circle cx="50" cy="50" r="46" className={s.ring} style={{ strokeDashoffset: 1 - recProgress }} pathLength={1} />
                      </svg>
                      <span />
                    </button>
                    <span className={s.sideSpacer} />
                  </div>
                  <p className={s.hint}>{cam.hasAudio ? 'Tap for a photo. Hold to record and talk.' : 'Tap to take a photo.'}</p>
                </footer>
              </>
            )}
          </>
        )}

        {phase.kind === 'analyzing' && <Analyzing />}

        {phase.kind === 'result' && (
          <Performance key={phase.photo} phase={phase} lift={lift} onLift={setLift} onAgain={again} onTrack={() => setShowMine(true)} />
        )}

        {phase.kind === 'error' && (
          <div className={s.errorCard} role="alert">
            <h2>Report not sent</h2>
            <p>{phase.message}</p>
            <button className="btn btn-primary" onClick={again}>
              Take it again
            </button>
          </div>
        )}

        {showMine && <MyReports onClose={() => setShowMine(false)} />}
      </main>
    </div>
  );
}

/** Camera feed or the captured photo, full-bleed. */
function Stage({ phase, cam, lift }: { phase: Phase; cam: ReturnType<typeof useCamera>; lift: number }) {
  const photo = phase.kind === 'camera' ? null : phase.photo;
  return (
    <div className={s.stage} style={{ transform: `translateY(${-lift}px)` }}>
      <video ref={cam.video} className={s.media} playsInline muted autoPlay hidden={!!photo} />
      {photo && <img src={photo} alt="Your photo of the problem" className={s.media} />}
    </div>
  );
}

function Analyzing() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 2600);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={s.analyzing} aria-live="polite">
      <Guides focusing />
      <p className={s.analyzingText}>{late ? 'Checking whether your neighbours already reported it…' : 'Mamdani is taking a look…'}</p>
    </div>
  );
}

/** The payoff: spray mark, tiny mayor, the flag, his line, the ticket. */
const TICKET_H = 196;

function Performance({
  phase,
  lift,
  onLift,
  onAgain,
  onTrack,
}: {
  phase: Extract<Phase, { kind: 'result' }>;
  lift: number;
  onLift: (px: number) => void;
  onAgain: () => void;
  onTrack: () => void;
}) {
  const { analysis, result } = phase;
  const cat = category(analysis.category);
  const wrap = useRef<HTMLDivElement>(null);
  const mayor = useRef<MayorHandle>(null);
  const [size, setSize] = useState({ w: 0, h: 0, iw: 0, ih: 0 });
  const [drawn, setDrawn] = useState(false);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const [ticketIn, setTicketIn] = useState(false);
  const [stamped, setStamped] = useState(false);
  const [open, setOpen] = useState(false);
  const [shake, setShake] = useState(false);

  // image natural size → where the AI's box lands on screen (object-fit: cover)
  useLayoutEffect(() => {
    const img = new Image();
    img.onload = () => {
      const r = wrap.current!.getBoundingClientRect();
      setSize({ w: r.width, h: r.height, iw: img.naturalWidth, ih: img.naturalHeight });
    };
    img.src = phase.photo;
  }, [phase.photo]);

  const box = (() => {
    if (!size.w) return null;
    const k = Math.max(size.w / size.iw, size.h / size.ih);
    const dw = size.iw * k;
    const dh = size.ih * k;
    const ox = (size.w - dw) / 2;
    const oy = (size.h - dh) / 2;
    const [y0, x0, y1, x1] = analysis.box ?? [420, 330, 700, 670];
    return { x: ox + (x0 / 1000) * dw, y: oy + (y0 / 1000) * dh, w: ((x1 - x0) / 1000) * dw, h: ((y1 - y0) / 1000) * dh };
  })();

  useEffect(() => {
    if (!box) return;
    let alive = true;
    const run = async () => {
      if (analysis.isCivicIssue) setDrawn(true);
      await wait(450);
      const target = { x: (box.x + box.w / 2) / size.w, y: Math.min(0.92, (box.y + box.h * 0.85) / size.h) };
      await mayor.current?.perform(analysis.isCivicIssue ? cat.outfit : 'inspector', {
        target,
        mood: analysis.isCivicIssue ? analysis.mood : 'confused',
        onThunk: () => {
          setShake(true);
          navigator.vibrate?.([30, 40, 20]);
          setTimeout(() => setShake(false), 260);
          if (result) {
            const bottom = box.y + box.h;
            onLift(Math.round(Math.max(0, Math.min(size.h * 0.3, bottom - (size.h - TICKET_H - 24)))));
            setTicketIn(true);
            setTimeout(() => alive && setStamped(true), 700);
          }
        },
      });
      if (!alive) return;
      setBubble(mayor.current?.headScreen() ?? { x: 0.5, y: 0.4 });
      await new Promise<void>((done) =>
        speak(
          analysis.mayorLine,
          (analyser) => {
            mayor.current?.listen(analyser);
            mayor.current?.speaking(true);
          },
          () => {
            mayor.current?.speaking(false);
            done();
          },
        ),
      );
    };
    void run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w]);

  return (
    <>
      <div ref={wrap} className={s.overlay} data-shake={shake} style={{ ['--lift' as string]: `${-lift}px` }}>
        {box && analysis.isCivicIssue && (
          <SprayMark width={size.w} height={size.h} box={box} color={cat.color} word={cat.stencil} number={analysis.severity} drawn={drawn} seed={result?.issue.id ?? 7} />
        )}
        <div className={s.mayorLayer}>
          <Mayor ref={mayor} />
        </div>
        {bubble && <Bubble at={bubble} w={size.w} h={size.h} text={analysis.mayorLine} />}
      </div>

      {result ? (
        ticketIn && (
          <Ticket analysis={analysis} result={result} open={open} stamped={stamped} onToggle={() => setOpen((o) => !o)} onAgain={onAgain} onTrack={onTrack} />
        )
      ) : (
        <div className={s.errorCard}>
          <h2>Nothing to fix here?</h2>
          <p>Mamdani couldn’t spot a city problem in that photo. Get closer and keep the problem in the middle of the frame.</p>
          <button className="btn btn-primary" onClick={onAgain}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Speech bubble above his head, kept on screen, tail still pointing at him. */
function Bubble({ at, w, h, text }: { at: { x: number; y: number }; w: number; h: number; text: string }) {
  const bw = Math.min(280, w * 0.74);
  const headX = at.x * w;
  const left = Math.max(12, Math.min(w - 12 - bw, headX - bw / 2));
  const tail = Math.max(22, Math.min(bw - 22, headX - left));
  const top = Math.max(96, at.y * h);
  return (
    <p className={s.bubble} style={{ left, top, width: bw, ['--tail' as string]: `${tail}px` }}>
      {text}
    </p>
  );
}

/** Four spray-painted corner marks: "put the problem here". */
function Guides({ focusing = false }: { focusing?: boolean }) {
  return (
    <svg className={s.guides} data-focusing={focusing} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {[
        'M8,22 L8,8 L22,8',
        'M78,8 L92,8 L92,22',
        'M92,78 L92,92 L78,92',
        'M22,92 L8,92 L8,78',
      ].map((d) => (
        <path key={d} d={d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="currentColor" />
      <circle cx="12" cy="10" r="2.6" fill="var(--asphalt)" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-8 9" />
    </svg>
  );
}
