import * as THREE from 'three';
import type { MayorRig } from './build';
import { JOINT_FEEL, SecondOrder, Spring3 } from './dynamics';
import { EXPRESSION, FACE_SHAPES, neutralFace, type Expression, type VoiceShape } from './face';

// What every Mamdani view shares: a transparent WebGL layer, a frame loop, tweens, the walk
// cycle, blinking, and a mouth that follows his voice. The photo scene (stage.ts) and the little
// portrait window (portrait.ts) are two framings of the same character built on this.

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Where the stage draws. A plain <canvas> on the web; on a phone, expo-gl's context and a canvas stand-in. */
export interface StageSurface {
  canvas: HTMLCanvasElement;
  context?: WebGLRenderingContext | WebGL2RenderingContext;
  pixelRatio?: number;
  size?: () => { w: number; h: number };
  /** called after each render — expo-gl needs gl.endFrameEXP() to show the frame */
  present?: () => void;
}

const SKIN = 0xe4a068;

/** Eyelids live outside the baked head so they can close: one per eye, hidden while open. */
function addLids(rig: MayorRig) {
  const mat = new THREE.MeshStandardMaterial({ color: SKIN, flatShading: true, roughness: 0.86 });
  const lids: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const lid = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat);
    lid.name = `lid-${side}`;
    lid.position.set(side * 0.082, 0.236, 0.176);
    lid.rotation.set(0, side * 0.17, side * 0.065);
    lid.scale.set(0.05, 0.028, 0.016);
    lid.userData.sy = 0.028;
    lid.visible = false;
    rig.head.add(lid);
    lids.push(lid);
  }
  return lids;
}

export class RigStage {
  protected renderer: THREE.WebGLRenderer;
  protected scene = new THREE.Scene();
  protected camera: THREE.PerspectiveCamera;
  protected rig: MayorRig | null = null;
  protected tasks: Array<(dt: number) => boolean> = [];
  protected walking = 0;
  protected walkPhase = 0;
  protected reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  protected surface: StageSurface;
  private raf = 0;
  private last = performance.now();
  private lids: THREE.Mesh[] = [];
  private nextBlink = 0;
  private blinkT = -1;
  private talk = 0;
  private level = 0;
  private levelAt = 0;
  private analyser: AnalyserNode | null = null;
  private bins = new Uint8Array(64);
  private mouthOpen = 0;
  // ── the performance layer: springs on every joint, breathing, weight shifts, speech beats, face ──
  private springs: Spring3[] | null = null;
  private bodyLift = new SecondOrder(...JOINT_FEEL.body);
  private raw = Array.from({ length: 8 }, () => new THREE.Euler());
  private voice: VoiceShape = { level: 0, bright: 0, dark: 0 };
  private levelSlow = 0;
  private beat = 0;
  private beatSide = 1;
  /** how much the automatic speech beats move the head (a scripted line turns them down) */
  protected beatGain = 1;
  private lastBeat = 0;
  private feeling: Expression = 'NEUTRAL';
  private posture = [new SecondOrder(1.4, 0.8, 0), new SecondOrder(1.4, 0.8, 0), new SecondOrder(1.4, 0.8, 0)];
  private face = neutralFace();
  private faceSprings = FACE_SHAPES.map((k) =>
    k.startsWith('brow') || k.startsWith('squint')
      ? new SecondOrder(4.5, 0.6, 0)
      : k === 'smile'
        ? new SecondOrder(2.5, 0.8, 0)
        : k === 'mouthRound'
          ? new SecondOrder(3, 1, 0) // a round mouth only for a held "oo" (~200 ms), not every dark blip
          : new SecondOrder(11, 0.85, 0),
  );

  constructor(target: HTMLCanvasElement | StageSurface, cam: { fov: number; shadows: boolean }) {
    this.surface = 'canvas' in target ? target : { canvas: target };
    const { canvas, context } = this.surface;
    this.renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true, powerPreference: 'high-performance' });
    // an injected surface knows its exact buffer scale; a browser canvas is capped at 2x
    this.renderer.setPixelRatio(this.surface.pixelRatio ?? Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = cam.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera = new THREE.PerspectiveCamera(cam.fov, 1, 0.05, 60);

    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3f46, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-2.5, 5, 3.5);
    sun.castShadow = cam.shadows;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xbfd6ff, 1.1);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);
  }

  /** Subclasses call this once their scene is set up. */
  private baseChildren = 0;
  private drewEmpty = false;

  protected start() {
    this.baseChildren = this.scene.children.length;
    this.resize();
    this.loop();
  }

  resize() {
    const size = this.surface.size?.();
    const w = (size ? size.w : this.surface.canvas.clientWidth) || 1;
    const h = (size ? size.h : this.surface.canvas.clientHeight) || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  protected setRig(rig: MayorRig | null) {
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = rig;
    // a rig with a sculpted face blinks with its blink morphs; the rest get separate lids
    this.lids = rig && !rig.setFace ? (rig.makeLids?.() ?? addLids(rig)) : [];
    this.springs = null; // a new body starts from its own pose, not springing out of the old one
    this.feeling = 'NEUTRAL';
    if (rig) this.scene.add(rig.root);
  }

  // ── voice ──
  /** Mouth on/off. Without a level source the mouth flaps on its own. */
  speaking(on: boolean) {
    this.talk = on ? 1 : 0;
  }
  /** Loudness plus mouth-shape cues from whatever is playing his voice (phone: live/audio.ts). */
  mouthShape(v: VoiceShape) {
    this.voice = v;
    this.mouthLevel(v.level);
  }
  /** Hold an expression — Gemini's emotion for this report — until told otherwise. */
  expression(e: Expression) {
    if (e === this.feeling) return;
    this.feeling = e;
    // blink for a reason: a change of mind reads as one (animators' rule, not a timer)
    this.nextBlink = Math.min(this.nextBlink, performance.now() + 60);
  }
  /** Loudness 0..1 from whatever is playing his voice (native audio sampling). */
  mouthLevel(v: number) {
    this.level = Math.max(0, Math.min(1, v));
    this.levelAt = performance.now();
  }
  /** Web Audio source for the same purpose. */
  listen(analyser: AnalyserNode | null) {
    this.analyser = analyser;
  }

  protected tween(sec: number, f: (t: number) => void) {
    return new Promise<void>((res) => {
      let t = 0;
      const d = this.reduced ? Math.min(sec, 0.05) : sec;
      this.tasks.push((dt) => {
        t = Math.min(1, t + dt / d);
        f(t);
        if (t >= 1) res();
        return t >= 1;
      });
    });
  }
  protected wait(sec: number) {
    return this.tween(sec, () => {});
  }

  /** Per-frame hook for subclasses (gaze, idle motion, particles). */
  protected update(_dt: number, _now: number) {}

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame(dt, now);
  };

  /** Step the scene without requestAnimationFrame (tests, hidden tabs, thumbnails). */
  async advance(seconds: number, dt = 1 / 30) {
    let clock = performance.now();
    for (let t = 0; t < seconds; t += dt) {
      clock += dt * 1000;
      this.frame(dt, clock);
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  /** One frame: tweens, walk cycle, face, render. Protected so a stage hosted in someone else's
   *  render loop (the dashboard's Mapbox layer) can step it there. */
  protected frame(dt: number, now: number) {
    let restore: (() => void) | null = null;
    this.tasks = this.tasks.filter((f) => !f(dt));
    // nothing on stage and nothing moving: the last (empty) frame is still showing
    if (!this.rig && !this.tasks.length && this.scene.children.length === this.baseChildren) {
      if (this.drewEmpty) return;
      this.drewEmpty = true;
    } else this.drewEmpty = false;
    const rig = this.rig;
    if (rig) {
      if (this.walking) {
        this.walkPhase += dt * 9;
        const s = Math.sin(this.walkPhase);
        rig.legL.rotation.x = s * 0.55;
        rig.legR.rotation.x = -s * 0.55;
        rig.armL.rotation.x = -s * 0.5;
        rig.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.035;
      } else {
        rig.legL.rotation.x *= 0.8;
        rig.legR.rotation.x *= 0.8;
      }
      this.update(dt, now);
      this.blink(now);

      // mouth follows the voice: a live level if one is arriving, else Web Audio, else a flap
      let open = 0;
      let bright = 0;
      let dark = 0;
      if (this.talk) {
        if (now - this.levelAt < 250) {
          // quiet talking sits at slightly-open; only stressed peaks reach wide open (Rhubarb B/C/D)
          open = Math.max(0, Math.min(1, (this.level - 0.08) * 1.6));
          bright = this.voice.bright;
          dark = this.voice.dark;
        } else if (this.analyser) {
          this.analyser.getByteFrequencyData(this.bins);
          open = Math.min(1, (this.bins.slice(2, 24).reduce((a, b) => a + b, 0) / 22 / 255) * 2.4);
          // fftSize 128: ~375 Hz a bin. Low (first formant of "o"/"oo") vs hiss ("s", "ee")
          const band = (a: number, b: number) => this.bins.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
          const low = band(1, 3), mid = band(3, 8), high = band(10, 30);
          const sum = low + mid + high + 1;
          bright = Math.min(1, Math.max(0, (high / sum - 0.12) * 4));
          dark = Math.min(1, Math.max(0, (low / sum - 0.45) * 3));
        } else {
          open = (Math.sin(now / 70) * 0.5 + 0.5) * (Math.sin(now / 230) > -0.3 ? 1 : 0.1);
          bright = Math.max(0, Math.sin(now / 310));
          dark = Math.max(0, Math.sin(now / 410 + 2));
        }
      }
      // quick to open, slower to close (fast attack, ~100 ms release), and shut under a noise floor,
      // so it tracks syllables instead of flapping on breath noise
      if (open < 0.06) open = 0;
      this.mouthOpen += (open - this.mouthOpen) * Math.min(1, dt * (open > this.mouthOpen ? 32 : 10));
      if (rig.setFace) {
        rig.mouth.visible = this.mouthOpen > 0.04;
        this.driveFace(dt, rig, bright, dark);
      } else if (rig.mouthOverlay) {
        // a dark opening that appears over the beard while he talks
        const base = rig.mouth.userData.base as THREE.Vector3;
        rig.mouth.visible = this.mouthOpen > 0.04;
        rig.mouth.scale.set(base.x, base.y * (0.3 + this.mouthOpen * 1.6), base.z * (0.8 + this.mouthOpen * 0.3));
      } else {
        rig.mouth.scale.y = 1 + this.mouthOpen * 4.5;
        rig.head.position.y = 0.6 + this.mouthOpen * 0.006;
      }
      restore = this.layers(dt, now, rig);
      rig.update?.();
    }
    this.renderer.render(this.scene, this.camera);
    this.surface.present?.();
    restore?.();
  }

  /**
   * Pixar-ish polish on top of whatever the tweens asked for, for this frame only:
   *   • every joint follows its target through a spring (overshoot, follow-through, no dead stops)
   *   • breathing, and a slow weight shift while he stands
   *   • shoulders counter-rotate and hips sway while he walks
   *   • a small nod and brow flash on stressed syllables (speech beats)
   *   • the held emotion's posture: head tilt, chin, chest
   * The tween targets are put back after rendering, so tweens keep reading their own values.
   */
  private layers(dt: number, now: number, rig: MayorRig): (() => void) | null {
    if (this.reduced) return null;
    const ctl = [rig.body, rig.head, rig.armL, rig.armR, rig.forearmL, rig.forearmR, rig.legL, rig.legR];
    const feel = [JOINT_FEEL.body, JOINT_FEEL.head, JOINT_FEEL.arm, JOINT_FEEL.arm, JOINT_FEEL.forearm, JOINT_FEEL.forearm, JOINT_FEEL.leg, JOINT_FEEL.leg];
    ctl.forEach((c, i) => this.raw[i].copy(c.rotation));
    const liftRaw = rig.body.position.y;
    if (!this.springs) {
      this.springs = feel.map((f, i) => {
        const sp = new Spring3(f);
        sp.reset(this.raw[i]);
        return sp;
      });
      this.bodyLift.reset(liftRaw);
    }
    ctl.forEach((c, i) => this.springs![i].follow(dt, this.raw[i], c.rotation));
    rig.body.position.y = this.bodyLift.update(dt, liftRaw);

    const t = now / 1000;
    // ~14 breaths a minute: the chest lifts, the head rides it
    const breath = Math.sin(t * Math.PI * 2 * 0.23);
    rig.body.rotation.x -= breath * 0.012;
    rig.head.rotation.x += breath * 0.006;
    if (this.walking) {
      const s = Math.sin(this.walkPhase);
      rig.body.rotation.y += s * 0.08; // shoulders twist against the legs
      rig.body.rotation.z += s * 0.03; // hips sway over the planted foot
      rig.head.rotation.y -= s * 0.05; // the head stays on its target
      // the free arm swings too (not when it's carrying something)
      if (Math.abs(this.raw[3].x) < 0.05 && Math.abs(this.raw[3].z + 0.12) < 0.06) rig.armR.rotation.x += s * 0.45;
    } else {
      // standing: weight drifts foot to foot, two slow waves so it never looks looped
      const sway = Math.sin(t * 0.41) * 0.016 + Math.sin(t * 0.23 + 1.3) * 0.009;
      rig.body.rotation.z += sway;
      rig.head.rotation.z -= sway * 0.6;
    }

    // speech beats: a syllable that jumps out of the running loudness gets a nod
    this.levelSlow += (this.mouthOpen - this.levelSlow) * Math.min(1, dt * 5);
    if (this.talk && this.mouthOpen - this.levelSlow > 0.17 && now - this.lastBeat > 380) {
      this.lastBeat = now;
      this.beat = 1;
      this.beatSide = Math.random() < 0.5 ? -1 : 1;
    }
    this.beat *= Math.exp(-dt / 0.17);
    rig.head.rotation.x += this.beat * 0.07 * this.beatGain;
    rig.head.rotation.y += this.beat * 0.03 * this.beatSide * this.beatGain;

    // the emotion's posture, eased in
    const look = EXPRESSION[this.feeling];
    rig.head.rotation.z += this.posture[0].update(dt, look.tilt ?? 0);
    rig.head.rotation.x += this.posture[1].update(dt, look.chin ?? 0);
    rig.body.rotation.x -= this.posture[2].update(dt, look.chest ?? 0);

    return () => {
      ctl.forEach((c, i) => c.rotation.copy(this.raw[i]));
      rig.body.position.y = liftRaw;
    };
  }

  /** Visemes from the voice cues, on top of the held emotion; each face channel is its own spring. */
  private driveFace(dt: number, rig: MayorRig, bright: number, dark: number) {
    const look = EXPRESSION[this.feeling];
    const o = this.mouthOpen;
    const round = o * dark;
    const wide = o * bright;
    const clamp = (x: number) => Math.max(0, Math.min(1, x));
    const target = {
      jawOpen: clamp(o * 0.85 * (1 - 0.3 * dark)),
      mouthWide: clamp((look.mouthWide ?? 0) + wide * 0.9 - round * 0.5),
      mouthRound: clamp((look.mouthRound ?? 0) + round * 0.95),
      smile: clamp((look.smile ?? 0) * (1 - 0.6 * round)),
      browUp0: clamp((look.browUp0 ?? 0) + this.beat * 0.35),
      browUp1: clamp((look.browUp1 ?? 0) + this.beat * 0.35),
      browDown0: clamp(look.browDown0 ?? 0),
      browDown1: clamp(look.browDown1 ?? 0),
      squint0: clamp(look.squint0 ?? 0),
      squint1: clamp(look.squint1 ?? 0),
      blink0: 0,
      blink1: 0,
    };
    FACE_SHAPES.forEach((k, i) => (this.face[k] = clamp(this.faceSprings[i].update(dt, target[k]))));
    // blinks are fast (~150 ms) and must reach fully shut: set directly, not through a spring
    this.face.blink0 = this.face.blink1 = this.blinkClosed;
    rig.setFace!(this.face);
  }

  private blinkClosed = 0;

  private blink(now: number) {
    if (this.blinkT < 0 && now > this.nextBlink) {
      this.blinkT = now;
      // mostly single blinks, the odd double
      this.nextBlink = now + 2200 + Math.random() * 3200;
      if (Math.random() < 0.15) this.nextBlink = now + 260;
    }
    let closed = 0;
    if (this.blinkT >= 0) {
      const t = (now - this.blinkT) / 150;
      closed = t >= 1 ? 0 : Math.sin(t * Math.PI);
      if (t >= 1) this.blinkT = -1;
    }

    this.blinkClosed = closed;
    for (const lid of this.lids) {
      lid.visible = closed > 0.05;
      lid.scale.y = lid.userData.sy * (0.15 + closed * 0.85);
    }
  }

  clear() {
    this.tasks = [];
    this.walking = 0;
    this.talk = 0;
    this.setRig(null);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clear();
    this.renderer.dispose();
  }
}
