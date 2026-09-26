import * as THREE from 'three';
import type { MayorRig } from './build';

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
    this.lids = rig ? (rig.makeLids?.() ?? addLids(rig)) : [];
    if (rig) this.scene.add(rig.root);
  }

  // ── voice ──
  /** Mouth on/off. Without a level source the mouth flaps on its own. */
  speaking(on: boolean) {
    this.talk = on ? 1 : 0;
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

  private frame(dt: number, now: number) {
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
      if (this.talk) {
        if (now - this.levelAt < 250) open = Math.min(1, this.level * 2.2);
        else if (this.analyser) {
          this.analyser.getByteFrequencyData(this.bins);
          open = Math.min(1, (this.bins.slice(2, 24).reduce((a, b) => a + b, 0) / 22 / 255) * 2.4);
        } else open = (Math.sin(now / 70) * 0.5 + 0.5) * (Math.sin(now / 230) > -0.3 ? 1 : 0.1);
      }
      this.mouthOpen += (open - this.mouthOpen) * Math.min(1, dt * 22);
      if (rig.mouthOverlay) {
        // a dark opening that appears over the beard while he talks
        const base = rig.mouth.userData.base as THREE.Vector3;
        rig.mouth.visible = this.mouthOpen > 0.04;
        rig.mouth.scale.set(base.x, base.y * (0.3 + this.mouthOpen * 1.6), base.z * (0.8 + this.mouthOpen * 0.3));
      } else {
        rig.mouth.scale.y = 1 + this.mouthOpen * 4.5;
        rig.head.position.y = 0.6 + this.mouthOpen * 0.006;
      }
      rig.update?.();
    }
    this.renderer.render(this.scene, this.camera);
    this.surface.present?.();
  }

  private blink(now: number) {
    if (!this.lids.length) return;
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
