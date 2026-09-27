import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import type { ActivityPoint } from '@shared/types';
import type { CategoryId } from '@shared/categories';
import { category } from '../lib/format';
import { tip } from '../components/ui';
import { useSize } from './useSize';

// Resident reports per hour as columns of dots (one dot = one report, or a few when it's busy),
// then the next hours projected from the same hours over the past week. Hover a column for the
// breakdown; the guide line runs to the axis like a reading on a gauge.

const H = 3600e3;

export interface HourBucket {
  t: number;
  count: number;
  projected: boolean;
  cats: Partial<Record<CategoryId, number>>;
}

export function hourly(points: ActivityPoint[], now: number, past = 36, ahead = 12): HourBucket[] {
  const start = Math.floor(now / H) * H - (past - 1) * H;
  const buckets: HourBucket[] = Array.from({ length: past }, (_, k) => ({ t: start + k * H, count: 0, projected: false, cats: {} }));
  const byHourOfDay = new Array(24).fill(0);
  let weekStart = now;
  for (const p of points) {
    weekStart = Math.min(weekStart, p.t);
    byHourOfDay[new Date(p.t).getHours()]++;
    const k = Math.floor((p.t - start) / H);
    if (k >= 0 && k < past) {
      buckets[k].count++;
      buckets[k].cats[p.category] = (buckets[k].cats[p.category] ?? 0) + 1;
    }
  }
  const days = Math.max(1, (now - weekStart) / (24 * H));
  for (let k = 1; k <= ahead; k++) {
    const t = start + (past - 1 + k) * H;
    buckets.push({ t, count: Math.round(byHourOfDay[new Date(t).getHours()] / days), projected: true, cats: {} });
  }
  return buckets;
}

export function DotMatrix({ data, height = 250 }: { data: HourBucket[]; height?: number }) {
  const [box, { w }] = useSize<HTMLDivElement>();
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const padL = 34;
  const padB = 26;
  const innerW = Math.max(0, w - padL - 4);
  const innerH = height - padB - 8;
  const n = data.length;
  const step = n ? innerW / n : 0;
  const r = Math.max(2, Math.min(7, step * 0.36));
  const rows = Math.max(4, Math.floor(innerH / (r * 2 + 3)));
  const max = Math.max(1, ...data.map((d) => d.count));
  const per = Math.max(1, Math.ceil(max / rows)); // reports per dot
  const ticks = [0, Math.round((max / 2) / per) * per, Math.ceil(max / per) * per];
  const yOf = (v: number) => 8 + innerH - (v / per) * (r * 2 + 3) - r;
  const nowIdx = data.findIndex((d) => d.projected) - 1;

  const cols = useMemo(
    () =>
      data.map((d, k) => {
        const dots = Math.ceil(d.count / per);
        return { d, k, x: padL + step * k + step / 2, dots };
      }),
    [data, per, step],
  );

  useLayoutEffect(() => {
    if (!svg.current || !w) return;
    const dots = svg.current.querySelectorAll('.dm-dot');
    gsap.fromTo(dots, { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.5, ease: 'back.out(2.2)', stagger: { each: 0.0025, from: 'start' } });
  }, [w, data.length]);

  const hov = hover != null ? cols[hover] : null;

  return (
    <div ref={box} className="dm" style={{ height }}>
      {w > 0 && (
        <svg ref={svg} width={w} height={height} onMouseLeave={() => (setHover(null), tip.hide())}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w} y1={yOf(t) + r} y2={yOf(t) + r} className="grid-line" />
              <text x={0} y={yOf(t) + r + 4} className="axis">
                {t}
              </text>
            </g>
          ))}
          {cols.map(({ d, k, x, dots }) => (
            <g
              key={d.t}
              className={`dm-col ${d.projected ? 'proj' : ''} ${hover === k ? 'on' : ''} ${hover != null && hover !== k ? 'off' : ''}`}
              onMouseMove={(e) => {
                setHover(k);
                const top = Object.entries(d.cats)
                  .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                  .slice(0, 3);
                tip.show(
                  e,
                  <>
                    <div className="tip-title">
                      {new Date(d.t).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric' })}
                      {d.projected ? ' · projected' : ''}
                    </div>
                    <div className="tip-row">
                      <span className="tip-key">{d.projected ? 'Expected reports' : 'Resident reports'}</span>
                      <b>{d.count}</b>
                    </div>
                    {top.map(([c, v]) => (
                      <div className="tip-row" key={c}>
                        <span className="tip-key">
                          <i style={{ background: category(c).color }} />
                          {category(c).label}
                        </span>
                        <b>{v}</b>
                      </div>
                    ))}
                  </>,
                );
              }}
            >
              <rect x={x - step / 2} y={0} width={step} height={height - padB} fill="transparent" />
              {Array.from({ length: Math.max(dots, 1) }, (_, j) => (
                <circle key={j} className={`dm-dot ${dots === 0 ? 'ghost' : ''}`} cx={x} cy={yOf(j * per)} r={r} />
              ))}
            </g>
          ))}
          {nowIdx >= 0 && (
            <g className="dm-now">
              <line x1={cols[nowIdx].x + step / 2} x2={cols[nowIdx].x + step / 2} y1={4} y2={height - padB} />
              <text x={cols[nowIdx].x + step / 2 + 6} y={14}>
                now
              </text>
            </g>
          )}
          {hov && (
            <g className="dm-guide">
              <line x1={padL} x2={hov.x} y1={yOf(Math.max(0, hov.dots - 1) * per)} y2={yOf(Math.max(0, hov.dots - 1) * per)} />
              <rect x={padL - 30} y={yOf(Math.max(0, hov.dots - 1) * per) - 10} width={30} height={20} rx={6} />
              <text x={padL - 15} y={yOf(Math.max(0, hov.dots - 1) * per) + 4} textAnchor="middle">
                {hov.d.count}
              </text>
            </g>
          )}
          {cols
            .filter((c) => new Date(c.d.t).getHours() % 6 === 0)
            .map((c) => (
              <text key={c.d.t} x={c.x} y={height - 6} textAnchor="middle" className={`axis ${hover === c.k ? 'strong' : ''}`}>
                {new Date(c.d.t).getHours() === 0 ? new Date(c.d.t).toLocaleDateString('en-CA', { weekday: 'short' }) : new Date(c.d.t).toLocaleTimeString('en-CA', { hour: 'numeric' })}
              </text>
            ))}
        </svg>
      )}
    </div>
  );
}
