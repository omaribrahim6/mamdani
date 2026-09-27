import * as THREE from 'three';
import { ease, lerp, RigStage } from '@mayor/engine';
import { createMayor, type ModelKind } from '@mayor/models';

// Mamdani's leap out of his corner and into the map. A transparent WebGL layer over the whole
// dashboard: he springs up from the bottom-right, arcs over the UI, turns his back to us and drops
// into the map, shrinking to exactly the size and spot where the map's own Mamdani takes over.
// Halfway through the air he suits up: a flash, and the suit becomes the hard hat and hi-vis.

type Pt = { x: number; y: number };

export class LeapStage extends RigStage {
  private canvas: HTMLCanvasElement;
  private flash: THREE.Sprite;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas, { fov: 28, shadows: false });
    this.canvas = canvas;
    this.camera.position.set(0, 0, 20);
    this.camera.lookAt(0, 0, 0);
    const glow = document.createElement('canvas');
    glow.width = glow.height = 128;
    const g = glow.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,236,190,0.8)');
    grad.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow), transparent: true, depthWrite: false, opacity: 0 }));
    this.scene.add(this.flash);
    this.start();
  }

  /** World point on the plane z = depth under a screen pixel. */
  private at(p: Pt, depth: number) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const v = new THREE.Vector3((p.x / w) * 2 - 1, -((p.y / h) * 2 - 1), 0.5).unproject(this.camera);
    const dir = v.sub(this.camera.position).normalize();
    const t = (depth - this.camera.position.z) / dir.z;
    return this.camera.position.clone().addScaledVector(dir, t);
  }

  /** Scale that makes the 1.18-unit rig `px` pixels tall at depth z. */
  private scaleFor(px: number, depth: number) {
    const dist = this.camera.position.z - depth;
    const worldPerPx = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / this.canvas.clientHeight;
    return (px * worldPerPx) / 1.18;
  }

  /**
   * From `from` (his feet, below the corner) to `to` (his feet on the map), ending `endPx` tall and
   * facing away from us. Resolves when he's at the landing spot.
   */
  async leap(from: Pt, startPx: number, to: Pt, endPx: number, outfits: [ModelKind, ModelKind], onSuitUp?: () => void) {
    let rig = createMayor(outfits[0]);
    this.setRig(rig);
    const depthNear = 6; // he comes a little toward us at the top of the arc
    const depthFar = -2;
    const place = (p: Pt, px: number, depth: number) => {
      rig.root.position.copy(this.at(p, depth));
      rig.root.scale.setScalar(this.scaleFor(px, depth));
    };
    // crouch in the corner (just his head and shoulders showing, like the dock)
    const crouchAt = { x: from.x, y: from.y + startPx * 0.55 };
    place(crouchAt, startPx, 0);
    rig.root.rotation.y = -0.5;
    await this.tween(0.35, (t) => {
      const e = ease(t);
      place({ x: from.x, y: lerp(crouchAt.y, from.y + startPx * 0.35, e) }, startPx, 0);
      rig.body.rotation.x = lerp(0, 0.45, e);
      rig.legL.rotation.x = rig.legR.rotation.x = lerp(0, -0.6, e);
      rig.armL.rotation.z = lerp(0.12, -0.4, e);
      rig.armR.rotation.z = lerp(-0.12, 0.4, e);
    });

    // the arc: up and over the dashboard, then down into the map
    const peak = { x: lerp(from.x, to.x, 0.55), y: Math.min(from.y, to.y) - Math.max(160, Math.abs(from.x - to.x) * 0.35) };
    const start = { x: from.x, y: from.y + startPx * 0.35 };
    let suited = false;
    await this.tween(1.25, (t) => {
      const u = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const p = {
        x: (1 - u) ** 2 * start.x + 2 * (1 - u) * u * peak.x + u * u * to.x,
        y: (1 - u) ** 2 * start.y + 2 * (1 - u) * u * peak.y + u * u * to.y,
      };
      // big as he comes out at us, then shrinking fast as he falls away into the map
      const grow = Math.sin(Math.min(1, u * 1.6) * Math.PI);
      const px = lerp(startPx * (1 + 0.35 * grow), endPx, Math.max(0, (u - 0.35) / 0.65) ** 1.4);
      const depth = lerp(depthNear * grow, depthFar, Math.max(0, (u - 0.5) / 0.5));
      place(p, px, depth);
      // spin round to face into the map, tuck, arms up like he means it
      rig.root.rotation.y = lerp(-0.5, Math.PI, Math.min(1, u * 1.4));
      rig.root.rotation.z = Math.sin(u * Math.PI) * -0.25;
      rig.body.rotation.x = lerp(0.45, -0.2, Math.min(1, u * 3)) + Math.max(0, u - 0.7) * 0.9;
      rig.legL.rotation.x = -0.8 * Math.sin(u * Math.PI);
      rig.legR.rotation.x = -0.4 * Math.sin(u * Math.PI);
      rig.armL.rotation.z = lerp(-0.4, 2.6, Math.min(1, u * 2.5));
      rig.armR.rotation.z = lerp(0.4, -2.6, Math.min(1, u * 2.5));
      // suit up mid-air
      const f = Math.max(0, 1 - Math.abs(u - 0.42) / 0.12);
      this.flash.material.opacity = f;
      this.flash.position.copy(rig.root.position).setY(rig.root.position.y + rig.root.scale.y * 0.7);
      this.flash.scale.setScalar(rig.root.scale.y * 2.4 * (0.6 + f));
      if (!suited && u >= 0.42) {
        suited = true;
        const next = createMayor(outfits[1]);
        next.root.position.copy(rig.root.position);
        next.root.rotation.copy(rig.root.rotation);
        next.root.scale.copy(rig.root.scale);
        this.setRig(next);
        rig = next;
        onSuitUp?.();
      }
    });
    this.flash.material.opacity = 0;
  }

  dispose() {
    this.flash.material.map?.dispose();
    this.flash.material.dispose();
    super.dispose();
  }
}

