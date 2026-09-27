import { useEffect, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import type { Issue, Status } from '@shared/types';
import { sla } from '@shared/sla';
import { category, hours, ICON, STATUS_SHORT } from '../lib/format';

// ── one floating tooltip for the whole dashboard ──

type TipState = { x: number; y: number; content: ReactNode } | null;
let setTipGlobal: ((t: TipState) => void) | null = null;

export const tip = {
  show(e: { clientX: number; clientY: number }, content: ReactNode) {
    setTipGlobal?.({ x: e.clientX, y: e.clientY, content });
  },
  hide() {
    setTipGlobal?.(null);
  },
};

export function TipLayer() {
  const [t, set] = useState<TipState>(null);
  const [last, setLast] = useState<TipState>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTipGlobal = (v) => {
      set(v);
      if (v) setLast(v);
    };
    return () => {
      setTipGlobal = null;
    };
  }, []);
  const shown = t ?? last;
  let left = (shown?.x ?? 0) + 16;
  let top = (shown?.y ?? 0) + 16;
  const el = ref.current;
  if (el && shown) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (left + w > innerWidth - 12) left = shown.x - w - 16;
    if (top + h > innerHeight - 12) top = shown.y - h - 16;
  }
  return (
    <div ref={ref} className={`tip ${t ? 'on' : ''}`} style={{ left, top }} role="tooltip">
      {shown?.content}
    </div>
  );
}

// ── a number that counts to its value ──

export function Counter({ value, decimals = 0, prefix = '', suffix = '', duration = 1.1 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  useEffect(() => {
    const o = { v: from.current };
    const tw = gsap.to(o, {
      v: value,
      duration,
      ease: 'power3.out',
      onUpdate: () => {
        if (ref.current) ref.current.textContent = prefix + o.v.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
      },
    });
    from.current = value;
    return () => {
      tw.kill();
    };
  }, [value, decimals, prefix, suffix, duration]);
  return (
    <span ref={ref} className="num">
      {prefix}0{suffix}
    </span>
  );
}

export function StatusLabel({ status }: { status: Status }) {
  return (
    <span className="status" data-s={status}>
      <i />
      {STATUS_SHORT[status]}
    </span>
  );
}

export function CategoryIcon({ id, size = 16 }: { id: Issue['category']; size?: number }) {
  const Icon = ICON[id];
  const c = category(id);
  return (
    <span className="cat-ico" style={{ ['--c' as string]: c.color }} title={c.label}>
      <Icon size={size} strokeWidth={1.8} />
    </span>
  );
}

export function PriorityMeter({ value }: { value: number }) {
  const v = Math.round(value);
  const tone = v >= 70 ? 'hot' : v >= 45 ? 'warm' : 'cool';
  return (
    <span className={`prio prio-${tone}`}>
      <span className="prio-bars" aria-hidden>
        {Array.from({ length: 10 }, (_, k) => (
          <i key={k} className={k < Math.round(v / 10) ? 'on' : ''} />
        ))}
      </span>
      <b className="num">{v}</b>
    </span>
  );
}

export function SlaChip({ issue, now = Date.now() }: { issue: Issue; now?: number }) {
  const s = sla(issue, now);
  if (issue.status === 'resolved') return <span className={`chip ${s.state === 'met' ? 'good' : 'bad'}`}>{s.state === 'met' ? 'On time' : 'Late'}</span>;
  const label = s.state === 'breached' ? `${hours(-s.left)} late` : `${hours(s.left)} left`;
  return <span className={`sla sla-${s.state}`}>{label}</span>;
}
