import * as THREE from 'three';
import { RigStage } from './engine';
import { loadMascot } from './load';
import { createMayor } from './models';

// The sidebar's "Mayor's briefing" card: Mamdani head-and-shoulders, turning to follow the
// operator's cursor, blinking, and mouthing the briefing line when it changes. Built on the
// same RigStage as the phone's portrait window, so he moves the same way everywhere.
export class BriefingPortrait extends RigStage {
  private gaze = new THREE.Vector2();
  private target = new THREE.Vector2();
  private talkUntil = 0;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas, { fov: 22, shadows: false });
    this.camera.position.set(0.05, 0.98, 2.35);
    this.camera.lookAt(0, 0.86, 0);
    const rim = new THREE.DirectionalLight(0x9fc3ef, 1.6);
    rim.position.set(-2, 1.6, -1.5);
    this.scene.add(rim);
    addEventListener('pointermove', this.onMove, { passive: true });
    void loadMascot().then(() => { this.setRig(createMayor('suit')); this.resize(); });
    this.start();
  }

  private onMove = (e: PointerEvent) => {
    const b = this.surface.canvas.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height * 0.35;
    this.target.set(THREE.MathUtils.clamp((e.clientX - cx) / 700, -1, 1), THREE.MathUtils.clamp((e.clientY - cy) / 500, -1, 1));
  };

  /** He mouths a line for roughly as long as it would take to say it. */
  say(text: string) {
    this.talkUntil = performance.now() + Math.min(6000, 400 + text.length * 55);
    this.speaking(true);
  }

  protected update(dt: number, now: number) {
    const rig = this.rig;
    if (!rig) return;
    if (this.talkUntil && now > this.talkUntil) { this.talkUntil = 0; this.speaking(false); }
    this.gaze.lerp(this.target, Math.min(1, dt * 4));
    rig.head.rotation.y = this.gaze.x * 0.55;
    rig.head.rotation.x = this.gaze.y * 0.25;
    rig.body.rotation.y = this.gaze.x * 0.12;
    rig.body.position.y = Math.sin(now / 900) * 0.004;
    rig.armL.rotation.x = 0.05 + Math.sin(now / 1100) * 0.02;
    rig.armR.rotation.x = 0.05 + Math.sin(now / 1100 + 1) * 0.02;
  }

  dispose() {
    removeEventListener('pointermove', this.onMove);
    super.dispose();
    this.renderer.forceContextLoss();
  }
}
