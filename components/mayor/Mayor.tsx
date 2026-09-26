'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { MayorStage, type PerformOpts } from './stage';
import type { MayorOutfit } from './build';

export interface MayorHandle {
  perform(outfit: MayorOutfit, o: PerformOpts): Promise<void>;
  speaking(on: boolean): void;
  listen(a: AnalyserNode | null): void;
  clear(): void;
  headScreen(): { x: number; y: number } | null;
}

/** Full-size transparent canvas; put it over the photo. */
export const Mayor = forwardRef<MayorHandle, { className?: string }>(function Mayor({ className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<MayorStage | null>(null);

  useEffect(() => {
    const s = new MayorStage(canvas.current!);
    stage.current = s;
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __mayor?: MayorStage }).__mayor = s;
    const ro = new ResizeObserver(() => s.resize());
    ro.observe(canvas.current!);
    return () => {
      ro.disconnect();
      s.dispose();
      stage.current = null;
    };
  }, []);

  useImperativeHandle(ref, () => ({
    perform: (outfit, o) => stage.current?.perform(outfit, o) ?? Promise.resolve(),
    speaking: (on) => stage.current?.speaking(on),
    listen: (a) => stage.current?.listen(a),
    clear: () => stage.current?.clear(),
    headScreen: () => stage.current?.headScreen() ?? null,
  }));

  return <canvas ref={canvas} className={className} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />;
});
