import { useEffect, useRef } from 'react';
import { PortraitStage, type Behavior, type Gesture } from '@mayor/portrait';
import type { Expression } from '@mayor/face';
import { registerMayorModel } from '@mayor/models';
import suitUrl from '@models/mamdani-suit.mrig?url';

// The real 3D Mamdani (Tripo model, rigged) living in the dashboard. Same character and rig as
// the phone app; here he watches your cursor, thinks while Gemini works and talks while it answers.

let loading: Promise<void> | null = null;
function loadModel() {
  return (loading ??= fetch(suitUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => registerMayorModel('suit', b))
    .catch((e) => console.warn('Mamdani model did not load; using the procedural one', e)));
}

class CommandStage extends PortraitStage {
  /** where the camera sits: y of the lens and its target, distance, field of view */
  shot([y, target, z, fov]: readonly [number, number, number, number]) {
    this.camera.position.set(0, y, z);
    this.camera.fov = fov;
    this.camera.lookAt(0, target, 0);
    this.camera.updateProjectionMatrix();
  }
}

export interface MamdaniProps {
  behavior?: Behavior;
  expression?: Expression;
  gesture?: { g: Gesture; key: number } | null;
  /** follow the pointer with his head */
  follow?: boolean;
  /** framing: head & shoulders, or down to the waist */
  framing?: 'bust' | 'waist' | 'face';
  className?: string;
  onReady?: () => void;
}

const FRAMES: Record<NonNullable<MamdaniProps['framing']>, readonly [number, number, number, number]> = {
  face: [1.02, 1.0, 1.05, 22],
  bust: [0.98, 0.9, 1.9, 26],
  waist: [0.92, 0.8, 2.35, 28],
};

export function MamdaniCanvas({ behavior = 'watch', expression, gesture, follow = true, framing = 'bust', className, onReady }: MamdaniProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<CommandStage | null>(null);

  useEffect(() => {
    const el = canvas.current!;
    let alive = true;
    const s = new CommandStage(el);
    stage.current = s;
    s.shot(FRAMES[framing]);
    void loadModel().then(() => {
      if (!alive) return;
      s.show('suit');
      s.act('watch');
      onReady?.();
    });
    const ro = new ResizeObserver(() => s.resize());
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
      s.dispose();
      stage.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage.current?.shot(FRAMES[framing]);
  }, [framing]);

  useEffect(() => {
    stage.current?.act(behavior);
  }, [behavior]);

  useEffect(() => {
    if (expression) stage.current?.expression(expression);
  }, [expression]);

  useEffect(() => {
    if (gesture) stage.current?.gesture(gesture.g, 0.35);
  }, [gesture]);

  useEffect(() => {
    if (!follow) {
      stage.current?.aim(null);
      return;
    }
    let idle = 0;
    const onMove = (e: PointerEvent) => {
      const r = canvas.current?.getBoundingClientRect();
      if (!r) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.3;
      const yaw = Math.max(-0.7, Math.min(0.7, ((e.clientX - cx) / innerWidth) * 1.4));
      const pitch = Math.max(-0.45, Math.min(0.35, ((e.clientY - cy) / innerHeight) * 0.9));
      stage.current?.aim([pitch, yaw]);
      clearTimeout(idle);
      // after a while without movement he goes back to looking around on his own
      idle = window.setTimeout(() => stage.current?.aim([-0.18, -0.35]), 4000);
    };
    stage.current?.aim([-0.18, -0.35]);
    addEventListener('pointermove', onMove);
    return () => {
      removeEventListener('pointermove', onMove);
      clearTimeout(idle);
    };
  }, [follow]);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
