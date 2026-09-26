import * as THREE from 'three';
import type { Outfit } from '@/lib/categories';
import { bake, ellipsoid, mesh, panel, profile, triangles, type Point } from './geometry';
import { sculptHead } from './head';

// Reference sculpt. Feet at Y=0; forward +Z; height ~1.18. Both clients use this rig.
export type MayorOutfit = Outfit | 'suit';
const C = {
  skin: 0xe4a068, skinLight: 0xeda974, skinShade: 0xc78050,
  suit: 0x222337, lapel: 0x292a40, seam: 0x191b2b,
  shirt: 0xeae5e8, tie: 0x852c32, tieLight: 0x9d3b3d,
  shoe: 0x211e1d, sole: 0x141415, shoeHighlight: 0x38312a,
  vestOrange: 0xf2521c, vestLime: 0xc3d72a, stripe: 0xfbe22b,
  flag: 0xff4a25, pole: 0x9e7042, belt: 0x684b32, board: 0x986e43,
};

export interface MayorRig {
  root: THREE.Group;
  body: THREE.Group;
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
  handR: THREE.Group;
  flag: THREE.Group;
  // ── optional: set by rigs that aren't built from primitives (components/mayor/tripo.ts) ──
  /** left-hand prop mount */
  handL?: THREE.Object3D;
  /** the flag is part of the model and already sits in his hand */
  flagBuiltIn?: boolean;
  /** right-arm control angles that hold that built-in flag the way it was generated */
  flagCarry?: { arm: THREE.Euler; forearm: THREE.Euler };
  /** the mouth is a separate opening shown only while talking (instead of a stretching smile) */
  mouthOverlay?: boolean;
  /** what to measure for his head's on-screen position when `head` isn't in the scene */
  headAnchor?: THREE.Object3D;
  /** builds eyelids for blinking; defaults to the procedural head's lids */
  makeLids?: () => THREE.Mesh[];
  /** carry the joint controls onto the real skeleton; called every frame before rendering */
  update?: () => void;
}

const group = (name: string, parent?: THREE.Object3D) => {
  const g = new THREE.Group();
  g.name = name;
  parent?.add(g);
  return g;
};
const mirror = (points: Point[], side: number): Point[] => points.map(([x, y, z]) => [x * side, y, z]);

function addTorso(body: THREE.Group, outfit: MayorOutfit) {
  // Squared-off jacket with an actual split hem and overlapping tailored fronts.
  body.add(profile([[0.302, 0.121, 0.067], [0.334, 0.130, 0.073], [0.435, 0.120, 0.079], [0.544, 0.143, 0.077], [0.585, 0.118, 0.061]], C.suit, 12, 0.65));
  body.add(profile([[0.583, 0.047, 0.041], [0.626, 0.043, 0.040]], C.skinShade, 10));
  body.add(panel([[-0.070, 0.587, 0.064], [0.067, 0.587, 0.064], [0.052, 0.488, 0.082], [0, 0.366, 0.087], [-0.055, 0.487, 0.082]], C.shirt, 0.006));
  for (const s of [-1, 1]) {
    body.add(panel(mirror([[0.077, 0.583, 0.066], [0.131, 0.560, 0.055], [0.126, 0.435, 0.078], [0.133, 0.314, 0.081], [0.075, 0.301, 0.091], [0.033, 0.310, 0.095], [0.023, 0.430, 0.096]], s), C.suit, 0.021));
    body.add(panel(mirror([[0.060, 0.590, 0.075], [0.097, 0.571, 0.067], [0.082, 0.540, 0.091], [0.105, 0.527, 0.086], [0.026, 0.414, 0.100], [0.044, 0.535, 0.087]], s), C.lapel, 0.009));
    body.add(panel(mirror([[0.008, 0.573, 0.085], [0.044, 0.602, 0.062], [0.060, 0.582, 0.075], [0.044, 0.539, 0.096]], s), C.shirt, 0.005));
    body.add(panel(mirror([[0.074, 0.383, 0.093], [0.118, 0.385, 0.084], [0.120, 0.365, 0.085], [0.074, 0.364, 0.096]], s), C.lapel, 0.004));
    for (const y of [0.371, 0.411]) body.add(ellipsoid([s * 0.039, y, 0.101], [0.004, 0.004, 0.0015], C.seam, 1));
  }
  body.add(panel([[-0.020, 0.566, 0.100], [0.019, 0.566, 0.100], [0.025, 0.548, 0.105], [0.009, 0.528, 0.110], [-0.011, 0.528, 0.110], [-0.027, 0.549, 0.103]], C.tie, 0.010));
  body.add(panel([[-0.010, 0.532, 0.107], [0.010, 0.532, 0.107], [0.028, 0.356, 0.108], [0.002, 0.330, 0.112], [-0.030, 0.353, 0.107]], C.tie, 0.008));
  body.add(panel([[-0.006, 0.526, 0.117], [0.006, 0.526, 0.118], [0.018, 0.369, 0.118], [0.001, 0.346, 0.121], [-0.003, 0.422, 0.119]], C.tieLight, 0.002, 0.015));
  if (['construction', 'traffic', 'sanitation'].includes(outfit)) {
    const orange = outfit === 'sanitation' ? C.vestLime : C.vestOrange;
    // Two open front panels keep the shirt, tie and lapels visible.
    for (const s of [-1, 1]) {
      body.add(panel(mirror([[0.084, 0.583, 0.076], [0.124, 0.574, 0.067], [0.153, 0.546, 0.058], [0.140, 0.437, 0.087], [0.143, 0.307, 0.100], [0.080, 0.300, 0.112], [0.063, 0.310, 0.116], [0.059, 0.440, 0.112], [0.064, 0.524, 0.098]], s), orange, 0.012, 0.02));
      body.add(panel(mirror([[0.092, 0.583, 0.082], [0.113, 0.577, 0.078], [0.096, 0.507, 0.108], [0.092, 0.413, 0.121], [0.115, 0.408, 0.119], [0.115, 0.374, 0.122], [0.071, 0.378, 0.125], [0.074, 0.513, 0.109]], s), C.stripe, 0.003, 0.012));
      body.add(panel(mirror([[0.061, 0.407, 0.119], [0.143, 0.405, 0.101], [0.143, 0.373, 0.109], [0.062, 0.376, 0.123]], s), C.stripe, 0.004, 0.012));
      const back = panel(mirror([[0, 0.582, -0.072], [0.082, 0.576, -0.078], [0.137, 0.560, -0.069], [0.137, 0.319, -0.081], [0, 0.309, -0.088]], s), orange, 0.008);
      back.material = (back.material as THREE.MeshStandardMaterial).clone();
      (back.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      body.add(back);
      const tape = panel(mirror([[0.088, 0.574, -0.081], [0.109, 0.566, -0.083], [0.097, 0.324, -0.094], [0.075, 0.320, -0.094]], s), C.stripe, 0.004);
      tape.material = back.material;
      body.add(tape);
      const beltTape = panel(mirror([[0, 0.407, -0.094], [0.137, 0.405, -0.091], [0.137, 0.375, -0.092], [0, 0.377, -0.095]], s), C.stripe, 0.003);
      beltTape.material = back.material;
      body.add(beltTape);
      body.add(mesh(triangles(mirror([[0.084, 0.583, 0.076], [0.124, 0.574, 0.067], [0.137, 0.560, -0.069], [0.082, 0.576, -0.078]], s), s > 0 ? [[0, 1, 2], [0, 2, 3]] : [[2, 1, 0], [3, 2, 0]]), orange));
    }
  }
  if (outfit === 'electrician') {
    body.add(profile([[0.312, 0.135, 0.084], [0.338, 0.135, 0.084]], C.belt, 12, 0.65));
    const pouch = profile([[-0.040, 0.032, 0.017], [0.035, 0.037, 0.022]], C.belt, 8, 0.55);
    pouch.position.set(0.119, 0.295, 0.074);
    body.add(pouch);
  }
}

function addLeg(root: THREE.Group, side: number) {
  const leg = group(side > 0 ? 'leg-left' : 'leg-right', root);
  leg.position.set(side * 0.067, 0.328, 0);
  leg.rotation.z = side * 0.28;
  leg.add(profile([[-0.268, 0.057, 0.052], [-0.251, 0.058, 0.050], [-0.158, 0.055, 0.052], [-0.111, 0.060, 0.054], [-0.025, 0.066, 0.059], [0.019, 0.065, 0.057]], C.suit, 10, 0.63));
  leg.add(profile([[-0.272, 0.061, 0.055], [-0.247, 0.062, 0.054]], C.lapel, 10, 0.63));
  leg.add(panel([[-0.011, -0.031, 0.061], [0.002, -0.117, 0.057], [0.005, -0.250, 0.055], [-0.006, -0.161, 0.058]], C.lapel, 0.001, 0));
  const shoe = group('oxford-shoe', leg);
  shoe.position.set(0, -0.282, 0.013);
  shoe.rotation.z = -side * 0.28;
  shoe.rotation.y = side * 0.12;
  shoe.add(profile([[-0.054, 0.064, 0.103, 0.030], [-0.038, 0.066, 0.105, 0.030], [-0.032, 0.064, 0.101, 0.031]], C.sole, 12, 0.58));
  shoe.add(profile([[-0.032, 0.063, 0.100, 0.031], [-0.009, 0.060, 0.095, 0.029], [0.010, 0.050, 0.056, -0.001], [0.043, 0.043, 0.040, -0.009]], C.shoe, 12, 0.62));
  shoe.add(panel([[-0.049, -0.008, 0.100], [-0.033, 0.004, 0.094], [0.032, 0.004, 0.094], [0.050, -0.008, 0.100], [0.038, -0.016, 0.124], [-0.039, -0.016, 0.124]], C.shoeHighlight, 0.002, 0.01));
  for (let i = 0; i < 3; i++) {
    const lace = mesh(new THREE.BoxGeometry(0.040 - i * 0.004, 0.003, 0.003), C.sole, 0);
    lace.position.set(0, 0.009 + i * 0.009, 0.071 - i * 0.014);
    lace.rotation.x = -0.5;
    shoe.add(lace);
  }
  return leg;
}

function addArm(body: THREE.Group, side: number) {
  const arm = group(side > 0 ? 'arm-left' : 'arm-right', body);
  arm.position.set(side * 0.137, 0.555, 0);
  arm.add(profile([[-0.149, 0.039, 0.043], [-0.116, 0.044, 0.047], [-0.039, 0.052, 0.050], [0.012, 0.044, 0.043]], C.suit, 8, 0.74));
  const fore = group(side > 0 ? 'forearm-left' : 'forearm-right', arm);
  fore.position.y = -0.143;
  fore.add(profile([[-0.134, 0.037, 0.038], [-0.111, 0.039, 0.041], [-0.030, 0.044, 0.044], [0.009, 0.039, 0.042]], C.suit, 8, 0.66));
  fore.add(profile([[-0.146, 0.034, 0.035], [-0.132, 0.035, 0.037]], C.shirt, 8, 0.65));
  for (let i = 0; i < 3; i++) fore.add(ellipsoid([side * 0.036, -0.116 + i * 0.011, 0.018], [0.003, 0.003, 0.002], C.seam, 0));
  const hand = group(side > 0 ? 'hand-left' : 'hand-right', fore);
  hand.position.y = -0.163;
  hand.add(ellipsoid([0, -0.011, 0.004], [0.041, 0.044, 0.031], C.skin, 1));
  for (let i = 0; i < 4; i++) {
    const finger = ellipsoid([side * 0.008, -0.036 + i * 0.016, 0.028], [0.030 - Math.abs(i - 1.5) * 0.003, 0.010, 0.014], i % 2 ? C.skin : C.skinLight, 0);
    finger.rotation.z = side * -0.11;
    hand.add(finger);
  }
  const thumb = ellipsoid([-side * 0.027, 0.011, 0.023], [0.015, 0.026, 0.018], C.skinLight, 1);
  thumb.rotation.z = -side * 0.5;
  hand.add(thumb);
  return { arm, fore, hand };
}

export function makeFlag() {
  const flag = group('flag');
  const pole = mesh(new THREE.CylinderGeometry(0.010, 0.012, 0.88, 7), C.pole, 0.03);
  pole.position.y = 0.44;
  flag.add(pole);
  const cloth = mesh(triangles([
    [-0.003, 0.845, 0], [-0.107, 0.742, 0.020], [-0.270, 0.582, 0.003],
    [-0.170, 0.579, 0.016], [-0.076, 0.583, -0.010], [-0.002, 0.581, 0],
  ], [[0, 1, 4], [0, 4, 5], [1, 3, 4], [1, 2, 3]]), C.flag, 0.07);
  cloth.material = (cloth.material as THREE.MeshStandardMaterial).clone();
  (cloth.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  flag.add(cloth);
  return flag;
}

/** Reference stance, reused after the flag-plant animation. */
export function poseMayorAtRest(rig: MayorRig, holdingFlag = false) {
  rig.armL.rotation.set(-0.10, 0, 0.80);
  rig.forearmL.rotation.set(-0.34, 0, -1.50);
  rig.armR.rotation.set(-0.10, 0, -0.80);
  rig.forearmR.rotation.set(-0.34, 0, 1.50);
  if (holdingFlag) {
    rig.armR.rotation.set(0, 0, -1.12);
    rig.forearmR.rotation.set(0, 0, -0.39);
    const flagAngle = 1.68;
    rig.flag.position.set(Math.sin(flagAngle) * 0.485, -Math.cos(flagAngle) * 0.485, 0.035);
    rig.flag.rotation.set(0, 0, flagAngle);
  }
  rig.head.rotation.set(-0.08, 0.18, 0.16);
}

export function buildMayor(outfit: MayorOutfit): MayorRig {
  const root = group(`mamdani-${outfit}`);
  root.userData = { character: 'Mamdani', outfit, modelVersion: 2 };
  const body = group('body', root);
  const legL = addLeg(root, 1), legR = addLeg(root, -1);
  addTorso(body, outfit);
  const L = addArm(body, 1), R = addArm(body, -1);
  const { head, mouth, browL, browR } = sculptHead(outfit);
  body.add(head);
  const flag = makeFlag();
  // Prop-free suit model; its unattached flag remains available to animation callers.
  if (outfit !== 'suit') R.hand.add(flag);
  if (outfit === 'inspector') {
    const board = mesh(new THREE.BoxGeometry(0.115, 0.153, 0.012), C.board);
    const paper = mesh(new THREE.BoxGeometry(0.099, 0.125, 0.003), C.shirt);
    paper.position.z = 0.008;
    board.add(paper);
    board.position.set(0.006, -0.020, 0.049);
    board.rotation.x = -0.25;
    L.hand.add(board);
  }
  const rig: MayorRig = { root, body, head, mouth, browL, browR, armL: L.arm, armR: R.arm, forearmL: L.fore, forearmR: R.fore, legL, legR, handR: R.hand, flag };
  poseMayorAtRest(rig, outfit !== 'suit');
  bake(root, new Set([mouth, browL, browR]));
  return rig;
}

/** Two independent models matching the two outfits in the supplied reference. */
export const buildConstructionMayor = () => buildMayor('construction');
export const buildSuitMayor = () => buildMayor('suit');
