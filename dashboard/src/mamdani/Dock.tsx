import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowUp, Check, Globe, Loader, MapPin, RotateCcw, Route as RouteIcon, Square, Volume2, VolumeX, X } from 'lucide-react';
import type { Status } from '@shared/types';
import { ask, type AgentEvent, type Source } from '../lib/api';
import { useCity } from '../lib/city';
import { category, STATUS_SHORT, street } from '../lib/format';
import { go, usePage } from '../lib/router';
import { speak, stopVoice, useVoice } from '../lib/voice';
import { Markdown } from './markdown';
import { MamdaniCanvas } from './MamdaniCanvas';
import type { Behavior, Gesture } from '@mayor/portrait';
import type { Expression } from '@mayor/face';
import './dock.css';

// Mamdani in the corner. Closed: his upper body leans out of a quarter circle in the bottom-right
// of the screen, following your cursor. Open: a chat where he stands behind the message box and
// answers from the city's record (Gemini + Tiger Data) and the web (Google Search grounding).

interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  steps: string[];
  sources: Source[];
  issues: number[];
  map?: { ids: number[]; label: string; mode: 'highlight' | 'route' };
  action?: { ids: number[]; status: Status; note: string; state: 'waiting' | 'done' | 'dismissed' };
  error?: string;
  done: boolean;
}

const SUGGESTIONS = [
  'What should crews tackle first today?',
  'Which accessibility barriers are past their service target?',
  'Plan a route for the five highest-priority road jobs',
  'Find photos that look like water pooling across a crosswalk',
  'Is freeze-thaw coming this week, and what does it mean for potholes?',
];

let mid = 1;

export function Dock() {
  const city = useCity();
  const page = usePage();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [voice, setVoiceState] = useState(() => {
    try {
      return localStorage.getItem('mamdani-voice') !== 'off';
    } catch {
      return true;
    }
  });
  const setVoice = (f: (v: boolean) => boolean) =>
    setVoiceState((v) => {
      const next = f(v);
      try {
        localStorage.setItem('mamdani-voice', next ? 'on' : 'off');
      } catch {
        /* private window */
      }
      if (!next) stopVoice();
      return next;
    });
  const { speaking, analyser } = useVoice();
  const [bubble, setBubble] = useState<string | null>(null);
  const [gesture, setGesture] = useState<{ g: Gesture; key: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const behavior: Behavior = speaking || streaming ? 'talk' : busy ? 'think' : input ? 'listen' : 'watch';
  const last = msgs[msgs.length - 1];
  const expression: Expression = busy && !streaming ? 'THINKING' : last?.error ? 'CONFUSED' : last?.action?.state === 'done' ? 'CHEERFUL' : 'NEUTRAL';

  // entrance: he pops up out of the corner
  useEffect(() => {
    if (!launcher.current) return;
    gsap.fromTo(launcher.current, { yPercent: 100, xPercent: 60 }, { yPercent: 0, xPercent: 0, duration: 1.1, ease: 'elastic.out(1, 0.75)', delay: 0.6 });
  }, []);

  // a thought bubble now and then, from what's happening in the city
  useEffect(() => {
    if (open) return;
    const lines = [
      city.fresh.size ? `${city.fresh.size} new report${city.fresh.size > 1 ? 's' : ''} came in. Want the rundown?` : null,
      city.brief ? `Today: ${city.brief.headline}` : null,
      'Ask me anything about the city. I checked the potholes myself.',
    ].filter(Boolean) as string[];
    const show = setTimeout(() => setBubble(lines[0]), 2600);
    const hide = setTimeout(() => setBubble(null), 9000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [open, city.fresh.size, city.brief]);

  // a new report lands: he points at it, says so, and (voice on) tells you out loud
  const seenFresh = useRef(0);
  useEffect(() => {
    const n = city.fresh.size;
    if (n <= seenFresh.current) return;
    seenFresh.current = n;
    const newest = [...city.fresh].map((id) => city.byId.get(id)).filter(Boolean).pop();
    if (!newest) return;
    const line = `New report: ${category(newest.category).label.toLowerCase()} at ${street(newest.address)}.`;
    setGesture({ g: 'pointFeed', key: Date.now() });
    setTimeout(() => setGesture({ g: 'rest', key: Date.now() }), 2200);
    if (!open) {
      setBubble(line);
      setTimeout(() => setBubble(null), 7000);
    }
    if (voice && !busy) void speak(`${line} ${newest.title}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.fresh]);

  // open/close: the panel grows out of the corner he lives in
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (open) {
      gsap.set(el, { display: 'flex' });
      gsap.fromTo(el, { clipPath: 'circle(0% at 100% 100%)' }, { clipPath: 'circle(150% at 100% 100%)', duration: 0.7, ease: 'power3.inOut' });
      gsap.fromTo(el.querySelectorAll('.chat-anim'), { y: 16, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.5, delay: 0.25, ease: 'power3.out' });
      setTimeout(() => inputRef.current?.focus(), 350);
      setGesture({ g: 'reassure', key: Date.now() });
      setTimeout(() => setGesture({ g: 'rest', key: Date.now() }), 1600);
    } else if (getComputedStyle(el).display !== 'none') {
      gsap.to(el, { clipPath: 'circle(0% at 100% 100%)', duration: 0.45, ease: 'power3.in', onComplete: () => void gsap.set(el, { display: 'none' }) });
    }
  }, [open]);

  useEffect(() => {
    const s = scroller.current;
    if (s) s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  // "Ask Mamdani about this" from anywhere in the dashboard
  useEffect(() => {
    if (!city.prompt) return;
    setOpen(true);
    setTimeout(() => send(city.prompt!.text), 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.prompt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);

  const patch = (id: number, f: (m: Msg) => Msg) => setMsgs((l) => l.map((m) => (m.id === id ? f(m) : m)));

  function say(text: string) {
    if (voice) void speak(text);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    const user: Msg = { id: mid++, role: 'user', text: q, steps: [], sources: [], issues: [], done: true };
    const bot: Msg = { id: mid++, role: 'assistant', text: '', steps: [], sources: [], issues: [], done: false };
    const history = [...msgs, user].filter((m) => m.text).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((l) => [...l, user, bot]);
    setBusy(true);
    abort.current = new AbortController();
    let full = '';
    const on = (e: AgentEvent) => {
      switch (e.type) {
        case 'text':
          full += e.delta;
          setStreaming(true);
          patch(bot.id, (m) => ({ ...m, text: m.text + e.delta }));
          break;
        case 'tool':
          patch(bot.id, (m) => ({ ...m, steps: [...m.steps, e.label] }));
          break;
        case 'sources':
          patch(bot.id, (m) => ({ ...m, sources: [...m.sources, ...e.sources.filter((s) => !m.sources.some((x) => x.uri === s.uri))] }));
          break;
        case 'issues':
          patch(bot.id, (m) => ({ ...m, issues: [...new Set([...m.issues, ...e.ids])] }));
          break;
        case 'map':
          city.show(e.ids, e.label, 'highlight');
          patch(bot.id, (m) => ({ ...m, map: { ids: e.ids, label: e.label, mode: 'highlight' } }));
          setGesture({ g: 'pointFeed', key: Date.now() });
          break;
        case 'route':
          city.show(e.ids, e.label, 'route');
          patch(bot.id, (m) => ({ ...m, map: { ids: e.ids, label: e.label, mode: 'route' } }));
          go('map');
          break;
        case 'action':
          patch(bot.id, (m) => ({ ...m, action: { ids: e.ids, status: e.status, note: e.note, state: 'waiting' } }));
          break;
        case 'error':
          patch(bot.id, (m) => ({ ...m, error: e.message }));
          break;
        case 'done':
          patch(bot.id, (m) => ({ ...m, done: true }));
          break;
      }
    };
    try {
      await ask(history, { page, selectedIssueId: city.selectedId }, on, abort.current.signal);
      say(full);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') patch(bot.id, (m) => ({ ...m, error: 'I couldn’t reach the city record. Is the API running?' }));
    } finally {
      patch(bot.id, (m) => ({ ...m, done: true }));
      setBusy(false);
      setStreaming(false);
    }
  }

  const stop = () => {
    abort.current?.abort();
    stopVoice();
  };

  const reset = () => {
    stop();
    setMsgs([]);
    city.clearFocus();
  };

  return (
    <>
      <button
        ref={launcher}
        className={`dock-launch ${open ? 'hide' : ''}`}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setGesture({ g: 'proud', key: Date.now() })}
        onMouseLeave={() => setGesture({ g: 'rest', key: Date.now() })}
        aria-label="Ask Mamdani"
      >
        <span className="dock-sun" />
        <span className="dock-rings" />
        {!open && <MamdaniCanvas className="dock-canvas" framing="waist" behavior={behavior} gesture={gesture} analyser={analyser} />}
        <span className="dock-label">
          Ask Mamdani <kbd>Ctrl J</kbd>
        </span>
      </button>
      {bubble && !open && (
        <button className="dock-bubble" onClick={() => setOpen(true)}>
          {bubble}
        </button>
      )}

      <div className="chat" ref={panel} role="dialog" aria-label="Ask Mamdani">
        <header className="chat-head chat-anim">
          <img src="/mamdani-face.png" alt="" className="chat-face" />
          <div className="chat-title">
            <b>Mamdani</b>
            <span>
              <i className="live-dot" /> Gemini · grounded in Tiger Data + Google Search
            </span>
          </div>
          <button className={`icon-btn ghost ${voice ? 'on' : ''}`} onClick={() => setVoice((v) => !v)} aria-label={voice ? 'Mute Mamdani' : 'Let Mamdani speak'} title={voice ? 'Voice on' : 'Voice off'}>
            {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button className="icon-btn ghost" onClick={reset} aria-label="New conversation" title="New conversation">
            <RotateCcw size={16} />
          </button>
          <button className="icon-btn ghost" onClick={() => setOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="chat-scroll" ref={scroller}>
          {!msgs.length && (
            <div className="chat-hello chat-anim">
              <p className="hello-big">
                Hey, I’m Mamdani.
                <br />
                <span>What do you need to know about the city?</span>
              </p>
              <div className="hello-list">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m) => (m.role === 'user' ? <div key={m.id} className="msg me">{m.text}</div> : <Answer key={m.id} m={m} busy={!m.done} onConfirm={(st) => patch(m.id, (x) => ({ ...x, action: x.action && { ...x.action, state: st } }))} />))}
        </div>

        <div className="chat-stage">
          {open && <MamdaniCanvas className="chat-canvas" framing="waist" behavior={behavior} expression={expression} gesture={gesture} analyser={analyser} />}
        </div>

        <form
          className="composer chat-anim"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder="Ask about any street, crew, or work order…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          {busy || speaking ? (
            <button type="button" className="send stop" onClick={stop} aria-label="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="send" disabled={!input.trim()} aria-label="Send">
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      </div>
    </>
  );
}

function Answer({ m, busy, onConfirm }: { m: Msg; busy: boolean; onConfirm: (s: 'done' | 'dismissed') => void }) {
  const city = useCity();
  const refs = useMemo(() => m.issues.map((id) => city.byId.get(id)).filter(Boolean).slice(0, 4), [m.issues, city.byId]);
  return (
    <div className="msg bot">
      {m.steps.length > 0 && (
        <div className="steps">
          {m.steps.map((s, k) => (
            <span key={k} className="step">
              {busy && k === m.steps.length - 1 && !m.text ? <Loader size={12} className="spin" /> : <Check size={12} />}
              {s}
            </span>
          ))}
        </div>
      )}
      {!m.text && busy && !m.steps.length && (
        <div className="typing">
          <i />
          <i />
          <i />
        </div>
      )}
      {m.text && <Markdown text={m.text} open={city.open} />}
      {m.error && <p className="msg-err">{m.error}</p>}

      {m.action && (
        <div className={`action action-${m.action.state}`}>
          <div>
            <b>
              Move {m.action.ids.map((id) => `#${id}`).join(', ')} → {STATUS_SHORT[m.action.status]}
            </b>
            <span>{m.action.note}</span>
          </div>
          {m.action.state === 'waiting' ? (
            <div className="action-btns">
              <button
                className="btn small primary"
                onClick={() => {
                  void city.setStatus(m.action!.ids, m.action!.status, m.action!.note);
                  onConfirm('done');
                }}
              >
                <Check size={14} /> Confirm
              </button>
              <button className="btn small soft" onClick={() => onConfirm('dismissed')}>
                Not now
              </button>
            </div>
          ) : (
            <span className="action-state">{m.action.state === 'done' ? 'Done ✓' : 'Dismissed'}</span>
          )}
        </div>
      )}

      {m.map && (
        <button
          className="map-cta"
          onClick={() => {
            city.show(m.map!.ids, m.map!.label, m.map!.mode);
            go('map');
          }}
        >
          {m.map.mode === 'route' ? <RouteIcon size={14} /> : <MapPin size={14} />}
          {m.map.mode === 'route' ? 'Route' : 'On the map'}: {m.map.label}
        </button>
      )}

      {refs.length > 0 && m.done && (
        <div className="refs">
          {refs.map((i) => (
            <button key={i!.id} className="ref" onClick={() => city.open(i!.id)}>
              <i style={{ background: category(i!.category).color }} />
              <b className="mono">#{i!.id}</b>
              <span>{street(i!.address)}</span>
            </button>
          ))}
        </div>
      )}

      {m.sources.length > 0 && (
        <div className="sources">
          <Globe size={12} />
          {m.sources.map((s) => (
            <a key={s.uri} href={s.uri} target="_blank" rel="noreferrer">
              {s.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
