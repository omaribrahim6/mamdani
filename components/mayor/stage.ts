import * as THREE from 'three';
import type { Outfit } from '@/lib/categories';
import type { Mood } from '@/lib/types';
import { buildMayor, type MayorRig } from './build';

// A transparent 3D layer laid over the resident's photo. The photo's "ground" is a plane at y=0;
// a point in the photo (where the problem is) is ray-cast onto that plane, so he walks to the
// pothole, stands at the right scale for its distance, and casts a shadow onto the picture.

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface PerformOpts {
  target: { x: number; y: number }; // 0..1 in the canvas
  mood: Mood;
  onThunk?: () => void;
}

export class MayorStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  private rig: MayorRig | null = null;
  private plantedFlag: THREE.Object3D | null = null;
  private dust: THREE.Points | null = null;
  private dustT = 0;
  private raf = 0;
  private last = performance.now();
  private tasks: Array<(dt: number) => boolean> = [];
  private walkPhase = 0;
  private walking = 0;
  private talk = 0;
  private idle = 0;
  private reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private analyser: AnalyserNode | null = null;
  private level = new Uint8Array(64);

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.camera.position.set(0, 2.1, 5.2);
    this.camera.lookAt(0, 0.1, 0);

    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3f46, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-2.5, 5, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -4;
    sun.shadow.camera.right = 4;
    sun.shadow.camera.top = 4;
    sun.shadow.camera.bottom = -4;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xbfd6ff, 1.1);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);

    // invisible ground that only shows shadows — grounds him in the photo
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.32 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.resize();
    this.loop();
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Canvas point (0..1) → ground point, clamped so he's never microscopic or off-stage. */
  groundAt(x: number, y: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), this.camera);
    const hit = new THREE.Vector3();
    const ok = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    if (!ok) hit.set(0, 0, 0);
    hit.z = Math.max(-3.5, Math.min(2.4, hit.z));
    hit.x = Math.max(-2.4, Math.min(2.4, hit.x));
    return hit;
  }

  listen(analyser: AnalyserNode | null) {
    this.analyser = analyser;
  }

  /** Walk in → inspect → react → plant the flag → face you. Resolves when he's ready to talk. */
  async perform(outfit: Outfit, o: PerformOpts) {
    this.clear();
    const rig = buildMayor(outfit);
    this.rig = rig;
    this.scene.add(rig.root);

    const flagSpot = this.groundAt(o.target.x, o.target.y);
    // stand beside the problem (camera-left of it), a touch in front
    const stand = flagSpot.clone().add(new THREE.Vector3(-0.42, 0, 0.18));
    const start = new THREE.Vector3(-4.2, 0, stand.z + 0.4);
    rig.root.position.copy(start);
    rig.root.rotation.y = Math.PI / 2; // facing right, walking in
    // carry the flag over the shoulder
    rig.armR.rotation.set(-2.3, 0, -0.3);
    rig.forearmR.rotation.x = -0.4;

    if (this.reduced) {
      rig.root.position.copy(stand);
    } else {
      // walk in
      this.walking = 1;
      await this.tween(1.7, (t) => {
        rig.root.position.lerpVectors(start, stand, ease(t));
      });
      this.walking = 0;
    }

    // turn toward the problem and look down into it
    const toFlag = Math.atan2(flagSpot.x - stand.x, flagSpot.z - stand.z);
    await this.tween(0.35, (t) => {
      rig.root.rotation.y = lerp(Math.PI / 2, toFlag, ease(t));
      rig.head.rotation.x = lerp(0, 0.45, ease(t));
      rig.body.rotation.x = lerp(0, 0.22, ease(t));
    });
    await this.react(o.mood);

    // raise the flag… THUNK
    await this.tween(0.32, (t) => {
      rig.armR.rotation.x = lerp(-2.3, -2.9, ease(t));
      rig.body.position.y = lerp(0, 0.03, ease(t));
    });
    await this.tween(0.12, (t) => {
      rig.armR.rotation.x = lerp(-2.9, -1.1, t * t);
      rig.body.rotation.x = lerp(0.22, 0.35, t);
    });
    // detach the flag into the world, standing in the ground at the problem
    const world = new THREE.Vector3();
    rig.flag.getWorldPosition(world);
    rig.handR.remove(rig.flag);
    rig.flag.position.copy(flagSpot).setY(-0.05);
    rig.flag.rotation.set(0.12, rig.root.rotation.y + Math.PI / 2, -0.1);
    this.scene.add(rig.flag);
    this.plantedFlag = rig.flag;
    this.puff(flagSpot);
    o.onThunk?.();
    // squash
    await this.tween(0.18, (t) => {
      const s = 1 - Math.sin(t * Math.PI) * 0.08;
      rig.body.scale.set(2 - s, s, 2 - s);
      rig.flag.rotation.z = -0.1 + Math.sin(t * Math.PI * 3) * 0.08 * (1 - t);
    });

    // turn to camera, hands on hips like the poster
    await this.tween(0.45, (t) => {
      rig.root.rotation.y = lerp(toFlag, -0.25, ease(t));
      rig.body.rotation.x = lerp(0.35, 0, ease(t));
      rig.head.rotation.x = lerp(0.45, -0.05, ease(t));
      rig.armR.rotation.set(lerp(-1.1, -0.1, ease(t)), 0, lerp(-0.3, -0.75, ease(t)));
      rig.forearmR.rotation.x = lerp(-0.4, -1.9, ease(t));
      rig.forearmR.rotation.z = lerp(0, 0.6, ease(t));
      rig.armL.rotation.z = lerp(0.12, 0.75, ease(t));
      rig.forearmL.rotation.x = lerp(0, -1.9, ease(t));
      rig.forearmL.rotation.z = lerp(0, -0.6, ease(t));
    });
    this.idle = 1;
  }

  /** mouth + brows while the voice plays */
  speaking(on: boolean) {
    this.talk = on ? 1 : 0;
  }

  private async react(mood: Mood) {
    const rig = this.rig!;
    if (mood === 'dismayed') {
      // slow head shake
      await this.tween(0.9, (t) => {
        rig.head.rotation.y = Math.sin(t * Math.PI * 3) * 0.35 * (1 - t * 0.5);
        rig.browL.rotation.z = -0.35;
        rig.browR.rotation.z = 0.35;
      });
    } else if (mood === 'determined') {
      await this.tween(0.7, (t) => {
        rig.head.rotation.x = 0.45 + Math.sin(t * Math.PI * 2) * 0.18;
        rig.browL.rotation.z = 0.2;
        rig.browR.rotation.z = -0.2;
      });
    } else if (mood === 'impressed') {
      await this.tween(0.8, (t) => {
        rig.body.rotation.x = lerp(0.22, -0.18, Math.sin(t * Math.PI));
        rig.browL.position.y = rig.browR.position.y = 0.305 + Math.sin(t * Math.PI) * 0.03;
      });
    } else {
      // confused: head tilt, scratch
      await this.tween(1.0, (t) => {
        rig.head.rotation.z = Math.sin(t * Math.PI) * 0.3;
        rig.armL.rotation.x = -Math.sin(t * Math.PI) * 2.4;
      });
    }
    rig.head.rotation.y = 0;
    rig.head.rotation.z = 0;
  }

  private puff(at: THREE.Vector3) {
    const n = 40;
    const pos = new Float32Array(n * 3);
    const vel: number[] = [];
    for (let i = 0; i < n; i++) {
      pos.set([at.x, 0.02, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 0.9;
      vel.push(Math.cos(a) * sp, 0.4 + Math.random() * 0.8, Math.sin(a) * sp);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust?.removeFromParent();
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfc6b8, size: 0.05, transparent: true, opacity: 0.9, depthWrite: false }));
    this.dust.userData.vel = vel;
    this.dustT = 0;
    this.scene.add(this.dust);
  }

  private tween(sec: number, f: (t: number) => void) {
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

  clear() {
    this.tasks = [];
    this.idle = 0;
    this.walking = 0;
    this.talk = 0;
    if (this.rig) this.scene.remove(this.rig.root);
    this.plantedFlag?.removeFromParent();
    this.dust?.removeFromParent();
    this.rig = null;
    this.plantedFlag = null;
  }

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

    const rig = this.rig;
    if (rig) {
      if (this.walking) {
        this.walkPhase += dt * 9;
        const s = Math.sin(this.walkPhase);
        rig.legL.rotation.x = s * 0.55;
        rig.legR.rotation.x = -s * 0.55;
        rig.armL.rotation.x = -s * 0.5;
        rig.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.035;
        rig.head.rotation.z = s * 0.05;
      } else {
        rig.legL.rotation.x *= 0.8;
        rig.legR.rotation.x *= 0.8;
      }
      if (this.idle) {
        const t = now / 1000;
        rig.body.position.y = Math.sin(t * 2.2) * 0.008;
        rig.head.rotation.z = Math.sin(t * 1.3) * 0.04;
      }
      // mouth follows the voice
      let open = 0;
      if (this.talk) {
        if (this.analyser) {
          this.analyser.getByteFrequencyData(this.level);
          open = Math.min(1, (this.level.slice(2, 24).reduce((a, b) => a + b, 0) / 22 / 255) * 2.4);
        } else {
          open = (Math.sin(now / 70) * 0.5 + 0.5) * (Math.sin(now / 230) > -0.3 ? 1 : 0.1);
        }
      }
      rig.mouth.scale.y = 1 + open * 4.5;
      rig.head.position.y = 0.6 + open * 0.006;
    }

    if (this.dust) {
      this.dustT += dt;
      const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      const v = this.dust.userData.vel as number[];
      for (let i = 0; i < p.count; i++) {
        v[i * 3 + 1] -= dt * 2.2;
        p.setXYZ(i, p.getX(i) + v[i * 3] * dt * 0.5, Math.max(0.01, p.getY(i) + v[i * 3 + 1] * dt * 0.5), p.getZ(i) + v[i * 3 + 2] * dt * 0.5);
      }
      p.needsUpdate = true;
      (this.dust.material as THREE.PointsMaterial).opacity = Math.max(0, 0.9 - this.dustT * 0.9);
      if (this.dustT > 1.1) {
        this.dust.removeFromParent();
        this.dust = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clear();
    this.renderer.dispose();
  }
}
