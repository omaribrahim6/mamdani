import { useEffect, useRef } from 'react';
import { PortraitStage, type Behavior, type Gesture } from '@mayor/portrait';
import type { Expression } from '@mayor/face';
import { registerMayorModel, type ModelKind } from '@mayor/models';
import suitUrl from '@models/mamdani-suit.mrig?url';
import constructionUrl from '@models/mamdani-construction.mrig?url';

// The real 3D Mamdani (Tripo model, rigged) living in the dashboard. Same character and rig as
// the phone app; here he watches your cursor, thinks while Gemini works and talks while it answers.

// the two generated models: the suit, and the construction outfit (hard hat, hi-vis vest)
const URLS: Record<ModelKind, string> = { suit: suitUrl, construction: constructionUrl };
const loading: Partial<Record<ModelKind, Promise<void>>> = {};
function loadModel(kind: ModelKind) {
  return (loading[kind] ??= fetch(URLS[kind])
    .then((r) => r.arrayBuffer())
    .then((b) => registerMayorModel(kind, b))
    .catch((e) => console.warn(`Mamdani ${kind} model did not load; using the procedural one`, e)));
}

class CommandStage extends PortraitStage {
  /** where the camera sits: y of the lens and its target, distance, field of view */
  shot([y, target, z, fov]: readonly [number, number, number, number]) {
    // the model stands a touch to his right of the origin; aim the lens at his middle
    this.camera.position.set(CENTER_X, y, z);
    this.camera.fov = fov;
    this.camera.lookAt(CENTER_X, target, 0);
    this.camera.updateProjectionMatrix();
  }
}

export interface MamdaniProps {
  behavior?: Behavior;
  expression?: Expression;
  gesture?: { g: Gesture; key: number } | null;
  /** follow the pointer with his head; 'always' keeps watching it instead of looking away when idle */
  follow?: boolean | 'always';
  /** his voice, so the mouth follows it */
  analyser?: AnalyserNode | null;
  /** framing: head & shoulders, or down to the waist */
  framing?: 'bust' | 'waist' | 'face';
  /** which Mamdani: the suit, or the construction outfit */
  outfit?: ModelKind;
  className?: string;
  onReady?: () => void;
}

const CENTER_X = -0.04;

const FRAMES: Record<NonNullable<MamdaniProps['framing']>, readonly [number, number, number, number]> = {
  face: [1.02, 1.0, 1.05, 22],
  bust: [0.98, 0.9, 1.9, 26],
  waist: [0.92, 0.8, 2.35, 28],
};

export function MamdaniCanvas({ behavior = 'watch', expression, gesture, follow = true, framing = 'bust', outfit = 'suit', analyser = null, className, onReady }: MamdaniProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<CommandStage | null>(null);

  useEffect(() => {
    const el = canvas.current!;
    let alive = true;
    const s = new CommandStage(el);
    stage.current = s;
    s.shot(FRAMES[framing]);
    void loadModel(outfit).then(() => {
      if (!alive) return;
      s.show(outfit);
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
    stage.current?.listen(analyser);
  }, [analyser]);

  useEffect(() => {
    if (gesture) stage.current?.gesture(gesture.g, 0.35);
  }, [gesture]);

  useEffect(() => {
    if (!follow) {
      stage.current?.aim(null);
      return;
    }
    let idle = 0;
    const rest: [number, number] = [-0.18, -0.35];
    const onMove = (e: PointerEvent) => {
      const r = canvas.current?.getBoundingClientRect();
      if (!r) return;
      // angle from his head to the pointer, so he looks right at it wherever it is on screen
      const hx = r.left + r.width / 2;
      const hy = r.top + r.height * 0.3;
      const reach = Math.max(420, r.width * 1.2);
      const yaw = Math.max(-0.75, Math.min(0.75, Math.atan2(e.clientX - hx, reach) * 1.15));
      const pitch = Math.max(-0.45, Math.min(0.4, Math.atan2(e.clientY - hy, reach) * 0.95));
      stage.current?.aim([pitch, yaw]);
      clearTimeout(idle);
      // in the corner he goes back to looking around after a while; on a big stage he keeps watching you
      if (follow !== 'always') idle = window.setTimeout(() => stage.current?.aim(rest), 4000);
    };
    stage.current?.aim(follow === 'always' ? [0.02, 0] : rest);
    addEventListener('pointermove', onMove);
    return () => {
      removeEventListener('pointermove', onMove);
      clearTimeout(idle);
    };
  }, [follow]);

  return <canvas ref={canvas} className={className} aria-hidden />;
}
