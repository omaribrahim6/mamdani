import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
import { ease, lerp, RigStage } from '@mayor/engine';
import { createMayor, type ModelKind } from '@mayor/models';
import type { MayorRig } from '@mayor/build';

// Mamdani on the real map. He is drawn inside Mapbox's own WebGL (a custom 3D layer), standing at
// real coordinates at a giant's scale, so the 3D buildings hide him when he runs behind them and the
// camera can follow him down an actual street. Same rig, face and walk cycle as everywhere else.
//
// Scene units are metres around an origin: x east, y up, z south.

export type LngLat = [number, number];
export const HEIGHT = 16; // metres tall: big enough to read from a street-level camera

const R = Math.PI / 180;
/** metres between two points (flat earth: fine within a neighbourhood) */
export function metres(a: LngLat, b: LngLat) {
  const x = (b[0] - a[0]) * R * Math.cos(((a[1] + b[1]) / 2) * R);
  const y = (b[1] - a[1]) * R;
  return Math.hypot(x, y) * 6371e3;
}
/** compass bearing a → b, degrees clockwise from north */
export function bearing(a: LngLat, b: LngLat) {
  const y = Math.sin((b[0] - a[0]) * R) * Math.cos(b[1] * R);
  const x = Math.cos(a[1] * R) * Math.sin(b[1] * R) - Math.sin(a[1] * R) * Math.cos(b[1] * R) * Math.cos((b[0] - a[0]) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
}
/** the point `d` metres from `a` along `brg` */
export function offset(a: LngLat, brg: number, d: number): LngLat {
  const dx = Math.sin(brg * R) * d, dy = Math.cos(brg * R) * d;
  return [a[0] + dx / (6371e3 * Math.cos(a[1] * R)) / R, a[1] + dy / 6371e3 / R];
}
/** heading (degrees) → the rig's rotation.y, given +z is south and the rig faces +z */
const yawFor = (brg: number) => Math.atan2(Math.sin(brg * R), -Math.cos(brg * R));

export class MapMamdani extends RigStage {
  readonly layer: mapboxgl.CustomLayerInterface;
  private map: mapboxgl.Map | null = null;
  private origin: mapboxgl.MercatorCoordinate;
  private unit: number; // mercator units per metre
  private view = new THREE.Matrix4();
  private lastFrame = 0;
  private shadow: THREE.Mesh;
  private dust: THREE.Points | null = null;
  private dustT = 0;
  private planted: THREE.Object3D[] = [];
  private flagKit: THREE.Object3D | null = null;
  private running = 0;
  private waving = 0;
  /** where he is now, and which way he faces (compass degrees) */
  at: LngLat;
  heading = 0;

  constructor(origin: LngLat) {
    // the canvas/context are Mapbox's; they arrive in onAdd. A throwaway canvas lets RigStage build.
    super({ canvas: document.createElement('canvas') }, { fov: 30, shadows: false });
    this.at = origin;
    this.origin = mapboxgl.MercatorCoordinate.fromLngLat(origin, 0);
    this.unit = this.origin.meterInMercatorCoordinateUnits();
    // a soft blob under his feet grounds him on the street
    const blob = document.createElement('canvas');
    blob.width = blob.height = 64;
    const g = blob.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blob), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.15;
    this.shadow.visible = false;
    this.scene.add(this.shadow);

    const self = this;
    this.layer = {
      id: 'mamdani-3d',
      type: 'custom',
      renderingMode: '3d',
      onAdd(map, gl) {
        self.map = map;
        // draw into Mapbox's context: never clear what the map already drew
        self.renderer.dispose();
        self.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        self.renderer.autoClear = false;
        self.renderer.outputColorSpace = THREE.SRGBColorSpace;
        self.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      },
      render(_gl, matrix) {
        const now = performance.now();
        const dt = self.lastFrame ? Math.min(0.05, (now - self.lastFrame) / 1000) : 1 / 60;
        self.lastFrame = now;
        const m = new THREE.Matrix4().fromArray(matrix as number[]);
        const s = self.unit;
        const local = new THREE.Matrix4()
          .makeTranslation(self.origin.x, self.origin.y, self.origin.z)
          .scale(new THREE.Vector3(s, -s, s))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        self.view.copy(m).multiply(local);
        self.camera.projectionMatrix.copy(self.view);
        self.camera.projectionMatrixInverse.copy(self.view).invert();
        self.renderer.resetState();
        self.frame(dt, now);
        self.map?.triggerRepaint();
      },
      onRemove() {
        self.dispose();
      },
    };
  }

  // ── placing him ──
  /** local metres (x east, z south) for a point on the map */
  local(p: LngLat) {
    const c = mapboxgl.MercatorCoordinate.fromLngLat(p, 0);
    return new THREE.Vector3((c.x - this.origin.x) / this.unit, 0, (c.y - this.origin.y) / this.unit);
  }

  /** Screen position (CSS px) of a point on the map at an altitude, through the last frame's camera. */
  screen(p: LngLat, altitude = 0) {
    const v = this.local(p).setY(altitude).applyMatrix4(this.view);
    const c = this.map!.getCanvas();
    return { x: ((v.x + 1) / 2) * c.clientWidth, y: ((1 - v.y) / 2) * c.clientHeight, visible: v.z < 1 };
  }

  get k() {
    return HEIGHT / 1.18;
  }

  show(outfit: ModelKind, at: LngLat, heading: number) {
    const rig = createMayor(outfit);
    this.setRig(rig);
    rig.root.scale.setScalar(this.k);
    // keep a spare of his flag to plant at every stop (the one he carries stays in his hand)
    if (rig.flagBuiltIn) {
      // its userData points back at the hand it's mounted on; clone without that (three copies userData as JSON)
      const ud = rig.flag.userData;
      rig.flag.userData = {};
      this.flagKit = rig.flag.clone(true);
      rig.flag.userData = ud;
      this.flagKit.userData = { scale: ud.scale };
    }
    if (rig.flagCarry) {
      rig.armR.rotation.copy(rig.flagCarry.arm);
      rig.forearmR.rotation.copy(rig.flagCarry.forearm);
    }
    this.place(at, heading);
    this.shadow.visible = true;
  }

  place(at: LngLat, heading = this.heading) {
    this.at = at;
    this.heading = heading;
    const rig = this.rig;
    if (!rig) return;
    const p = this.local(at);
    rig.root.position.copy(p);
    rig.root.rotation.y = yawFor(heading);
    this.shadow.position.set(p.x, 0.15, p.z);
    this.shadow.scale.setScalar(HEIGHT * 0.55);
  }

  /** He leaves the map (the leap home takes over); his flags stay in the street. */
  lift() {
    this.shadow.visible = false;
    this.walking = 0;
    this.running = 0;
    this.waving = 0;
    this.tasks = [];
    this.setRig(null);
  }

  hide() {
    this.clearPlanted();
    this.shadow.visible = false;
    this.clear();
  }

  // ── moves ──
  /** He comes down out of the sky onto his feet: squash, dust, straighten. */
  async land(onThunk?: () => void) {
    const rig = this.rig;
    if (!rig) return;
    const base = rig.root.position.clone();
    await this.tween(0.22, (t) => {
      rig.root.position.set(base.x, lerp(HEIGHT * 0.9, 0, t * t), base.z);
      rig.legL.rotation.x = rig.legR.rotation.x = lerp(-0.6, 0, t);
      rig.armL.rotation.z = lerp(1.6, 0.4, t);
      rig.armR.rotation.z = lerp(-1.6, -0.4, t);
    });
    rig.root.position.copy(base);
    this.puff(base, 1.6);
    onThunk?.();
    await this.tween(0.32, (t) => {
      const sq = Math.sin(t * Math.PI) * 0.18 * (1 - t * 0.3);
      rig.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
      rig.body.rotation.x = Math.sin(t * Math.PI) * 0.35;
      rig.armL.rotation.z = lerp(0.4, 0.12, ease(t));
      rig.armR.rotation.z = lerp(-0.4, -0.12, ease(t));
    });
    rig.body.scale.set(1, 1, 1);
    if (rig.flagCarry) {
      rig.armR.rotation.copy(rig.flagCarry.arm);
      rig.forearmR.rotation.copy(rig.flagCarry.forearm);
    }
  }

  /** He looks up the street, left, right: sizing up the job. */
  async lookAround() {
    const rig = this.rig;
    if (!rig) return;
    await this.tween(1.5, (t) => {
      rig.head.rotation.y = Math.sin(t * Math.PI * 2) * 0.55 * (1 - t * 0.3);
      rig.head.rotation.x = 0.12 + Math.sin(t * Math.PI) * 0.1;
      rig.body.rotation.y = Math.sin(t * Math.PI * 2) * 0.12;
    });
    rig.head.rotation.set(0, 0, 0);
    rig.body.rotation.y = 0;
  }

  /** Run along a street path (map coordinates), at `speed` metres a second, calling onStep each frame. */
  async run(path: LngLat[], speed: number, onStep?: (at: LngLat, heading: number) => void) {
    const rig = this.rig;
    if (!rig || path.length < 2) return;
    const lens = path.slice(1).map((p, i) => metres(path[i], p));
    const total = lens.reduce((a, b) => a + b, 0);
    if (total < 1) return;
    this.walking = 1;
    this.running = 1;
    let heading = this.heading;
    await this.tween(total / speed, (t) => {
      // ease in and out of the sprint so he doesn't teleport to full speed
      const d = total * (t < 0.12 ? (t / 0.12) ** 2 * 0.06 : t > 0.9 ? 1 - ((1 - t) / 0.1) ** 2 * 0.05 : 0.06 + ((t - 0.12) / 0.78) * 0.89);
      let acc = 0, k = 0;
      while (k < lens.length - 1 && acc + lens[k] < d) acc += lens[k++];
      const u = lens[k] ? Math.min(1, (d - acc) / lens[k]) : 1;
      const a = path[k], b = path[k + 1];
      const at: LngLat = [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
      // turn smoothly into each new street
      const want = bearing(a, b);
      let diff = ((want - heading + 540) % 360) - 180;
      heading = (heading + diff * 0.18 + 360) % 360;
      this.place(at, heading);
      onStep?.(at, heading);
    });
    this.running = 0;
    this.walking = 0;
  }

  /** Face a point and drive a flag into it. */
  async plantFlag(at: LngLat, onThunk?: () => void) {
    const rig = this.rig;
    if (!rig) return;
    const from = this.heading;
    const to = bearing(this.at, at);
    const turn = ((to - from + 540) % 360) - 180;
    await this.tween(0.3, (t) => this.place(this.at, from + turn * ease(t)));
    const carry = rig.flagCarry;
    // lean in, lift, THUNK
    await this.tween(0.32, (t) => {
      const e = ease(t);
      rig.body.rotation.x = lerp(0, 0.28, e);
      rig.head.rotation.x = lerp(0, 0.45, e);
      if (carry) rig.armR.rotation.set(carry.arm.x - 0.55 * e, carry.arm.y, carry.arm.z);
      else rig.armR.rotation.set(lerp(0, -2.6, e), 0, -0.2);
    });
    await this.tween(0.12, (t) => {
      if (carry) rig.armR.rotation.x = carry.arm.x - 0.55 + 0.75 * t * t;
      else rig.armR.rotation.x = lerp(-2.6, -1.0, t * t);
      rig.body.rotation.x = lerp(0.28, 0.4, t);
    });
    // a flag stays behind in the street at the pothole
    const flag = this.flagKit ? this.flagKit.clone(true) : new THREE.Group();
    flag.scale.setScalar(this.k * (flag.userData.scale ?? 1));
    const spot = this.local(at);
    flag.position.copy(spot).setY(-0.02 * this.k);
    const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, yawFor(this.heading) - Math.PI / 2, -0.06));
    flag.quaternion.copy(upright);
    this.scene.add(flag);
    this.planted.push(flag);
    this.puff(spot, 1);
    onThunk?.();
    await this.tween(0.35, (t) => {
      flag.quaternion.copy(upright).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.sin(t * Math.PI * 3) * 0.08 * (1 - t))));
      const s = 1 - Math.sin(t * Math.PI) * 0.08;
      rig.body.scale.set(2 - s, s, 2 - s);
    });
    rig.body.scale.set(1, 1, 1);
    await this.tween(0.3, (t) => {
      rig.body.rotation.x = lerp(0.4, 0, ease(t));
      rig.head.rotation.x = lerp(0.45, 0, ease(t));
      if (carry) rig.armR.rotation.copy(carry.arm);
    });
  }

  /** Turn to the camera and wave. */
  async wave(toward: number) {
    const rig = this.rig;
    if (!rig) return;
    const from = this.heading;
    const turn = ((toward - from + 540) % 360) - 180;
    await this.tween(0.35, (t) => this.place(this.at, from + turn * ease(t)));
    this.waving = 1;
    await this.tween(1.4, () => {});
    this.waving = 0;
  }

  private clearPlanted() {
    this.planted.forEach((f) => f.removeFromParent());
    this.planted = [];
  }

  private puff(at: THREE.Vector3, strength: number) {
    const n = Math.round(70 * strength);
    const pos = new Float32Array(n * 3);
    const vel: number[] = [];
    for (let i = 0; i < n; i++) {
      pos.set([at.x, 0.3, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const sp = (4 + Math.random() * 7) * strength;
      vel.push(Math.cos(a) * sp, 3 + Math.random() * 6, Math.sin(a) * sp);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust?.removeFromParent();
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd9cfc0, size: 0.9, transparent: true, opacity: 0.9, depthWrite: false }));
    this.dust.userData.vel = vel;
    this.dustT = 0;
    this.scene.add(this.dust);
  }

  protected update(dt: number, now: number) {
    const rig: MayorRig | null = this.rig;
    if (rig && this.running) {
      // a sprint, not a stroll: faster cadence, longer strides, arms pumping, leaning into it
      this.walkPhase += dt * 7;
      const s = Math.sin(this.walkPhase);
      rig.legL.rotation.x = s * 0.95;
      rig.legR.rotation.x = -s * 0.95;
      rig.armL.rotation.x = -s * 0.9;
      rig.forearmL.rotation.x = -0.9;
      rig.body.rotation.x = 0.16;
      rig.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.06;
      rig.head.rotation.x = -0.1;
    } else if (rig && !this.walking) {
      rig.forearmL.rotation.x *= 0.85;
    }
    if (rig && this.waving) {
      const t = now / 1000;
      rig.armL.rotation.set(-0.2, 0, 2.5);
      rig.forearmL.rotation.set(0, 0, 0.3 + Math.sin(t * 12) * 0.45);
      rig.head.rotation.z = 0.12;
    }
    if (this.dust) {
      this.dustT += dt;
      const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      const v = this.dust.userData.vel as number[];
      for (let i = 0; i < p.count; i++) {
        v[i * 3 + 1] -= dt * 9;
        p.setXYZ(i, p.getX(i) + v[i * 3] * dt, Math.max(0.2, p.getY(i) + v[i * 3 + 1] * dt), p.getZ(i) + v[i * 3 + 2] * dt);
      }
      p.needsUpdate = true;
      (this.dust.material as THREE.PointsMaterial).opacity = Math.max(0, 0.9 - this.dustT * 0.8);
      if (this.dustT > 1.2) {
        this.dust.removeFromParent();
        this.dust = null;
      }
    }
  }
}
