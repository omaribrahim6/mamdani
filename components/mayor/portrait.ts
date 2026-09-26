import * as THREE from 'three';
import type { MayorOutfit } from './build';
import { ease, lerp, RigStage, type StageSurface } from './engine';
import { createMayor } from './models';

// Mamdani in his little round window: head and shoulders, alive while the camera is up.
// He watches the feed, glances at the shutter when you touch it, thinks while the report is
// processed, talks, and — when the report is ready — walks out of frame to the left.

export type Gaze = 'feed' | 'shutter' | 'you' | 'away';
export type Behavior = 'watch' | 'listen' | 'think' | 'talk';

// head pitch (+ = down) and yaw (+ = toward screen right) for each place he can look.
// The window sits bottom-left, so the camera feed is up and to his right.
const GAZE: Record<Gaze, [number, number]> = {
  feed: [-0.32, 0.3],
  shutter: [0.2, 0.55],
  you: [-0.02, 0.08],
  away: [-0.15, -0.5],
};

export class PortraitStage extends RigStage {
  private gaze: Gaze = 'feed';
  private behavior: Behavior = 'watch';
  private pitch = GAZE.feed[0];
  private yaw = GAZE.feed[1];
  private glanceUntil = 0;
  private saccade = { at: 0, dx: 0, dy: 0 };
  private present = false; // false while he's out of the window
  private outfit: MayorOutfit = 'suit';

  constructor(target: HTMLCanvasElement | StageSurface) {
    super(target, { fov: 26, shadows: false });
    this.camera.position.set(0, 0.9, 1.95);
    this.camera.lookAt(0, 0.86, 0);
    this.start();
  }

  /** Put him in the window, standing, looking at the feed. */
  show(outfit: MayorOutfit = 'suit') {
    this.outfit = outfit;
    const rig = createMayor(outfit);
    rig.flag.removeFromParent();
    this.setRig(rig);
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.y = 0;
    this.present = true;
  }

  look(g: Gaze, holdMs = 0) {
    this.gaze = g;
    this.glanceUntil = holdMs ? performance.now() + holdMs : 0;
  }

  act(b: Behavior) {
    this.behavior = b;
    this.speaking(b === 'talk');
    if (b === 'talk') this.look('you');
    else if (b === 'watch' || b === 'listen') this.look('feed');
  }

  /** Changes into the outfit the job needs, with a little pop, before heading out. */
  async suitUp(outfit: MayorOutfit) {
    if (!this.rig || outfit === this.outfit) return;
    const rig = this.rig;
    await this.tween(0.12, (t) => rig.root.scale.set(1 + t * 0.12, 1 - t * 0.18, 1 + t * 0.12));
    this.show(outfit);
    const next = this.rig!;
    await this.tween(0.32, (t) => {
      const s = 1 + Math.sin(t * Math.PI) * 0.1 * (1 - t);
      next.root.scale.set(s, 2 - s, s);
    });
    next.root.scale.setScalar(1);
  }

  /** Looks where he's going, then walks out of the window to the left. */
  async exitLeft() {
    const rig = this.rig;
    if (!rig) return;
    this.look('away');
    await this.wait(0.28);
    this.present = false;
    await this.tween(0.22, (t) => {
      rig.root.rotation.y = lerp(0, -Math.PI / 2, ease(t));
      rig.head.rotation.set(0, 0, 0);
    });
    this.relaxArms();
    this.walking = 1;
    await this.tween(0.55, (t) => rig.root.position.set(lerp(0, -1.3, t * t), 0, 0));
    this.walking = 0;
    this.setRig(null);
  }

  /** Walks back into the window from the left and settles, watching the feed again. */
  async enterFromLeft(outfit: MayorOutfit = 'suit') {
    this.show(outfit);
    const rig = this.rig!;
    this.present = false;
    rig.root.position.set(-1.3, 0, 0);
    rig.root.rotation.y = Math.PI / 2;
    this.relaxArms();
    this.walking = 1;
    await this.tween(0.6, (t) => rig.root.position.set(lerp(-1.3, 0, 1 - (1 - t) ** 2), 0, 0));
    this.walking = 0;
    await this.tween(0.25, (t) => (rig.root.rotation.y = lerp(Math.PI / 2, 0, ease(t))));
    // hands back on hips
    await this.tween(0.25, (t) => {
      const e = ease(t);
      rig.armR.rotation.set(-0.1 * e, 0, lerp(-0.12, -0.8, e));
      rig.forearmR.rotation.set(-0.34 * e, 0, lerp(0, 1.5, e));
      rig.armL.rotation.set(-0.1 * e, 0, lerp(0.12, 0.8, e));
      rig.forearmL.rotation.set(-0.34 * e, 0, lerp(0, -1.5, e));
    });
    this.present = true;
    this.act('watch');
  }

  private relaxArms() {
    const rig = this.rig!;
    rig.armR.rotation.set(0, 0, -0.12);
    rig.forearmR.rotation.set(0, 0, 0);
    rig.armL.rotation.set(0, 0, 0.12);
    rig.forearmL.rotation.set(0, 0, 0);
  }

  protected update(dt: number, now: number) {
    const rig = this.rig;
    if (!rig || !this.present) return;
    const t = now / 1000;
    if (this.glanceUntil && now > this.glanceUntil) {
      this.glanceUntil = 0;
      this.gaze = this.behavior === 'talk' ? 'you' : 'feed';
    }
    let [p, y] = GAZE[this.gaze];

    // little eye darts while he watches, so he reads as looking at things, not frozen
    if (now > this.saccade.at) {
      this.saccade = { at: now + 600 + Math.random() * 1400, dx: (Math.random() - 0.5) * 0.22, dy: (Math.random() - 0.5) * 0.12 };
    }
    let nod = 0;
    let tilt = 0;
    let browLift = 0;
    let browFurrow = 0;
    switch (this.behavior) {
      case 'watch':
        y += this.saccade.dx;
        p += this.saccade.dy;
        break;
      case 'listen':
        // you're talking: small attentive nods
        y += this.saccade.dx * 0.4;
        nod = Math.max(0, Math.sin(t * 5.2)) * 0.07;
        browLift = 0.01;
        break;
      case 'think':
        // processing: eyes up and around, squint, slow nod
        p = -0.42 + Math.sin(t * 0.9) * 0.06;
        y = 0.1 + Math.sin(t * 0.7) * 0.35;
        tilt = Math.sin(t * 0.6) * 0.1;
        browFurrow = 0.25;
        break;
      case 'talk':
        nod = Math.sin(t * 3.1) * 0.04;
        tilt = Math.sin(t * 1.7) * 0.06;
        browLift = Math.max(0, Math.sin(t * 2.3)) * 0.012;
        break;
    }
    const k = Math.min(1, dt * (this.gaze === 'shutter' ? 14 : 7));
    this.pitch += (p - this.pitch) * k;
    this.yaw += (y - this.yaw) * k;
    // The generated model's eyes are painted on, so all of his looking is done by the head:
    // it turns further, and the shoulders follow more, than the procedural one's.
    const g = rig.headAnchor ? 1.05 : 1;
    rig.head.rotation.set((this.pitch + nod) * g, this.yaw * g, (0.08 + tilt) * (rig.headAnchor ? 1.2 : 1));
    // the body turns a little with the head
    rig.body.rotation.y = this.yaw * (rig.headAnchor ? 0.35 : 0.25);
    rig.body.position.y = Math.sin(t * 2.2) * 0.006;
    rig.browL.rotation.z = browFurrow;
    rig.browR.rotation.z = -browFurrow;
    rig.browL.position.y = rig.browR.position.y = 0.281 + browLift;
  }
}
