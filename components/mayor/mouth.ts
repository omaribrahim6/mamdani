import * as THREE from 'three';

// A cartoon mouth, drawn instead of a stretched sphere (which can only ever read as a round "oo").
// The opening is the space between two lip curves across the mouth's width:
//   • the upper lip line stays fairly flat, the lower lip carries most of the opening (a "D" shape)
//   • wide sounds ("ee", "s") stretch it into a slit; only genuinely dark vowels ("oo") round it
//   • the upper teeth show along the top once it's open, the tongue at the bottom when it's wide open
//   • a smile lifts the corners
// Each layer is a fixed strip of quads between two curves, rewritten in place every frame.

export interface MouthPose {
  /** 0..1 how far open */
  open: number;
  /** 0..1 stretched wide ("ee", "s") */
  wide: number;
  /** 0..1 rounded ("oo", "o") */
  round: number;
  /** 0..1 corners up */
  smile: number;
}

const COLS = 24;

class Band {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  constructor(material: THREE.Material, order: number) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((COLS + 1) * 2 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx: number[] = [];
    for (let i = 0; i < COLS; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.renderOrder = order;
    this.mesh.frustumCulled = false;
  }
  /** Fill the strip between top(t) and bottom(t) for t across -1..1 of the given width. */
  set(width: number, top: (t: number) => number, bottom: (t: number) => number, bend: number, lift: number) {
    for (let i = 0; i <= COLS; i++) {
      const t = (i / COLS) * 2 - 1;
      const x = (t * width) / 2;
      const z = lift - bend * x * x; // follow the face's curve back toward the corners
      const hi = top(t), lo = Math.min(hi, bottom(t));
      this.pos.set([x, hi, z, x, lo, z], i * 6);
    }
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
  }
}

const flat = (m: THREE.MeshBasicMaterial) => {
  // drawn just in front of the beard surface it sits on
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
  return m;
};

export class CartoonMouth {
  /** the opening; teeth, tongue and lower lip are its children, so hiding it hides them all */
  readonly mesh: THREE.Mesh;
  private inside: Band;
  private teeth: Band;
  private tongue: Band;
  private lip: Band;

  /**
   * @param unit the face's scale (the gap between the eyes); every size is a fraction of it
   * @param curve how much the face bends away across the mouth (1 / face radius)
   */
  constructor(private unit: number, private curve = 1 / (unit * 0.9)) {
    this.inside = new Band(flat(new THREE.MeshBasicMaterial({ color: 0x3b1210 })), 10);
    this.teeth = new Band(flat(new THREE.MeshBasicMaterial({ color: 0xf1ebe0 })), 11);
    this.tongue = new Band(flat(new THREE.MeshBasicMaterial({ color: 0xa8454a })), 11);
    this.lip = new Band(flat(new THREE.MeshBasicMaterial({ color: 0x7a3b30 })), 11);
    this.mesh = this.inside.mesh;
    this.mesh.name = 'speaking-mouth';
    this.mesh.add(this.teeth.mesh, this.tongue.mesh, this.lip.mesh);
    this.set({ open: 0, wide: 0, round: 0, smile: 0 });
  }

  set(p: MouthPose) {
    const u = this.unit;
    const open = Math.max(0, Math.min(1, p.open));
    const round = Math.max(0, Math.min(1, p.round)) * open; // only an open mouth can be round
    const wide = Math.max(0, Math.min(1, p.wide));
    // width: stretches for "ee", pulls in for "oo", widens a touch as the jaw drops
    const w = u * 0.42 * (1 + 0.45 * wide + 0.12 * open - 0.5 * round);
    // height: mostly the jaw; a wide mouth is a slit, a round one as tall as it is wide
    let h = u * 0.3 * open * (1 - 0.45 * wide);
    h = h + (w * 0.85 - h) * round;
    // the upper lip line takes a small share of the opening and stays flat; the lower lip the rest
    const upShare = 0.22 + 0.28 * round;
    const corner = u * 0.06 * p.smile;
    const tilt = u * 0.006; // one corner a hair higher: a symmetric mouth looks dead
    const flatUp = 0.28 + 0.4 * round; // exponent: small = flat plateau, 0.5 = a circle's arc
    const deepLo = 0.75 - 0.25 * round;
    const top = (t: number) => h * upShare * (1 - t * t) ** flatUp + corner * t * t + tilt * t;
    const bottom = (t: number) => -h * (1 - upShare) * (1 - t * t) ** deepLo + corner * t * t + tilt * t;
    const lift = u * 0.02;
    this.inside.set(w, top, bottom, this.curve, lift);

    // upper teeth: a band under the upper lip, across the middle, once there's room
    const td = Math.min(h * 0.32, u * 0.05) * Math.min(1, open * 3) * (1 - round); // rounded lips hide the teeth
    this.teeth.set(w * 0.78, (t) => top(t * 0.78) - u * 0.004, (t) => top(t * 0.78) - td * (1 - t * t) ** 0.2, this.curve, lift + u * 0.002);
    // tongue: a low mound at the bottom when the mouth is well open
    const th = h * 0.28 * Math.max(0, (open - 0.35) / 0.65);
    this.tongue.set(w * 0.62, (t) => bottom(t * 0.62) + th * (1 - t * t) ** 0.6, (t) => bottom(t * 0.62) + u * 0.003, this.curve, lift + u * 0.002);
    // lower lip: a thin rim under the opening, so it reads as lips parting, not a hole
    const lipT = u * 0.035;
    this.lip.set(w * 1.02, (t) => bottom(t) - u * 0.002, (t) => bottom(t) - lipT * (1 - t * t) ** 0.5, this.curve, lift);
  }
}
