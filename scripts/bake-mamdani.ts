// Bakes Tripo's rigged Mamdani GLBs into .mrig packs the app can load anywhere, including Expo Go
// (which can't decode the GLB's embedded JPEG): geometry + skin + skeleton + raw RGB texture.
//
//   npx tsx scripts/bake-mamdani.ts
//
// Reads  .data/tripo/mamdani-{suit,construction}-rigged.glb
// Writes mobile/assets/models/mamdani-*.mrig
//
// Also: the construction model's flag was generated fused to his hand and got skinned to several
// bones. Its triangles are cut out into a separate rigid mesh in the right hand's space, so he can
// carry it stiffly and plant it in the ground. And his eyes are found (white pixels on the face),
// so the app can blink him.
import jpeg from 'jpeg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readGlb } from './glb';

const TEX = 1024;

interface Section {
  name: string;
  type: 'f32' | 'u8' | 'u16' | 'u32';
  data: ArrayLike<number>;
}

function bake(src: string, name: string, opts: { cutFlag: boolean }) {
  const g = readGlb(src);
  const j = g.json;
  const prim = j.meshes[0].primitives[0];
  const pos = g.accessor(prim.attributes.POSITION).data;
  const nrm = g.accessor(prim.attributes.NORMAL).data;
  const uv = g.accessor(prim.attributes.TEXCOORD_0).data;
  const joints = g.accessor(prim.attributes.JOINTS_0).data;
  const weights = g.accessor(prim.attributes.WEIGHTS_0).data;
  const index = g.accessor(prim.indices).data;
  const n = pos.length / 3;

  // ── skeleton: joints in skin order, with parents and rest TRS ──
  const skin = j.skins[0];
  const jointNodes: number[] = skin.joints;
  const parentOf = new Map<number, number>();
  j.nodes.forEach((nd: any, i: number) => (nd.children ?? []).forEach((c: number) => parentOf.set(c, i)));
  const bones = jointNodes.map((node) => {
    const nd = j.nodes[node];
    const p = parentOf.get(node);
    return {
      name: String(nd.name).replace(/^mixamorig:?/, ''),
      parent: p !== undefined && jointNodes.includes(p) ? jointNodes.indexOf(p) : -1,
      t: nd.translation ?? [0, 0, 0],
      r: nd.rotation ?? [0, 0, 0, 1],
      s: nd.scale ?? [1, 1, 1],
    };
  });
  const ibm = g.accessor(skin.inverseBindMatrices).data;
  const boneIndex = (bn: string) => bones.findIndex((b) => b.name === bn);

  // ── texture: decode, box-downsample to TEX, keep RGB ──
  const img = jpeg.decode(g.bufferView(j.images[j.textures[j.materials[0].pbrMetallicRoughness.baseColorTexture.index].source].bufferView), {
    useTArray: true,
    maxMemoryUsageInMB: 2048,
  });
  const f = img.width / TEX;
  const tex = new Uint8Array(TEX * TEX * 3);
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const acc = [0, 0, 0];
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const o = ((y * f + dy) * img.width + (x * f + dx)) * 4;
          acc[0] += img.data[o];
          acc[1] += img.data[o + 1];
          acc[2] += img.data[o + 2];
        }
      for (let c = 0; c < 3; c++) tex[(y * TEX + x) * 3 + c] = Math.round(acc[c] / (f * f));
    }
  const color = (i: number) => {
    const x = Math.min(img.width - 1, Math.max(0, Math.round(uv[i * 2] * (img.width - 1))));
    const y = Math.min(img.height - 1, Math.max(0, Math.round(uv[i * 2 + 1] * (img.height - 1))));
    const o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };

  // ── flag cut (model space: forward +X, up +Y, his right +Z) ──
  const isFlag = new Uint8Array(n);
  if (opts.cutFlag) {
    // the pole leans slightly: its inner edge runs from z≈0.02 at the ground to z≈0.09 at the top
    const edge = (y: number) => 0.018 + Math.max(0, y) * 0.085;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      if (z < edge(y)) continue;
      const [r, gg, b] = color(i);
      const skinTone = r > 175 && gg > 105 && b > 60 && r - b > 60 && gg / r > 0.55;
      if (skinTone && y > 0.36 && y < 0.58) continue; // his fingers wrapped round the pole
      // only the flag's own colours: red-orange cloth and a brown pole (not his navy cuff or shirt)
      const warm = r > 90 && r > b + 35 && r >= gg;
      if (!warm) continue;
      if (x < -0.12) continue; // nothing of the flag is behind him
      isFlag[i] = 1;
    }
  }

  // split triangles
  const bodyTris: number[] = [];
  const flagTris: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const flagged = isFlag[a] + isFlag[b] + isFlag[c];
    (flagged >= 2 ? flagTris : bodyTris).push(a, b, c);
  }

  // compact the body (drop vertices only the flag used)
  const remap = new Int32Array(n).fill(-1);
  let bn = 0;
  for (const v of bodyTris) if (remap[v] < 0) remap[v] = bn++;
  const bPos = new Float32Array(bn * 3), bNrm = new Float32Array(bn * 3), bUv = new Float32Array(bn * 2);
  const bJ = new Uint8Array(bn * 4), bW = new Float32Array(bn * 4);
  for (let i = 0; i < n; i++) {
    const k = remap[i];
    if (k < 0) continue;
    bPos.set(pos.slice(i * 3, i * 3 + 3), k * 3);
    bNrm.set(nrm.slice(i * 3, i * 3 + 3), k * 3);
    bUv.set(uv.slice(i * 2, i * 2 + 2), k * 2);
    bJ.set(joints.slice(i * 4, i * 4 + 4), k * 4);
    bW.set(weights.slice(i * 4, i * 4 + 4), k * 4);
  }
  const bIdx = bodyTris.map((v) => remap[v]);

  // the flag: rigid, stored in model space around the tip of its pole (which goes into the ground).
  // At runtime it's mounted on the right hand with the hand's inverse bind matrix, so it rides the
  // hand exactly; planted, it stands upright on its own.
  let flag: { count: number; bottom: number[]; sections: Section[] } | null = null;
  if (flagTris.length) {
    let bottom = [0, 1e9, 0];
    for (const v of flagTris) if (pos[v * 3 + 1] < bottom[1]) bottom = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const fmap = new Map<number, number>();
    const fPos: number[] = [], fNrm: number[] = [], fUv: number[] = [];
    for (const v of flagTris) {
      if (fmap.has(v)) continue;
      fmap.set(v, fmap.size);
      fPos.push(pos[v * 3] - bottom[0], pos[v * 3 + 1] - bottom[1], pos[v * 3 + 2] - bottom[2]);
      fNrm.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      fUv.push(uv[v * 2], uv[v * 2 + 1]);
    }
    flag = {
      count: fmap.size,
      bottom,
      sections: [
        { name: 'flag.position', type: 'f32', data: fPos },
        { name: 'flag.normal', type: 'f32', data: fNrm },
        { name: 'flag.uv', type: 'f32', data: fUv },
        { name: 'flag.index', type: 'u16', data: flagTris.map((v) => fmap.get(v)!) },
      ],
    };
  }

  // ── eyes: near-white texels on the front of the head (sampled inside triangles — eyes are
  //    smaller than the mesh's vertex spacing) ──
  let frontX = -1;
  for (let i = 0; i < n; i++) if (pos[i * 3 + 1] > 0.6) frontX = Math.max(frontX, pos[i * 3]);
  const eyeVerts: number[][] = [];
  const texel = (u: number, v: number) => {
    const o = (Math.round(v * (img.height - 1)) * img.width + Math.round(u * (img.width - 1))) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
  };
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    if (isFlag[a] || pos[a * 3 + 1] < 0.6 || pos[a * 3] < frontX - 0.08) continue;
    for (let s1 = 0; s1 <= 6; s1++)
      for (let s2 = 0; s2 <= 6 - s1; s2++) {
        const w1 = s1 / 6, w2 = s2 / 6, w0 = 1 - w1 - w2;
        const u = uv[a * 2] * w0 + uv[b * 2] * w1 + uv[c * 2] * w2;
        const v = uv[a * 2 + 1] * w0 + uv[b * 2 + 1] * w1 + uv[c * 2 + 1] * w2;
        const [r, gg, bb] = texel(u, v);
        if (r + gg + bb > 560 && Math.max(r, gg, bb) - Math.min(r, gg, bb) < 45) {
          eyeVerts.push([0, 1, 2].map((k) => pos[a * 3 + k] * w0 + pos[b * 3 + k] * w1 + pos[c * 3 + k] * w2));
        }
      }
  }
  const midZ = eyeVerts.reduce((s, p) => s + p[2], 0) / Math.max(1, eyeVerts.length);
  const eyes = [eyeVerts.filter((p) => p[2] < midZ), eyeVerts.filter((p) => p[2] >= midZ)].map((pts) => {
    const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / Math.max(1, pts.length));
    const spread = [0, 1, 2].map((k) => Math.sqrt(pts.reduce((s, p) => s + (p[k] - c[k]) ** 2, 0) / Math.max(1, pts.length)));
    return { center: c, spread, count: pts.length };
  });

  // where the face surface is in front of a point (the model's forward is +X)
  const surfaceX = (y: number, z: number, r: number) => {
    let best = -1e9;
    for (let i = 0; i < n; i++) {
      if (isFlag[i]) continue;
      if (Math.abs(pos[i * 3 + 1] - y) < r && Math.abs(pos[i * 3 + 2] - z) < r) best = Math.max(best, pos[i * 3]);
    }
    return best;
  };
  const gap = Math.abs(eyes[0].center[2] - eyes[1].center[2]);
  const eyeY = (eyes[0].center[1] + eyes[1].center[1]) / 2;
  const midZ2 = (eyes[0].center[2] + eyes[1].center[2]) / 2;
  const mouthY = eyeY - gap * 0.62;
  const face = {
    eyes: eyes.map((e) => [surfaceX(e.center[1], e.center[2], 0.012) + 0.002, e.center[1], e.center[2]]),
    mouth: [surfaceX(mouthY, midZ2, 0.012) + 0.002, mouthY, midZ2],
    eyeGap: gap,
  };

  const sections: Section[] = [
    { name: 'position', type: 'f32', data: bPos },
    { name: 'normal', type: 'f32', data: bNrm },
    { name: 'uv', type: 'f32', data: bUv },
    { name: 'skinIndex', type: 'u8', data: bJ },
    { name: 'skinWeight', type: 'f32', data: bW },
    { name: 'index', type: bn > 65535 ? 'u32' : 'u16', data: bIdx },
    { name: 'boneInverses', type: 'f32', data: ibm },
    ...(flag?.sections ?? []),
    { name: 'texture', type: 'u8', data: tex },
  ];
  const header = {
    format: 'mrig',
    version: 1,
    name,
    source: 'Tripo image-to-model + auto-rig (Mixamo bone names)',
    forward: '+x',
    vertexCount: bn,
    texture: { width: TEX, height: TEX, channels: 3 },
    bones,
    flag: flag && { vertexCount: flag.count, bone: 'RightHand', bottom: flag.bottom },
    eyes: eyes.map((e) => ({ center: e.center, spread: e.spread })),
    face,
    sections: [] as Array<{ name: string; type: string; offset: number; length: number }>,
  };

  // layout: "MRIG" | u32 header length | header JSON (padded to 4) | sections (each 4-aligned)
  const SIZES = { f32: 4, u8: 1, u16: 2, u32: 4 };
  let offset = 0;
  for (const s of sections) {
    header.sections.push({ name: s.name, type: s.type, offset, length: s.data.length });
    offset += Math.ceil((s.data.length * SIZES[s.type]) / 4) * 4;
  }
  const json = Buffer.from(JSON.stringify(header));
  const jsonPadded = Math.ceil(json.length / 4) * 4;
  const out = Buffer.alloc(8 + jsonPadded + offset, 0);
  out.write('MRIG', 0, 'ascii');
  out.writeUInt32LE(jsonPadded, 4);
  json.copy(out, 8);
  out.fill(0x20, 8 + json.length, 8 + jsonPadded);
  const base = 8 + jsonPadded;
  sections.forEach((s, k) => {
    const o = base + header.sections[k].offset;
    const T = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array }[s.type];
    const arr = T.from(s.data as ArrayLike<number>);
    Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).copy(out, o);
  });

  for (const dir of ['mobile/assets/models']) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${name}.mrig`, out);
  }
  console.log(
    `${name}: ${bn} verts, ${bIdx.length / 3} tris, ${bones.length} bones` +
      (flag ? `, flag ${flag.count} verts / ${flagTris.length / 3} tris` : '') +
      `, eyes ${eyes.map((e) => e.count).join('+')} texels, ${(out.length / 1e6).toFixed(2)} MB`,
  );
}

bake('.data/tripo/mamdani-suit-rigged.glb', 'mamdani-suit', { cutFlag: false });
bake('.data/tripo/mamdani-construction-rigged.glb', 'mamdani-construction', { cutFlag: true });
