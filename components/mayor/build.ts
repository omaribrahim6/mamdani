import * as THREE from 'three';
import type { Outfit } from '@/lib/categories';

// Tiny Mamdani, built from primitives. Low-poly + flat shading = the faceted toy look.
// Units: he's ~1.0 tall. Origin at his feet, facing +Z.

const C = {
  skin: 0xc68a62,
  skinShade: 0xb07550,
  hair: 0x1a1412,
  suit: 0x1d2240,
  shirt: 0xf2f0ea,
  tie: 0x9c1c2c,
  shoe: 0x141414,
  eyeWhite: 0xf6f3ee,
  pupil: 0x1a1412,
  hardhat: 0xffc61a,
  hardhatWhite: 0xf1f1ec,
  hardhatOrange: 0xff7a1a,
  vestOrange: 0xff5a14,
  vestLime: 0xc8f000,
  stripe: 0xfff45c,
  flag: 0xff4a1c,
  pole: 0x8a5a33,
  belt: 0x5a3a22,
  board: 0xa5774d,
  paper: 0xfafafa,
  cap: 0x1d7a3a,
};

const mats = new Map<number, THREE.MeshStandardMaterial>();
const mat = (c: number, rough = 0.85) => {
  const k = c * 10 + Math.round(rough * 10);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: rough, metalness: 0 }));
  return mats.get(k)!;
};

function mesh(g: THREE.BufferGeometry, color: number, rough?: number) {
  const m = new THREE.Mesh(g, mat(color, rough));
  m.castShadow = true;
  return m;
}

/** A tapered low-poly limb hanging down from its pivot. */
function limb(len: number, rTop: number, rBot: number, color: number, seg = 6) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, seg);
  g.translate(0, -len / 2, 0);
  return mesh(g, color);
}

export interface MayorRig {
  root: THREE.Group;
  body: THREE.Group; // everything above the hips (bobs, squashes)
  head: THREE.Group;
  mouth: THREE.Mesh;
  browL: THREE.Mesh;
  browR: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  forearmL: THREE.Group;
  forearmR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  handR: THREE.Group; // holds props
  flag: THREE.Group;
}

export function buildMayor(outfit: Outfit): MayorRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ── legs ──
  const mkLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.075, 0.3, 0);
    leg.add(limb(0.27, 0.058, 0.052, C.suit, 5));
    const shoe = mesh(new THREE.BoxGeometry(0.1, 0.06, 0.17), C.shoe, 0.5);
    shoe.position.set(0, -0.28, 0.035);
    leg.add(shoe);
    root.add(leg);
    return leg;
  };
  const legL = mkLeg(1);
  const legR = mkLeg(-1);

  // ── torso: a jacket that widens at the shoulders ──
  const torso = mesh(new THREE.CylinderGeometry(0.15, 0.125, 0.3, 6), C.suit);
  torso.scale.set(1.15, 1, 0.78);
  torso.position.y = 0.44;
  body.add(torso);
  // shirt + tie in the jacket's V
  const shirt = mesh(new THREE.ConeGeometry(0.07, 0.17, 3), C.shirt);
  shirt.rotation.set(Math.PI, 0, 0);
  shirt.position.set(0, 0.52, 0.098);
  shirt.scale.set(1, 1, 0.3);
  body.add(shirt);
  const tie = mesh(new THREE.BoxGeometry(0.035, 0.17, 0.015), C.tie, 0.6);
  tie.position.set(0, 0.49, 0.112);
  body.add(tie);
  const knot = mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), C.tie, 0.6);
  knot.position.set(0, 0.58, 0.11);
  body.add(knot);

  // ── outfit layers on the torso ──
  if (outfit === 'construction' || outfit === 'traffic' || outfit === 'sanitation') {
    const vestColor = outfit === 'sanitation' ? C.vestLime : C.vestOrange;
    const vest = mesh(new THREE.CylinderGeometry(0.158, 0.133, 0.24, 6, 1, true), vestColor);
    (vest.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    vest.scale.set(1.16, 1, 0.8);
    vest.position.y = 0.43;
    body.add(vest);
    for (const y of [0.38, 0.47]) {
      const s = mesh(new THREE.CylinderGeometry(0.16, 0.155, 0.022, 6, 1, true), C.stripe, 0.5);
      s.scale.set(1.17, 1, 0.81);
      s.position.y = y;
      body.add(s);
    }
  }
  if (outfit === 'electrician') {
    const belt = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 6), C.belt);
    belt.scale.set(1.15, 1, 0.8);
    belt.position.y = 0.315;
    body.add(belt);
    const pouch = mesh(new THREE.BoxGeometry(0.06, 0.07, 0.04), C.belt);
    pouch.position.set(0.12, 0.29, 0.07);
    body.add(pouch);
  }

  // ── arms ──
  const mkArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.19, 0.57, 0);
    arm.add(limb(0.15, 0.045, 0.04, C.suit, 5));
    const fore = new THREE.Group();
    fore.position.y = -0.15;
    fore.add(limb(0.13, 0.04, 0.036, C.suit, 5));
    const cuff = limb(0.02, 0.033, 0.033, C.shirt, 5);
    cuff.position.y = -0.125;
    fore.add(cuff);
    const hand = new THREE.Group();
    hand.position.y = -0.16;
    hand.add(mesh(new THREE.IcosahedronGeometry(0.042, 0), C.skin));
    fore.add(hand);
    arm.add(fore);
    arm.rotation.z = side * 0.12;
    body.add(arm);
    return { arm, fore, hand };
  };
  const L = mkArm(1);
  const R = mkArm(-1);

  // ── head: the big one ──
  const head = new THREE.Group();
  head.position.y = 0.6;
  head.scale.setScalar(1.17); // bobblehead proportions
  body.add(head);
  const neck = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 5), C.skin);
  neck.position.y = 0.02;
  head.add(neck);
  const skull = mesh(new THREE.IcosahedronGeometry(0.2, 1), C.skin);
  skull.scale.set(1, 1.08, 0.95);
  skull.position.y = 0.22;
  head.add(skull);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.IcosahedronGeometry(0.045, 0), C.skinShade);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(s * 0.198, 0.21, -0.01);
    head.add(ear);
  }
  // beard: the lower cap of a slightly bigger sphere, so it wraps jaw and chin and leaves the cheeks bare
  const beard = mesh(new THREE.SphereGeometry(0.206, 9, 6, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), C.hair);
  beard.scale.set(1.0, 1.05, 0.98);
  beard.position.set(0, 0.228, 0.012);
  head.add(beard);
  // sideburns joining beard to hair
  for (const s of [-1, 1]) {
    const burn = mesh(new THREE.BoxGeometry(0.03, 0.1, 0.07), C.hair);
    burn.position.set(s * 0.19, 0.2, 0.02);
    head.add(burn);
  }
  const moustache = mesh(new THREE.BoxGeometry(0.12, 0.028, 0.035), C.hair);
  moustache.position.set(0, 0.158, 0.192);
  moustache.rotation.x = -0.25;
  head.add(moustache);
  // a lopsided, pleased smile
  const smile = mesh(new THREE.TorusGeometry(0.036, 0.008, 3, 8, Math.PI), 0x3a1512, 0.4);
  smile.rotation.set(0, 0, Math.PI + 0.12);
  smile.position.set(0.006, 0.142, 0.196);
  head.add(smile);
  // mouth opening for speech, hidden until he talks
  const mouth = mesh(new THREE.BoxGeometry(0.05, 0.008, 0.012), 0x3a1512, 0.4);
  mouth.position.set(0.004, 0.122, 0.192);
  head.add(mouth);
  const nose = mesh(new THREE.IcosahedronGeometry(0.03, 0), C.skinShade);
  nose.scale.set(0.9, 1, 0.9);
  nose.position.set(0, 0.2, 0.2);
  head.add(nose);
  // eyes: a smug side-glance under heavy lids, like the reference
  for (const s of [-1, 1]) {
    const white = mesh(new THREE.IcosahedronGeometry(0.028, 1), C.eyeWhite, 0.3);
    white.scale.set(1.15, 0.72, 0.5);
    white.position.set(s * 0.074, 0.25, 0.178);
    head.add(white);
    const pupil = mesh(new THREE.IcosahedronGeometry(0.016, 1), C.pupil, 0.2);
    pupil.position.set(s * 0.074 + 0.011, 0.248, 0.19);
    head.add(pupil);
    const lid = mesh(new THREE.BoxGeometry(0.068, 0.018, 0.03), C.skinShade);
    lid.position.set(s * 0.074, 0.268, 0.182);
    lid.rotation.z = s * -0.08;
    head.add(lid);
  }
  const brow = (s: number) => {
    const b = mesh(new THREE.BoxGeometry(0.075, 0.022, 0.03), C.hair);
    b.position.set(s * 0.077, 0.305, 0.18);
    b.rotation.z = s * -0.12;
    head.add(b);
    return b;
  };
  const browL = brow(1);
  const browR = brow(-1);

  // ── hair or hat ──
  const hatColor = outfit === 'construction' ? C.hardhat : outfit === 'electrician' ? C.hardhatWhite : outfit === 'traffic' ? C.hardhatOrange : null;
  if (hatColor !== null) {
    const dome = mesh(new THREE.SphereGeometry(0.215, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), hatColor, 0.45);
    dome.scale.set(1, 0.85, 1);
    dome.position.y = 0.3;
    head.add(dome);
    const brim = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.022, 10), hatColor, 0.45);
    brim.scale.set(1, 1, 1.08);
    brim.position.set(0, 0.3, 0.02);
    head.add(brim);
    const ridge = mesh(new THREE.BoxGeometry(0.05, 0.022, 0.3), hatColor, 0.45);
    ridge.position.y = 0.468;
    head.add(ridge);
    // hair peeking out at the sides
    for (const s of [-1, 1]) {
      const side = mesh(new THREE.IcosahedronGeometry(0.07, 0), C.hair);
      side.position.set(s * 0.17, 0.3, -0.03);
      head.add(side);
    }
  } else if (outfit === 'sanitation') {
    const cap = mesh(new THREE.SphereGeometry(0.21, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), C.cap, 0.7);
    cap.position.y = 0.31;
    head.add(cap);
    const visor = mesh(new THREE.BoxGeometry(0.22, 0.02, 0.14), C.cap, 0.7);
    visor.position.set(0, 0.32, 0.22);
    head.add(visor);
  } else {
    // messy low-poly hair, like the reference
    const hair = mesh(new THREE.IcosahedronGeometry(0.21, 1), C.hair);
    hair.scale.set(1.03, 0.62, 1.02);
    hair.position.set(0, 0.34, -0.02);
    head.add(hair);
    for (let k = 0; k < 7; k++) {
      const tuft = mesh(new THREE.TetrahedronGeometry(0.07, 0), C.hair);
      const a = (k / 7) * Math.PI * 2;
      tuft.position.set(Math.cos(a) * 0.13, 0.43 + Math.sin(k * 2.1) * 0.02, Math.sin(a) * 0.12 - 0.02);
      tuft.rotation.set(k, k * 1.7, k * 0.6);
      head.add(tuft);
    }
  }

  // ── props ──
  const flag = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 5), C.pole);
  pole.position.y = 0.31;
  flag.add(pole);
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.62, 0, 0, 0.44, 0, -0.26, 0.53, 0], 3));
  cloth.computeVertexNormals();
  const clothMesh = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ color: C.flag, flatShading: true, side: THREE.DoubleSide, roughness: 0.7 }));
  clothMesh.castShadow = true;
  flag.add(clothMesh);
  flag.name = 'flag';
  R.hand.add(flag);
  flag.position.set(0, -0.2, 0);

  if (outfit === 'inspector') {
    const board = mesh(new THREE.BoxGeometry(0.13, 0.17, 0.012), C.board);
    const paper = mesh(new THREE.BoxGeometry(0.11, 0.13, 0.004), C.paper, 0.9);
    paper.position.z = 0.008;
    board.add(paper);
    board.position.set(0.02, -0.02, 0.05);
    board.rotation.x = -0.5;
    L.hand.add(board);
  }

  return {
    root, body, head, mouth, browL, browR,
    armL: L.arm, armR: R.arm, forearmL: L.fore, forearmR: R.fore,
    legL, legR, handR: R.hand, flag,
  };
}
