import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { tip } from '../components/ui';
import { useSize } from './useSize';

// The resolution pipeline: how many issues reach each stage, as hatched columns stepping down,
// with the drop between stages drawn as a ramp. Hover a stage for its conversion and drop-off.

export interface Stage {
  label: string;
  value: number;
  note?: string;
}

export function Funnel({ stages, height = 250 }: { stages: Stage[]; height?: number }) {
  const [box, { w }] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const top = 64;
  const bottom = height;
  const n = stages.length;
  const colW = n ? w / n : 0;
  const max = Math.max(1, ...stages.map((s) => s.value));
  const yOf = (v: number) => bottom - ((bottom - top - 14) * v) / max;
  const barW = colW * 0.62;

  useLayoutEffect(() => {
    if (!svg.current || !w) return;
    gsap.fromTo(svg.current.querySelectorAll('.fn-grow'), { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 1, ease: 'power4.out', stagger: 0.08 });
    gsap.fromTo(svg.current.querySelectorAll('.fn-ramp'), { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.5, stagger: 0.08 });
  }, [w, stages.map((s) => s.value).join()]);

  return (
    <div ref={box} className="fn" style={{ height }}>
      {w > 0 && (
        <svg ref={svg} width={w} height={height} onMouseLeave={() => (setHover(null), tip.hide())}>
          <defs>
            <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" className="fn-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="7" className="fn-hatch-line" />
            </pattern>
            <linearGradient id="fn-solid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--hatch)" stopOpacity="0.95" />
              <stop offset="1" stopColor="var(--hatch)" stopOpacity="0.55" />
            </linearGradient>
            <linearGradient id="fn-ramp" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--hatch)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--hatch)" stopOpacity="0.06" />
            </linearGradient>
          </defs>
          {stages.map((s, k) => {
            const x0 = k * colW;
            const bx = x0 + (colW - barW) / 2;
            const y = yOf(s.value);
            const next = stages[k + 1];
            const conv = k > 0 && stages[k - 1].value ? Math.round((s.value / stages[k - 1].value) * 100) : null;
            return (
              <g
                key={s.label}
                className={`fn-col ${hover === k ? 'on' : ''}`}
                onMouseMove={(e) => {
                  setHover(k);
                  tip.show(
                    e,
                    <>
                      <div className="tip-title">{s.label}</div>
                      <div className="tip-row">
                        <span className="tip-key">Issues</span>
                        <b>{s.value}</b>
                      </div>
                      {conv != null && (
                        <>
                          <div className="tip-row">
                            <span className="tip-key">Conversion</span>
                            <b>{conv}%</b>
                          </div>
                          <div className="tip-row">
                            <span className="tip-key">Drop-off</span>
                            <b>{conv - 100}%</b>
                          </div>
                        </>
                      )}
                      {s.note && <div className="tip-note">{s.note}</div>}
                    </>,
                  );
                }}
              >
                <rect x={x0} y={0} width={colW} height={height} className="fn-hit" />
                {k > 0 && <line x1={x0} x2={x0} y1={0} y2={height} className="fn-sep" />}
                <text x={x0 + 14} y={18} className="fn-label">
                  {s.label}
                </text>
                <text x={x0 + 14} y={46} className="fn-value">
                  {s.value}
                </text>
                {next && (
                  <polygon
                    className="fn-ramp"
                    points={`${bx + barW},${y} ${x0 + colW + (colW - barW) / 2},${yOf(next.value)} ${x0 + colW + (colW - barW) / 2},${bottom} ${bx + barW},${bottom}`}
                    fill="url(#fn-ramp)"
                  />
                )}
                <g className="fn-grow">
                  <rect x={bx} y={y} width={barW} height={bottom - y} rx={6} fill={hover === k ? 'url(#fn-solid)' : 'url(#hatch)'} className="fn-bar" />
                  <rect x={bx + barW / 2 - 12} y={y - 3} width={24} height={6} rx={3} className="fn-cap" />
                </g>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
