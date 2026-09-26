import * as THREE from 'three';
import { makeFlag, type MayorOutfit, type MayorRig } from './build';
import { addFaceMorphs, FACE_SHAPES, type FaceWeights } from './face';

// Tripo's generated Mamdani (image → 3D → auto-rig, Mixamo skeleton), loaded from a .mrig pack
// (scripts/bake-mamdani.ts) and wrapped so it answers to the same rig as the procedural one:
// the stage and portrait keep rotating `armR`, `forearmR`, `head`, `body`… and every frame those
// rotations are carried onto the skinned bones. A control's rotation means what it always meant —
// Euler angles in character space (+Z forward, +X his left, +Y up) about that joint — whatever
// odd axes the auto-rigger gave the bone.

export interface MrigPack {
  name: string;
  bones: Array<{ name: string; parent: number; t: number[]; r: number[]; s: number[] }>;
  geometry: THREE.BufferGeometry;
  boneInverses: THREE.Matrix4[];
  material: THREE.MeshStandardMaterial;
  flag: { geometry: THREE.BufferGeometry; bottom: THREE.Vector3 } | null;
  eyes: Array<{ center: THREE.Vector3 }>;
  /** points on the face surface (model space): where the eyelids and the talking mouth go */
  face: { eyes: THREE.Vector3[]; mouth: THREE.Vector3; eyeGap: number };
}

const HEIGHT = 1.18; // the procedural rig's height; every stage constant assumes it

export function parseMrig(buf: ArrayBuffer): MrigPack {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'MRIG') throw new Error('not a .mrig pack');
  const len = new DataView(buf).getUint32(4, true);
  let json = '';
  for (let i = 0; i < len; i++) json += String.fromCharCode(u8[8 + i]);
  const h = JSON.parse(json);
  const base = 8 + len;
  const get = (name: string) => {
    const s = h.sections.find((x: { name: string }) => x.name === name);
    if (!s) return null;
    const T = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array }[s.type as 'f32'];
    return new T(buf, base + s.offset, s.length);
  };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(get('position')!, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(get('normal')!, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(get('uv')!, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(get('skinIndex')!, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(get('skinWeight')!, 4));
  geometry.setIndex(new THREE.BufferAttribute(get('index')!, 1));

  const inv = get('boneInverses')!;
  const boneInverses = h.bones.map((_: unknown, i: number) => new THREE.Matrix4().fromArray(inv, i * 16));

  // RGB → RGBA once, then a plain data texture: no image decoding on the phone
  const { width, height } = h.texture;
  const rgb = get('texture')!;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];
    rgba[j + 1] = rgb[i + 1];
    rgba[j + 2] = rgb[i + 2];
    rgba[j + 3] = 255;
  }
  const map = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false; // glTF UVs: v runs down the image
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });

  let flag: MrigPack['flag'] = null;
  if (h.flag) {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(get('flag.position')!, 3));
    fg.setAttribute('normal', new THREE.BufferAttribute(get('flag.normal')!, 3));
    fg.setAttribute('uv', new THREE.BufferAttribute(get('flag.uv')!, 2));
    fg.setIndex(new THREE.BufferAttribute(get('flag.index')!, 1));
    flag = { geometry: fg, bottom: new THREE.Vector3().fromArray(h.flag.bottom) };
  }

  return {
    name: h.name,
    bones: h.bones,
    geometry,
    boneInverses,
    material,
    flag,
    eyes: h.eyes.map((e: { center: number[] }) => ({ center: new THREE.Vector3().fromArray(e.center) })),
    face: {
      eyes: h.face.eyes.map((p: number[]) => new THREE.Vector3().fromArray(p)),
      mouth: new THREE.Vector3().fromArray(h.face.mouth),
      eyeGap: h.face.eyeGap,
    },
  };
}

const matrixToObject = (o: THREE.Object3D, m: THREE.Matrix4) => m.decompose(o.position, o.quaternion, o.scale);

export function buildTripoMayor(pack: MrigPack, outfit: MayorOutfit): MayorRig {
  const root = new THREE.Group();
  root.name = `mamdani-${pack.name}`;
  root.userData = { character: 'Mamdani', outfit, source: 'tripo' };
  // Tripo space (forward +X, 1 unit tall) → character space (forward +Z, 1.18 tall)
  const model = new THREE.Group();
  model.rotation.y = -Math.PI / 2;
  model.scale.setScalar(HEIGHT);
  root.add(model);
  const inner = new THREE.Group();
  model.add(inner);

  const bones = pack.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.fromArray(b.t);
    bone.quaternion.fromArray(b.r);
    bone.scale.fromArray(b.s);
    return bone;
  });
  pack.bones.forEach((b, i) => (b.parent >= 0 ? bones[b.parent] : inner).add(bones[i]));
  const bone = (n: string) => bones.find((b) => b.name === n)!;

  // stand him on the origin: hips over (0, 0)
  inner.updateMatrixWorld(true);
  const hips = inner.worldToLocal(bone('Hips').getWorldPosition(new THREE.Vector3()));
  inner.position.set(-hips.x, 0, -hips.z);

  // sculpt the face shapes once per pack (the geometry is shared by every Mamdani built from it)
  addFaceMorphs(pack.geometry, pack.face);
  const mesh = new THREE.SkinnedMesh(pack.geometry, pack.material);
  mesh.castShadow = true;
  mesh.frustumCulled = false; // skinned bounds move with the pose
  inner.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones, pack.boneInverses.map((m) => m.clone())), new THREE.Matrix4());

  // ── controls: the procedural rig's joints, as plain groups the animation code rotates ──
  const ctl = (name: string) => Object.assign(new THREE.Group(), { name });
  const body = ctl('body'), head = ctl('head');
  const armL = ctl('arm-left'), armR = ctl('arm-right'), forearmL = ctl('forearm-left'), forearmR = ctl('forearm-right');
  const legL = ctl('leg-left'), legR = ctl('leg-right');

  // each driven bone remembers its rest pose and its rest orientation relative to the character
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const inRoot = (o: THREE.Object3D) => root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
  const drive = (name: string) => {
    const b = bone(name);
    const rest = b.quaternion.clone();
    const world = rootInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
    return { b, rest, world, worldInv: world.clone().invert(), neutral: new THREE.Quaternion() };
  };
  // The procedural rig's zero pose is arms hanging straight. The generated model's arms rest
  // wherever the image had them (the construction one holds its flag with the elbow bent), so
  // each arm gets a correction that straightens it; zero then means the same thing on both rigs.
  const straighten = (j: ReturnType<typeof drive>, from: string, to: string, toward: THREE.Vector3) => {
    const dir = inRoot(bone(to)).sub(inRoot(bone(from))).normalize();
    j.neutral.setFromUnitVectors(dir, toward.clone().normalize());
  };
  const J = {
    spine: drive('Spine'),
    neck: drive('Neck'),
    head: drive('Head'),
    armL: drive('LeftArm'),
    armR: drive('RightArm'),
    foreL: drive('LeftForeArm'),
    foreR: drive('RightForeArm'),
    legL: drive('LeftUpLeg'),
    legR: drive('RightUpLeg'),
    kneeL: drive('LeftLeg'),
    kneeR: drive('RightLeg'),
  };
  const down = new THREE.Vector3(0, -1, 0);
  for (const side of ['Left', 'Right'] as const) {
    const arm = side === 'Left' ? J.armL : J.armR;
    const fore = side === 'Left' ? J.foreL : J.foreR;
    const upper = inRoot(bone(`${side}ForeArm`)).sub(inRoot(bone(`${side}Arm`))).normalize();
    straighten(arm, `${side}Arm`, `${side}ForeArm`, down);
    // the forearm lines up with the upper arm (a straight elbow)
    straighten(fore, `${side}ForeArm`, `${side}Hand`, upper);
  }
  /** Control angles that reproduce the generated pose of the right arm (how he holds his flag). */
  const asEuler = (qq: THREE.Quaternion) => new THREE.Euler().setFromQuaternion(qq);
  const flagCarry = {
    arm: asEuler(J.armR.neutral.clone().invert()),
    forearm: asEuler(J.foreR.neutral.clone().invert()),
  };

  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const I = new THREE.Quaternion();
  const part = new THREE.Quaternion();
  const apply = (j: (typeof J)['spine'], rot: THREE.Euler | THREE.Quaternion, amount = 1) => {
    if (rot instanceof THREE.Euler) q.setFromEuler(rot);
    else q.copy(rot);
    // (slerp from a copy: slerpQuaternions(I, q, …) would overwrite q before reading it)
    if (amount !== 1) q.slerpQuaternions(I, part.copy(q), amount);
    q.multiply(j.neutral);
    // character-space rotation about the joint → the bone's own frame
    j.b.quaternion.copy(j.rest).multiply(j.worldInv.clone().multiply(q).multiply(j.world));
  };

  // hand sockets: frames on the hand bones that line up with character space at rest, so props
  // mounted there use the same offsets as on the procedural rig
  const socket = (name: string, handName: string) => {
    const s = ctl(name);
    const hb = bone(handName);
    const w = rootInv.clone().multiply(hb.getWorldQuaternion(new THREE.Quaternion()));
    s.quaternion.copy(w.invert());
    // cancel the model's scale too: props are sized in the procedural rig's units
    s.scale.setScalar(1 / HEIGHT);
    s.position.set(0, 0.035, 0); // from the wrist toward the palm
    hb.add(s);
    return s;
  };
  const handR = socket('hand-right', 'RightHand');
  const handL = socket('hand-left', 'LeftHand');

  // the flag: its own rigid mesh, mounted where it was generated — in his right hand
  // no flag in the model: the procedural one, which the stage puts in his hand when needed
  let flag: THREE.Group = makeFlag();
  let flagBuiltIn = false;
  if (pack.flag) {
    const hi = pack.bones.findIndex((b) => b.name === 'RightHand');
    const mount = ctl('flag-mount');
    matrixToObject(mount, pack.boneInverses[hi].clone().multiply(new THREE.Matrix4().makeTranslation(pack.flag.bottom)));
    bone('RightHand').add(mount);
    flag = ctl('flag');
    const fm = new THREE.Mesh(pack.flag.geometry, pack.material);
    fm.castShadow = true;
    flag.add(fm);
    mount.add(flag);
    flag.userData.mount = mount;
    flag.userData.scale = HEIGHT; // world scale relative to the character root
    flagBuiltIn = true;
  }

  // ── face: a mouth that opens over the beard, and eyelids to blink ──
  // Face parts live in a frame on the head bone that keeps the model's axes (X forward, Y up,
  // Z his right), so their sizes read the same whatever roll the auto-rigger gave the bone.
  const headBone = bone('Head');
  const headInv = pack.boneInverses[pack.bones.findIndex((b) => b.name === 'Head')];
  const facing = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(headInv));
  const faceFrame = new THREE.Group();
  faceFrame.quaternion.copy(facing);
  headBone.add(faceFrame);
  const back = facing.clone().invert();
  const toHead = (p: THREE.Vector3) => p.clone().applyMatrix4(headInv).applyQuaternion(back);
  const [e1, e2] = pack.face.eyes;
  const eyeGap = pack.face.eyeGap;
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x2a1412, roughness: 0.9 }));
  mouth.name = 'speaking-mouth';
  mouth.position.copy(toHead(pack.face.mouth));
  mouth.scale.set(0.01, 0.011, eyeGap * 0.17);
  mouth.userData.base = mouth.scale.clone();
  mouth.visible = false;
  faceFrame.add(mouth);

  const makeLids = () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc98a5c, roughness: 0.85 });
    return [e1, e2].map((c) => {
      const lid = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), mat);
      lid.position.copy(toHead(new THREE.Vector3(c.x - 0.004, c.y + 0.001, c.z)));
      lid.scale.set(0.01, 0.017, eyeGap * 0.2);
      lid.userData.sy = 0.016;
      lid.visible = false;
      faceFrame.add(lid);
      return lid;
    });
  };

  const dummy = () => new THREE.Mesh();
  const rig: MayorRig = {
    root,
    body,
    head,
    mouth,
    browL: dummy(),
    browR: dummy(),
    armL,
    armR,
    forearmL,
    forearmR,
    legL,
    legR,
    handR,
    handL,
    flag,
    flagBuiltIn,
    flagCarry: flagBuiltIn ? flagCarry : undefined,
    mouthOverlay: true,
    headAnchor: headBone,
    makeLids,
    setFace(w: FaceWeights) {
      const inf = mesh.morphTargetInfluences;
      if (!inf) return;
      for (let i = 0; i < FACE_SHAPES.length; i++) inf[i] = w[FACE_SHAPES[i]];
      // the dark opening behind the lips grows with the jaw
      const base = mouth.userData.base as THREE.Vector3;
      mouth.userData.jaw = w.jawOpen;
      mouth.scale.set(base.x, base.y * (0.3 + w.jawOpen * 1.9), base.z * (0.75 + w.mouthWide * 0.5 - w.mouthRound * 0.35));
    },
    update() {
      apply(J.spine, body.rotation);
      bone('Spine').scale.copy(body.scale);
      model.position.y = body.position.y;
      // a little of every head turn goes to the neck, like a person
      e.copy(head.rotation);
      apply(J.neck, e, 0.35);
      apply(J.head, e, 0.65);
      apply(J.armL, armL.rotation);
      apply(J.armR, armR.rotation);
      apply(J.foreL, forearmL.rotation);
      apply(J.foreR, forearmR.rotation);
      apply(J.legL, legL.rotation);
      apply(J.legR, legR.rotation);
      // knees follow the thigh: a leg swung back bends at the knee
      const knee = (x: number) => e.set(Math.max(0, x) * 0.9 + Math.max(0, -x) * 0.3, 0, 0);
      apply(J.kneeL, knee(legL.rotation.x));
      apply(J.kneeR, knee(legR.rotation.x));
    },
  };
  // start relaxed: arms at the sides, like the reference
  rig.update!();
  return rig;
}
