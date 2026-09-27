import * as THREE from 'three';
import type { MayorOutfit } from './build';
import { ease, lerp, RigStage, type StageSurface } from './engine';
import { createMayor } from './models';
import type { Expression } from './face';

// Mamdani in his little round window: head and shoulders, alive while the camera is up.
// He watches the feed, glances at the shutter when you touch it, thinks while the report is
// processed, talks, and — when the report is ready — walks out of frame to the left.

export type Gaze = 'feed' | 'shutter' | 'you' | 'away';
export type Behavior = 'watch' | 'listen' | 'think' | 'talk';

/** Hand poses he can strike while he talks, in the rig's control angles (see stage.ts). */
export type Gesture = 'reassure' | 'proud' | 'pointFeed' | 'rest';
/**
 * One beat of a scripted line, in seconds from when the audio starts. Strokes should land a little
 * before the stressed syllable they go with (the gesture leads the word, as animators time it).
 */
export interface SpeechCue {
  at: number;
  gesture?: Gesture;
  /** head nod, radians (+ = down); negative lifts the chin */
  nod?: number;
  /** a quick "no" shake */
  shake?: boolean;
  look?: Gaze;
  expr?: Expression;
}

type Pose = { armR: [number, number, number]; foreR: [number, number, number]; armL: [number, number, number]; foreL: [number, number, number] };
const POSE: Record<Gesture, Pose> = {
  // "worry not": right hand up in front of the chest, palm to you
  reassure: { armR: [-1.1, 0, -0.45], foreR: [-1.45, 0, 0.1], armL: [0, 0, 0.12], foreL: [0, 0, 0] },
  // "my finest engineers": right hand to his chest, left hand out, presenting
  proud: { armR: [-0.3, 0, 0.35], foreR: [-1.55, 0, 0.75], armL: [-0.75, 0, 0.5], foreL: [-0.55, 0, -0.25] },
  // "fix this": points up and out at the camera feed (screen right is his left)
  pointFeed: { armR: [0, 0, -0.12], foreR: [0, 0, 0], armL: [-1.85, 0, 0.5], foreL: [-0.12, 0, 0] },
  rest: { armR: [0, 0, -0.12], foreR: [0, 0, 0], armL: [0, 0, 0.12], foreL: [0, 0, 0] },
};

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
  // a scripted line: cues fire on the stage's own clock, so they stay locked to the audio's start
  private cues: SpeechCue[] = [];
  private cueClock = 0;
  private gestureToken = 0;
  private nodAmp = 0;
  private nodT = 9;
  private shakeT = 9;
  // an explicit place to look (pitch, yaw) that wins over the named gazes — the dashboard's
  // Mamdani follows the cursor with it
  private aimAt: [number, number] | null = null;

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

  /** Look at a point given as head pitch and yaw (radians), or null to go back to the named gazes. */
  aim(v: [number, number] | null) {
    this.aimAt = v;
  }

  look(g: Gaze, holdMs = 0) {
    this.gaze = g;
    this.glanceUntil = holdMs ? performance.now() + holdMs : 0;
  }

  act(b: Behavior) {
    // a scripted line owns his looks and expression while it runs
    if (b === 'talk' && this.cues.length) {
      this.behavior = b;
      this.speaking(true);
      return;
    }
    this.behavior = b;
    this.speaking(b === 'talk');
    this.expression(b === 'listen' ? 'LISTENING' : b === 'think' ? 'THINKING' : 'NEUTRAL');
    if (b === 'talk') this.look('you');
    else if (b === 'watch' || b === 'listen') this.look('feed');
  }

  /**
   * Perform a line whose audio starts now: hand gestures, nods and looks timed to its words.
   * The mouth still follows the audio itself; this is the body language around it.
   */
  speak(cues: SpeechCue[]) {
    this.act('talk');
    this.cues = [...cues].sort((a, b) => a.at - b.at);
    this.cueClock = 0;
    this.beatGain = 0.4; // the script carries the emphasis; keep the automatic nods small
  }

  /** Move the arms into a gesture; a newer gesture takes over mid-way. */
  gesture(g: Gesture, sec = 0.3) {
    const rig = this.rig;
    if (!rig) return;
    const token = ++this.gestureToken;
    const from = [rig.armR, rig.forearmR, rig.armL, rig.forearmL].map((c) => c.rotation.clone());
    const to = POSE[g];
    const targets = [to.armR, to.foreR, to.armL, to.foreL];
    void this.tween(sec, (t) => {
      if (token !== this.gestureToken || !this.rig) return;
      const e = ease(t);
      [rig.armR, rig.forearmR, rig.armL, rig.forearmL].forEach((c, i) =>
        c.rotation.set(lerp(from[i].x, targets[i][0], e), lerp(from[i].y, targets[i][1], e), lerp(from[i].z, targets[i][2], e)),
      );
    });
  }

  private stopScript() {
    this.cues = [];
    this.gestureToken++;
    this.beatGain = 1;
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
    this.stopScript();
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
    // fire the script's cues that are due
    if (this.cues.length) {
      this.cueClock += dt;
      while (this.cues.length && this.cues[0].at <= this.cueClock) {
        const c = this.cues.shift()!;
        if (c.gesture) this.gesture(c.gesture);
        if (c.nod) {
          this.nodAmp = c.nod;
          this.nodT = 0;
        }
        if (c.shake) this.shakeT = 0;
        if (c.look) this.look(c.look, 1200);
        if (c.expr) this.expression(c.expr);
      }
      if (!this.cues.length) this.beatGain = 1;
    }
    this.nodT += dt;
    this.shakeT += dt;
    // a nod: down and back up in 0.35 s; a shake: two quick turns, dying away
    const cueNod = this.nodT < 0.35 ? this.nodAmp * Math.sin((this.nodT / 0.35) * Math.PI) : 0;
    const cueShake = this.shakeT < 0.45 ? Math.sin((this.shakeT / 0.45) * Math.PI * 3) * 0.14 * (1 - this.shakeT / 0.45) : 0;
    if (this.glanceUntil && now > this.glanceUntil) {
      this.glanceUntil = 0;
      this.gaze = this.behavior === 'talk' ? 'you' : 'feed';
    }
    let [p, y] = this.aimAt && !this.glanceUntil ? this.aimAt : GAZE[this.gaze];

    // little eye darts while he watches, so he reads as looking at things, not frozen
    if (now > this.saccade.at) {
      this.saccade = { at: now + 600 + Math.random() * 1400, dx: (Math.random() - 0.5) * 0.22, dy: (Math.random() - 0.5) * 0.12 };
    }
    let nod = 0;
    let tilt = 0;
    let browLift = 0;
    let browFurrow = 0;
    switch (this.behavior) {
      case 'watch': {
        // darts are smaller when he's watching something specific (the dashboard's cursor)
        const dart = this.aimAt ? 0.25 : 1;
        y += this.saccade.dx * dart;
        p += this.saccade.dy * dart;
        break;
      }
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
    rig.head.rotation.set((this.pitch + nod + cueNod) * g, (this.yaw + cueShake) * g, (0.08 + tilt) * (rig.headAnchor ? 1.2 : 1));
    // the body turns a little with the head
    rig.body.rotation.y = this.yaw * (rig.headAnchor ? 0.35 : 0.25);
    rig.body.position.y = Math.sin(t * 2.2) * 0.006;
    rig.browL.rotation.z = browFurrow;
    rig.browR.rotation.z = -browFurrow;
    rig.browL.position.y = rig.browR.position.y = 0.281 + browLift;
  }
}
