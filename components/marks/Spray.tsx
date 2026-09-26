'use client';

import { useId, useMemo } from 'react';

// Road-crew spray paint. A circle around the problem and a stencilled word beside it —
// exactly what a city inspector sprays on the asphalt next to a pothole.

function seeded(seed: number) {
  let s = seed || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** A hand-sprayed loop: wobbly radius, overshoots its start like a real flick of the can. */
function loopPath(cx: number, cy: number, rx: number, ry: number, seed: number) {
  const r = seeded(seed);
  const start = -Math.PI * 0.6 + r() * 0.4;
  const end = start + Math.PI * 2 + 0.35 + r() * 0.3;
  const n = 48;
  const pts: string[] = [];
  let wob = 0;
  for (let i = 0; i <= n; i++) {
    const t = start + ((end - start) * i) / n;
    wob += (r() - 0.5) * 0.05;
    wob *= 0.9;
    const grow = 1 + (i / n) * 0.07; // the loop drifts outward as the hand keeps going
    const x = cx + Math.cos(t) * rx * (1 + wob) * grow;
    const y = cy + Math.sin(t) * ry * (1 + wob) * grow;
    pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

export function SprayFilter({ id }: { id: string }) {
  return (
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d" />
      <feGaussianBlur in="d" stdDeviation="0.5" result="core" />
      <feGaussianBlur in="d" stdDeviation="5" result="halo" />
      <feComponentTransfer in="halo" result="mist">
        <feFuncA type="linear" slope="0.4" />
      </feComponentTransfer>
      <feMerge>
        <feMergeNode in="mist" />
        <feMergeNode in="core" />
      </feMerge>
    </filter>
  );
}

export interface SprayMarkProps {
  width: number;
  height: number;
  box: { x: number; y: number; w: number; h: number }; // pixels in this svg
  color: string;
  word: string;
  number?: number;
  seed?: number;
  drawn: boolean;
}

export function SprayMark({ width, height, box, color, word, number, seed = 11, drawn }: SprayMarkProps) {
  const fid = useId().replace(/:/g, '');
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = Math.max(38, box.w * 0.62);
  const ry = Math.max(30, box.h * 0.62);
  const d = useMemo(() => loopPath(cx, cy, rx, ry, seed), [cx, cy, rx, ry, seed]);
  // label goes where there's room: above the loop unless it's near the top
  const labelAbove = cy - ry > 90;
  const lx = Math.min(width - 16, Math.max(16, cx - rx * 0.3));
  const ly = labelAbove ? cy - ry - 18 : cy + ry + 52;
  return (
    <svg className="spray" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <SprayFilter id={fid} />
      </defs>
      <g filter={`url(#${fid})`} stroke={color} fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          d={d}
          strokeWidth={7}
          pathLength={1}
          strokeDasharray={1}
          style={{ strokeDashoffset: drawn ? 0 : 1, transition: 'stroke-dashoffset 0.9s cubic-bezier(.5,.05,.3,1)' }}
        />
      </g>
      <g
        filter={`url(#${fid})`}
        fill={color}
        style={{ opacity: drawn ? 1 : 0, transition: 'opacity .25s 0.8s' }}
        transform={`rotate(-5 ${lx} ${ly})`}
      >
        <text x={lx} y={ly} className="stencil" style={{ fontSize: 44, fontFamily: 'var(--stencil)', fontWeight: 900 }}>
          {word}
          {number != null && (
            <tspan dx={12} style={{ fontSize: 30 }}>
              {number}
            </tspan>
          )}
        </text>
      </g>
    </svg>
  );
}
