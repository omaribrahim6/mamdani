import * as THREE from 'three';
import type { CharacterAnimation, CharacterProp, Mood } from '@/lib/types';
import type { MayorOutfit } from './build';
import { ease, lerp, RigStage, type StageSurface } from './engine';
import { createMayor } from './models';
import { makeClipboard, makeCone, makeFlashlight } from './props';

export type { StageSurface } from './engine';

// A transparent 3D layer laid over the resident's photo. The photo's "ground" is a plane at y=0;
// a point in the photo (where the problem is) is ray-cast onto that plane, so he walks to the
// pothole, stands at the right scale for its distance, and casts a shadow onto the picture.

export interface PerformOpts {
  target: { x: number; y: number }; // 0..1 in the canvas
  mood: Mood;
  /** what he does at the problem; defaults to planting his flag */
  action?: CharacterAnimation;
  prop?: CharacterProp;
  size?: number; // fraction of the frame height he should occupy
  /** he's reached the problem and is about to act */
  onArrive?: () => void;
  onThunk?: () => void;
}

const PROP_FOR: Record<CharacterAnimation, CharacterProp> = {
  PLACE_FLAG: 'WARNING_FLAG',
  PLACE_CONE: 'TRAFFIC_CONE',
  CHECK_CLIPBOARD: 'CLIPBOARD',
  INSPECT_GROUND: 'FLASHLIGHT',
  LOOK_UP: 'FLASHLIGHT',
  POINT_AT_ISSUE: 'NONE',
  SHAKE_HEAD: 'NONE',
  ACKNOWLEDGE: 'NONE',
};

export class MayorStage extends RigStage {
  private planted: THREE.Object3D | null = null;
  private dust: THREE.Points | null = null;
  private dustT = 0;
  private idle = 0;

  constructor(target: HTMLCanvasElement | StageSurface) {
    super(target, { fov: 34, shadows: true });
    this.camera.position.set(0, 2.1, 5.2);
    this.camera.lookAt(0, 0.1, 0);
    // invisible ground that only shows shadows — grounds him in the photo
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.32 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.start();
  }

  /** Canvas point (0..1) → ground point, clamped so he's never microscopic or off-stage. */
  groundAt(x: number, y: number) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x * 2 - 1, -(y * 2 - 1)), this.camera);
    const hit = new THREE.Vector3();
    const ok = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    if (!ok) hit.set(0, 0, -3.5);
    hit.z = Math.max(-3.5, Math.min(2.4, hit.z));
    hit.x = Math.max(-2.4, Math.min(2.4, hit.x));
    return hit;
  }

  /** Walk in from the left edge → inspect → react → act → face you. Resolves when he's ready to talk. */
  async perform(outfit: MayorOutfit, o: PerformOpts) {
    this.clear();
    const rig = createMayor(outfit);
    this.setRig(rig);
    const action = o.action ?? 'PLACE_FLAG';
    const prop = o.prop && o.prop !== 'NONE' ? o.prop : PROP_FOR[action];

    const spot = this.groundAt(o.target.x, o.target.y);
    // Hold his on-screen size steady (~a quarter of the frame) whether the problem is at your feet
    // or down the block — a giant mayor hides the very thing he's pointing at.
    const dist = this.camera.position.distanceTo(spot);
    const frameH = 2 * dist * Math.tan((this.camera.fov * Math.PI) / 360);
    const k = (frameH * (o.size ?? 0.26)) / 1.18;
    rig.root.scale.setScalar(k);
    // stand beside the problem (camera-left of it), a touch in front
    const stand = spot.clone().add(new THREE.Vector3(-0.42 * k, 0, 0.18 * k));
    const start = new THREE.Vector3(-4.2 - k, 0, stand.z + 0.4 * k);
    rig.root.position.copy(start);
    rig.root.rotation.y = Math.PI / 2; // facing right, walking in
    rig.head.rotation.set(0, 0, 0);
    rig.armL.rotation.set(0, 0, 0.12);
    rig.forearmL.rotation.set(0, 0, 0);

    // what's in his hands on the way in
    rig.flag.removeFromParent();
    const handL = rig.handL ?? rig.forearmL.getObjectByName('hand-left') ?? rig.forearmL;
    let held: THREE.Object3D | null = null;
    if (prop === 'WARNING_FLAG' && rig.flagBuiltIn) {
      // the generated model already holds it upright at his side, like the reference
      held = rig.flag;
      (rig.flag.userData.mount as THREE.Object3D).add(held);
      rig.armR.rotation.copy(rig.flagCarry!.arm);
      rig.forearmR.rotation.copy(rig.flagCarry!.forearm);
    } else if (prop === 'WARNING_FLAG') {
      held = rig.flag;
      rig.handR.add(held);
      // carried over the shoulder
      rig.armR.rotation.set(-2.3, 0, -0.3);
      rig.forearmR.rotation.set(-0.4, 0, 0);
      held.rotation.set(Math.PI, 0, 0);
      held.position.set(0, 0.48, 0.035);
    } else {
      rig.armR.rotation.set(0, 0, -0.12);
      rig.forearmR.rotation.set(0, 0, 0);
      if (prop === 'TRAFFIC_CONE') {
        held = makeCone();
        held.position.set(0, -0.06, 0.05);
        held.rotation.set(Math.PI * 0.08, 0, 0);
        rig.handR.add(held);
        rig.armR.rotation.set(-0.35, 0, -0.18);
      } else if (prop === 'FLASHLIGHT') {
        held = makeFlashlight();
        held.position.set(0, -0.02, 0.03);
        held.rotation.set(Math.PI / 2, 0, 0);
        rig.handR.add(held);
      } else if (prop === 'CLIPBOARD' && (outfit !== 'inspector' || rig.handL)) {
        held = makeClipboard();
        held.position.set(0.006, -0.02, 0.049);
        held.rotation.x = -0.25;
        handL.add(held);
      }
    }

    if (this.reduced) {
      rig.root.position.copy(stand);
    } else {
      this.walking = 1;
      await this.tween(1.7, (t) => rig.root.position.lerpVectors(start, stand, ease(t)));
      this.walking = 0;
    }

    // turn toward the problem and look down into it
    const toSpot = Math.atan2(spot.x - stand.x, spot.z - stand.z);
    const lookDown = action === 'LOOK_UP' ? -0.5 : 0.45;
    await this.tween(0.35, (t) => {
      rig.root.rotation.y = lerp(Math.PI / 2, toSpot, ease(t));
      rig.head.rotation.x = lerp(0, lookDown, ease(t));
      rig.body.rotation.x = lerp(0, action === 'LOOK_UP' ? -0.08 : 0.22, ease(t));
    });
    o.onArrive?.();
    await this.react(o.mood, action);

    switch (action) {
      case 'PLACE_FLAG':
        await (rig.flagBuiltIn ? this.plantHeldFlag(k, spot, o.onThunk) : this.plantFlag(k, spot, o.onThunk));
        break;
      case 'PLACE_CONE':
        await this.placeCone(held, k, spot, o.onThunk);
        break;
      case 'CHECK_CLIPBOARD':
        await this.checkClipboard(o.onThunk);
        break;
      case 'INSPECT_GROUND':
        await this.inspectGround(o.onThunk);
        break;
      case 'LOOK_UP':
        await this.lookUp(o.onThunk);
        break;
      case 'SHAKE_HEAD':
      case 'POINT_AT_ISSUE':
        await this.point(action === 'SHAKE_HEAD', o.onThunk);
        break;
      default:
        await this.acknowledge(o.onThunk);
    }

    // turn to camera, hands on hips like the poster
    const from = {
      ry: rig.root.rotation.y, bx: rig.body.rotation.x, hx: rig.head.rotation.x,
      arx: rig.armR.rotation.x, arz: rig.armR.rotation.z, frx: rig.forearmR.rotation.x, frz: rig.forearmR.rotation.z,
      alx: rig.armL.rotation.x, alz: rig.armL.rotation.z, flx: rig.forearmL.rotation.x, flz: rig.forearmL.rotation.z,
    };
    await this.tween(0.45, (t) => {
      const e = ease(t);
      rig.root.rotation.y = lerp(from.ry, 0.2, e);
      rig.body.rotation.x = lerp(from.bx, 0, e);
      rig.head.rotation.set(lerp(from.hx, -0.05, e), lerp(0, 0.18, e), lerp(0, 0.16, e));
      rig.armR.rotation.set(lerp(from.arx, -0.1, e), 0, lerp(from.arz, -0.8, e));
      rig.forearmR.rotation.set(lerp(from.frx, -0.34, e), 0, lerp(from.frz, 1.5, e));
      rig.armL.rotation.set(lerp(from.alx, -0.1, e), 0, lerp(from.alz, 0.8, e));
      rig.forearmL.rotation.set(lerp(from.flx, -0.34, e), 0, lerp(from.flz, -1.5, e));
    });
    this.idle = 1;
  }

  /** He heads back out the way he came, leaving whatever he planted. */
  async exitLeft() {
    const rig = this.rig;
    if (!rig) return;
    this.idle = 0;
    const from = rig.root.position.clone();
    const to = new THREE.Vector3(-4.6 - rig.root.scale.x, 0, from.z + 0.3 * rig.root.scale.x);
    const ry = rig.root.rotation.y;
    await this.tween(0.25, (t) => {
      rig.root.rotation.y = lerp(ry, -Math.PI / 2, ease(t));
      rig.armR.rotation.set(0, 0, lerp(-0.8, -0.12, t));
      rig.forearmR.rotation.set(0, 0, lerp(1.5, 0, t));
      rig.armL.rotation.set(0, 0, lerp(0.8, 0.12, t));
      rig.forearmL.rotation.set(0, 0, lerp(-1.5, 0, t));
      rig.head.rotation.set(0, 0, 0);
    });
    this.walking = 1;
    await this.tween(1.1, (t) => rig.root.position.lerpVectors(from, to, t * t));
    this.walking = 0;
    this.setRig(null);
  }

  /** Where his head is on screen (0..1), for placing a caption. */
  headScreen() {
    if (!this.rig) return null;
    const v = new THREE.Vector3();
    (this.rig.headAnchor ?? this.rig.head).getWorldPosition(v);
    v.y += 0.62 * this.rig.root.scale.y;
    v.project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  // ── actions ──

  private async plantFlag(k: number, spot: THREE.Vector3, onThunk?: () => void) {
    const rig = this.rig!;
    await this.tween(0.32, (t) => {
      rig.armR.rotation.x = lerp(-2.3, -2.9, ease(t));
      rig.body.position.y = lerp(0, 0.03, ease(t));
    });
    await this.tween(0.12, (t) => {
      rig.armR.rotation.x = lerp(-2.9, -1.1, t * t);
      rig.body.rotation.x = lerp(0.22, 0.35, t);
    });
    // detach the flag into the world, standing in the ground at the problem
    rig.handR.remove(rig.flag);
    rig.flag.scale.setScalar(k);
    rig.flag.position.copy(spot).setY(-0.05 * k);
    rig.flag.rotation.set(0.12, rig.root.rotation.y + Math.PI / 2, -0.1);
    this.scene.add(rig.flag);
    this.planted = rig.flag;
    this.puff(spot, 1);
    onThunk?.();
    await this.tween(0.18, (t) => {
      const s = 1 - Math.sin(t * Math.PI) * 0.08;
      rig.body.scale.set(2 - s, s, 2 - s);
      rig.flag.rotation.z = -0.1 + Math.sin(t * Math.PI * 3) * 0.08 * (1 - t);
    });
  }

  /** The generated flag: lift it from his side, drive it into the ground at the problem. */
  private async plantHeldFlag(k: number, spot: THREE.Vector3, onThunk?: () => void) {
    const rig = this.rig!;
    const flag = rig.flag;
    const carry = rig.flagCarry!;
    // raise it up over the spot, still gripped as generated…
    await this.tween(0.35, (t) => {
      const e = ease(t);
      rig.armR.rotation.set(carry.arm.x - 0.55 * e, carry.arm.y, carry.arm.z);
      rig.forearmR.rotation.copy(carry.forearm);
      rig.body.position.y = lerp(0, 0.03, e);
    });
    // …THUNK
    await this.tween(0.12, (t) => {
      rig.armR.rotation.x = carry.arm.x - 0.55 + 0.75 * t * t;
      rig.body.rotation.x = lerp(0.22, 0.34, t);
    });
    // let go: the flag stays in the world, upright in the ground at the problem
    this.scene.attach(flag);
    const from = flag.position.clone();
    const fromQ = flag.quaternion.clone();
    const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, rig.root.rotation.y - Math.PI / 2, -0.06));
    const to = spot.clone().setY(-0.03 * k);
    flag.scale.setScalar(k * (flag.userData.scale ?? 1));
    this.planted = flag;
    this.puff(spot, 1);
    onThunk?.();
    await this.tween(0.16, (t) => {
      flag.position.lerpVectors(from, to, ease(t));
      flag.quaternion.slerpQuaternions(fromQ, upright, ease(t));
      const s = 1 - Math.sin(t * Math.PI) * 0.08;
      rig.body.scale.set(2 - s, s, 2 - s);
    });
    // a little wobble as it settles
    await this.tween(0.3, (t) => {
      flag.quaternion.copy(upright).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.sin(t * Math.PI * 3) * 0.06 * (1 - t))));
      rig.armR.rotation.x = lerp(carry.arm.x + 0.2, carry.arm.x, ease(t));
    });
  }

  private async placeCone(cone: THREE.Object3D | null, k: number, spot: THREE.Vector3, onThunk?: () => void) {
    const rig = this.rig!;
    // bend and set it down in front of the problem
    await this.tween(0.4, (t) => {
      rig.body.rotation.x = lerp(0.22, 0.55, ease(t));
      rig.armR.rotation.x = lerp(-0.35, -0.9, ease(t));
      rig.head.rotation.x = lerp(0.45, 0.3, ease(t));
    });
    if (cone) {
      cone.removeFromParent();
      cone.scale.setScalar(k * 1.1);
      const toward = new THREE.Vector3(Math.sin(rig.root.rotation.y), 0, Math.cos(rig.root.rotation.y));
      cone.position.copy(spot).addScaledVector(toward, -0.12 * k).setY(0);
      cone.rotation.set(0, 0, 0);
      this.scene.add(cone);
      this.planted = cone;
      this.puff(cone.position, 0.5);
    }
    onThunk?.();
    await this.tween(0.22, (t) => {
      if (cone) cone.scale.y = k * 1.1 * (1 - Math.sin(t * Math.PI) * 0.12);
    });
    await this.tween(0.3, (t) => {
      rig.body.rotation.x = lerp(0.55, 0.22, ease(t));
      rig.armR.rotation.x = lerp(-0.9, -0.2, ease(t));
    });
  }

  private async checkClipboard(onThunk?: () => void) {
    const rig = this.rig!;
    const board = (rig.handL ?? rig.forearmL).getObjectByName('clipboard');
    // raise the board, glance between it and the problem, write, tick
    await this.tween(0.35, (t) => {
      const e = ease(t);
      rig.armL.rotation.set(lerp(0, -0.55, e), 0, lerp(0.12, 0.35, e));
      rig.forearmL.rotation.set(lerp(0, -1.35, e), 0, lerp(0, -0.5, e));
      rig.head.rotation.set(lerp(0.45, 0.35, e), lerp(0, 0.35, e), 0);
      rig.armR.rotation.set(lerp(0, -0.55, e), 0, lerp(-0.12, 0.2, e));
      rig.forearmR.rotation.set(lerp(0, -1.25, e), 0, lerp(0, 0.6, e));
    });
    await this.tween(0.8, (t) => {
      rig.forearmR.rotation.z = 0.6 + Math.sin(t * Math.PI * 7) * 0.12;
      rig.head.rotation.y = 0.35 - Math.sin(t * Math.PI) * 0.4;
    });
    const tick = board?.getObjectByName('tick');
    if (tick) tick.visible = true;
    onThunk?.();
    await this.tween(0.35, (t) => {
      rig.head.rotation.x = 0.35 + Math.sin(t * Math.PI * 2) * 0.12; // firm nod
    });
  }

  private async inspectGround(onThunk?: () => void) {
    const rig = this.rig!;
    // lean in close, torch on it, hand to chin
    await this.tween(0.45, (t) => {
      const e = ease(t);
      rig.body.rotation.x = lerp(0.22, 0.5, e);
      rig.head.rotation.x = lerp(0.45, 0.6, e);
      rig.armR.rotation.set(lerp(0, -0.9, e), 0, lerp(-0.12, -0.1, e));
      rig.armL.rotation.set(lerp(0, -0.6, e), 0, lerp(0.12, 0.3, e));
      rig.forearmL.rotation.set(lerp(0, -2.1, e), 0, lerp(0, -0.4, e));
    });
    await this.tween(0.8, (t) => {
      rig.armR.rotation.y = Math.sin(t * Math.PI * 2) * 0.25; // sweep the beam
      rig.head.rotation.y = Math.sin(t * Math.PI * 2) * 0.15;
    });
    onThunk?.();
    await this.tween(0.35, (t) => {
      rig.body.rotation.x = lerp(0.5, 0.2, ease(t));
      rig.head.rotation.x = 0.45 + Math.sin(t * Math.PI * 2) * 0.1;
    });
  }

  private async lookUp(onThunk?: () => void) {
    const rig = this.rig!;
    await this.tween(0.4, (t) => {
      const e = ease(t);
      rig.armR.rotation.set(lerp(0, -2.6, e), 0, lerp(-0.12, -0.2, e));
      rig.head.rotation.x = lerp(-0.5, -0.65, e);
    });
    onThunk?.();
    await this.tween(0.6, (t) => {
      rig.armR.rotation.y = Math.sin(t * Math.PI * 2) * 0.15;
      rig.head.rotation.y = Math.sin(t * Math.PI * 2) * 0.12;
    });
  }

  private async point(shake: boolean, onThunk?: () => void) {
    const rig = this.rig!;
    await this.tween(0.3, (t) => {
      const e = ease(t);
      rig.armR.rotation.set(lerp(0, -1.25, e), 0, lerp(-0.12, 0.25, e));
      rig.forearmR.rotation.set(lerp(0, -0.15, e), 0, 0);
    });
    onThunk?.();
    await this.tween(shake ? 0.9 : 0.5, (t) => {
      if (shake) rig.head.rotation.y = Math.sin(t * Math.PI * 4) * 0.3 * (1 - t * 0.4);
      else rig.head.rotation.x = 0.3 + Math.sin(t * Math.PI * 2) * 0.12;
    });
  }

  private async acknowledge(onThunk?: () => void) {
    const rig = this.rig!;
    // a nod and a thumbs-up to the problem
    await this.tween(0.35, (t) => {
      const e = ease(t);
      rig.armR.rotation.set(lerp(0, -1.2, e), 0, lerp(-0.12, 0.1, e));
      rig.forearmR.rotation.set(lerp(0, -1.1, e), 0, 0);
    });
    onThunk?.();
    await this.tween(0.45, (t) => {
      rig.head.rotation.x = 0.2 + Math.sin(t * Math.PI * 2) * 0.15;
    });
  }

  private async react(mood: Mood, action: CharacterAnimation) {
    const rig = this.rig!;
    const baseX = action === 'LOOK_UP' ? -0.5 : 0.45;
    if (mood === 'dismayed' && action !== 'SHAKE_HEAD') {
      await this.tween(0.9, (t) => {
        rig.head.rotation.y = Math.sin(t * Math.PI * 3) * 0.35 * (1 - t * 0.5);
        rig.browL.rotation.z = -0.35;
        rig.browR.rotation.z = 0.35;
      });
    } else if (mood === 'determined') {
      await this.tween(0.7, (t) => {
        rig.head.rotation.x = baseX + Math.sin(t * Math.PI * 2) * 0.18;
        rig.browL.rotation.z = 0.2;
        rig.browR.rotation.z = -0.2;
      });
    } else if (mood === 'impressed') {
      await this.tween(0.8, (t) => {
        rig.body.rotation.x = lerp(0.22, -0.18, Math.sin(t * Math.PI));
        rig.browL.position.y = rig.browR.position.y = 0.281 + Math.sin(t * Math.PI) * 0.03;
      });
    } else if (mood === 'confused') {
      await this.tween(1.0, (t) => {
        rig.head.rotation.z = Math.sin(t * Math.PI) * 0.3;
      });
    }
    rig.head.rotation.y = 0;
    rig.head.rotation.z = 0;
  }

  private puff(at: THREE.Vector3, strength: number) {
    const n = Math.round(40 * strength);
    const pos = new Float32Array(n * 3);
    const vel: number[] = [];
    for (let i = 0; i < n; i++) {
      pos.set([at.x, 0.02, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 0.9) * strength;
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

  protected update(dt: number, now: number) {
    const rig = this.rig;
    if (rig && this.walking) rig.head.rotation.z = Math.sin(this.walkPhase) * 0.05;
    if (rig && this.idle) {
      const t = now / 1000;
      rig.body.position.y = Math.sin(t * 2.2) * 0.008;
      rig.head.rotation.z = 0.16 + Math.sin(t * 1.3) * 0.03;
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
  }

  clear() {
    this.idle = 0;
    this.planted?.removeFromParent();
    this.planted = null;
    this.dust?.removeFromParent();
    this.dust = null;
    super.clear();
  }
}
