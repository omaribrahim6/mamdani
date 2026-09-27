import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { tip } from '../components/ui';
import { useSize } from './useSize';

// The analytics page's larger charts.

/**
 * Stepped columns (LoadLogic's fulfilment chart): soft columns fading to the floor, a black step
 * line along their tops, and the hovered (or latest) column drawn solid with its label.
 */
export function StepBars({ data, height = 260, format = (v: number) => String(v) }: { data: Array<{ t: number; v: number; label: string }>; height?: number; format?: (v: number) => string }) {
  const [box, { w }] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const padR = 40;
  const top = 26;
  const bottom = height - 22;
  const n = data.length;
  const colW = n ? (w - padR) / n : 0;
  const max = Math.max(1, ...data.map((d) => d.v)) * 1.1;
  const yOf = (v: number) => bottom - ((bottom - top) * v) / max;
  const active = hover ?? n - 1;
  const step = data.map((d, k) => `${k ? 'L' : 'M'}${k * colW},${yOf(d.v)} L${(k + 1) * colW},${yOf(d.v)}`).join(' ');

  useLayoutEffect(() => {
    if (!svg.current || !w) return;
    gsap.fromTo(svg.current.querySelectorAll('.sb-col'), { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.9, stagger: 0.015, ease: 'power3.out' });
    const line = svg.current.querySelector<SVGPathElement>('.sb-line');
    if (line) {
      const len = line.getTotalLength();
      gsap.fromTo(line, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.6, ease: 'power2.inOut', delay: 0.2 });
    }
  }, [w, n]);

  return (
    <div ref={box} style={{ height }}>
      {w > 0 && (
        <svg ref={svg} width={w} height={height} onMouseLeave={() => (setHover(null), tip.hide())}>
          <defs>
            <linearGradient id="sb-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--ink)" stopOpacity="0.14" />
              <stop offset="1" stopColor="var(--ink)" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={0} x2={w - padR} y1={yOf(max * f / 1.1)} y2={yOf(max * f / 1.1)} className="grid-line" />
              <text x={w - padR + 8} y={yOf(max * f / 1.1) + 4} className="axis">
                {format(Math.round((max * f) / 1.1))}
              </text>
            </g>
          ))}
          {data.map((d, k) => (
            <g
              key={d.t}
              onMouseMove={(e) => {
                setHover(k);
                tip.show(
                  e,
                  <>
                    <div className="tip-title">{d.label}</div>
                    <div className="tip-row">
                      <span className="tip-key">Open backlog</span>
                      <b>{format(d.v)}</b>
                    </div>
                  </>,
                );
              }}
            >
              <rect x={k * colW} y={0} width={colW} height={height} fill="transparent" />
              <rect className="sb-col" x={k * colW + 1} y={yOf(d.v)} width={Math.max(1, colW - 2)} height={bottom - yOf(d.v)} fill={k === active ? 'var(--ink)' : 'url(#sb-fill)'} rx={2} />
            </g>
          ))}
          <path className="sb-line" d={step} fill="none" stroke="var(--ink)" strokeWidth={2} />
          {data[active] && (
            <g>
              <text x={active * colW + colW / 2} y={yOf(data[active].v) - 8} textAnchor="middle" className="sb-label">
                {data[active].label}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/** Weekday × hour grid, one hue light to dark. */
export function Heatmap({ grid, rows, cols }: { grid: number[][]; rows: string[]; cols: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...grid.flat());
  useLayoutEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current.querySelectorAll('.hm-cell'), { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, stagger: { each: 0.002, grid: [rows.length, cols.length], from: 'start' } });
  }, [rows.length, cols.length]);
  return (
    <div className="hm" ref={ref}>
      {grid.map((row, r) => (
        <div key={r} className="hm-row">
          <span className="hm-label">{rows[r]}</span>
          {row.map((v, c) => (
            <i
              key={c}
              className="hm-cell"
              style={{ background: v ? `color-mix(in srgb, var(--accent) ${Math.round(12 + (v / max) * 88)}%, var(--panel-2))` : 'var(--panel-2)' }}
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <div className="tip-row">
                    <span className="tip-key">
                      {rows[r]} {cols[c]}
                    </span>
                    <b>{v} reports</b>
                  </div>,
                )
              }
              onMouseLeave={tip.hide}
            />
          ))}
        </div>
      ))}
      <div className="hm-row hm-axis">
        <span className="hm-label" />
        {cols.map((c, k) => (
          <span key={k}>{k % 3 === 0 ? c : ''}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * LoadLogic's stacked blocks: one column per group, stacked segments with gaps, the total above,
 * and a ribbon joining neighbouring columns.
 */
export function StackBlocks({ columns, keys }: { columns: Array<{ label: string; parts: number[] }>; keys: Array<{ label: string; color: string }> }) {
  const [box, { w }] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const height = 260;
  const top = 34;
  const bottom = height - 26;
  const n = columns.length;
  const slot = n ? w / n : 0;
  const colW = Math.min(96, slot * 0.56);
  const totals = columns.map((c) => c.parts.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  const unit = (bottom - top) / max;

  useLayoutEffect(() => {
    if (!svg.current || !w) return;
    gsap.fromTo(svg.current.querySelectorAll('.blk'), { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.7, stagger: 0.04, ease: 'back.out(1.4)' });
  }, [w, n]);

  return (
    <div ref={box} style={{ height }}>
      {w > 0 && (
        <svg ref={svg} width={w} height={height}>
          {columns.map((c, k) => {
            const x = k * slot + (slot - colW) / 2;
            const next = columns[k + 1];
            const h = totals[k] * unit;
            const nx = (k + 1) * slot + (slot - colW) / 2;
            const nh = next ? totals[k + 1] * unit : 0;
            let y = bottom;
            return (
              <g key={c.label}>
                {next && <polygon points={`${x + colW},${bottom - h} ${nx},${bottom - nh} ${nx},${bottom} ${x + colW},${bottom}`} className="ribbon" />}
                <text x={x + colW / 2} y={bottom - h - 10} textAnchor="middle" className="blk-total">
                  {totals[k]}
                </text>
                {c.parts.map((v, j) => {
                  if (!v) return null;
                  const bh = v * unit;
                  y -= bh;
                  return (
                    <rect
                      key={j}
                      className="blk"
                      x={x}
                      y={y + 1.5}
                      width={colW}
                      height={Math.max(2, bh - 3)}
                      rx={6}
                      fill={keys[j].color}
                      onMouseMove={(e) =>
                        tip.show(
                          e,
                          <>
                            <div className="tip-title">{c.label}</div>
                            <div className="tip-row">
                              <span className="tip-key">
                                <i style={{ background: keys[j].color }} />
                                {keys[j].label}
                              </span>
                              <b>{v}</b>
                            </div>
                          </>,
                        )
                      }
                      onMouseLeave={tip.hide}
                    />
                  );
                })}
                <text x={x + colW / 2} y={height - 6} textAnchor="middle" className="axis">
                  {c.label.length > 16 ? c.label.slice(0, 15) + '…' : c.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
