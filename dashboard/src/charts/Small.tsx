import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { tip } from '../components/ui';

// Small marks for stat tiles and side panels.

/** A tiny dot histogram (one column per bucket), with the peak picked out and labelled. */
export function MiniDots({ values, labels, color = 'var(--accent)', unit = '' }: { values: number[]; labels: string[]; color?: string; unit?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...values);
  const rows = 5;
  const peak = values.indexOf(Math.max(...values));
  useLayoutEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current.querySelectorAll('i'), { scale: 0 }, { scale: 1, duration: 0.4, stagger: 0.012, ease: 'back.out(3)' });
  }, [values.join()]);
  return (
    <div className="minidots" ref={ref}>
      {values[peak] > 0 && (
        <span className="minidots-peak" style={{ left: `${((peak + 0.5) / values.length) * 100}%` }}>
          Peak: <b>{labels[peak]}</b>
        </span>
      )}
      <div className="minidots-cols">
        {values.map((v, k) => {
          const on = Math.round((v / max) * rows);
          return (
            <div
              key={k}
              className="minidots-col"
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <div className="tip-row">
                    <span className="tip-key">{labels[k]}</span>
                    <b>
                      {v}
                      {unit}
                    </b>
                  </div>,
                )
              }
              onMouseLeave={tip.hide}
            >
              {Array.from({ length: rows }, (_, j) => (
                <i key={j} style={{ background: j < on ? (k === peak ? color : `color-mix(in srgb, ${color} 45%, var(--panel))`) : 'var(--chart-grid)' }} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Transcope's fleet bars: a row of thin ticks, filled up to the share. */
export function TickBar({ share, color = 'var(--ink)' }: { share: number; color?: string }) {
  const ticks = 28;
  const on = Math.round(share * ticks);
  return (
    <span className="tickbar" aria-hidden>
      {Array.from({ length: ticks }, (_, k) => (
        <i key={k} style={{ background: k < on ? color : undefined, transitionDelay: `${k * 12}ms` }} className={k < on ? 'on' : ''} />
      ))}
    </span>
  );
}
