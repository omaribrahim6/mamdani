import * as THREE from 'three';
import type { CharacterEmotion, Mood } from '@/lib/types';

// A face for a mesh that was generated without one. The Tripo model has no face bones and no
// blendshapes, only a painted texture, so we sculpt the shapes ourselves: each morph target moves
// the vertices around a landmark (mouth, eyes) with a soft falloff. The painted beard, lips and
// brows ride along with the surface, which is exactly what a cartoon face needs.

export const FACE_SHAPES = ['jawOpen', 'mouthWide', 'mouthRound', 'smile', 'browUp0', 'browUp1', 'browDown0', 'browDown1', 'squint0', 'squint1', 'blink0', 'blink1'] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];
export type FaceWeights = Record<FaceShape, number>;

export const neutralFace = (): FaceWeights => ({
  jawOpen: 0, mouthWide: 0, mouthRound: 0, smile: 0, browUp0: 0, browUp1: 0, browDown0: 0, browDown1: 0, squint0: 0, squint1: 0, blink0: 0, blink1: 0,
});

export interface FaceLandmarks {
  /** points on the face surface, model space (Tripo: +X forward, +Y up, Z across the face) */
  eyes: THREE.Vector3[];
  mouth: THREE.Vector3;
  eyeGap: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (x: number, s: number) => Math.exp(-((x / s) ** 2));

/**
 * Adds the FACE_SHAPES morph targets (relative offsets) to a skinned head's bind-pose geometry.
 * Everything is scaled by the gap between the eyes, so it fits whatever proportions the generator
 * produced. Safe to call twice: a geometry that already has them is left alone.
 */
export function addFaceMorphs(geometry: THREE.BufferGeometry, face: FaceLandmarks) {
  if (geometry.morphAttributes.position?.length) return;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const n = pos.count;
  const u = face.eyeGap;
  const m = face.mouth;
  const z0 = m.z; // the face's centre line
  const out = FACE_SHAPES.map(() => new Float32Array(n * 3));
  const [jaw, wide, round, smile, up0, up1, down0, down1, sq0, sq1, bl0, bl1] = out;
  const hinge = new THREE.Vector3(m.x - 0.9 * u, m.y + 0.05 * u, z0);
  const jawAngle = -0.36;
  const cos = Math.cos(jawAngle), sin = Math.sin(jawAngle);

  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const dx = x - m.x, dy = y - m.y, dz = z - z0;
    // only the front of the head, facing forward — never the back of the head or the collar
    const front = smooth(m.x - 1.25 * u, m.x - 0.55 * u, x) * smooth(-0.2, 0.25, nrm.getX(i));
    if (front <= 0) continue;
    const across = Math.abs(dz);
    const j = i * 3;

    // jaw: the lower face swings down about a hinge behind the mouth, fading out before the neck
    const lower = smooth(0.03 * u, -0.1 * u, dy) * smooth(-1.15 * u, -0.7 * u, dy) * bell(dz, 0.8 * u) * front;
    if (lower > 0) {
      const hx = x - hinge.x, hy = y - hinge.y;
      jaw[j] = (hx * cos - hy * sin - hx) * lower;
      jaw[j + 1] = (hx * sin + hy * cos - hy) * lower;
    }
    // the upper lip lifts a touch as the mouth opens
    const upperLip = bell(dy - 0.07 * u, 0.08 * u) * bell(dz, 0.45 * u) * front;
    jaw[j + 1] += 0.025 * u * upperLip;

    // mouth corners: out (wide / "ee"), and out-and-up (smile)
    const corners = bell(across - 0.24 * u, 0.15 * u) * bell(dy, 0.13 * u) * front;
    const side = Math.sign(dz) || 1;
    wide[j] = -0.05 * u * corners;
    wide[j + 2] = 0.18 * u * side * corners;
    smile[j] = -0.06 * u * corners;
    smile[j + 1] = 0.28 * u * corners;
    smile[j + 2] = 0.14 * u * side * corners;
    // cheeks bunch up in a real smile
    const cheek = bell(across - 0.42 * u, 0.2 * u) * bell(dy - 0.28 * u, 0.14 * u) * front;
    smile[j] += 0.05 * u * cheek;
    smile[j + 1] += 0.12 * u * cheek;

    // "oo": the lips gather toward the centre and push forward
    const lips = bell(Math.hypot(dz, dy * 1.3), 0.32 * u) * front;
    round[j] = 0.12 * u * lips;
    round[j + 1] = -dy * 0.2 * lips;
    round[j + 2] = -dz * 0.55 * lips;

    // brows: the band just above each painted eye
    face.eyes.forEach((e, k) => {
      const band = bell(z - e.z, 0.32 * u) * bell(y - (e.y + 0.3 * u), 0.17 * u) * smooth(e.x - 0.45 * u, e.x - 0.1 * u, x);
      if (band < 0.01) return;
      const inner = Math.sign(z0 - e.z); // toward the nose
      const innerness = smooth(-0.2 * u, 0.25 * u, (z - e.z) * inner); // the inner end moves more
      const up = k === 0 ? up0 : up1;
      const down = k === 0 ? down0 : down1;
      up[j + 1] += 0.3 * u * band * (0.7 + 0.3 * innerness);
      down[j + 1] -= 0.2 * u * band * (0.4 + 0.6 * innerness);
      down[j + 2] += 0.12 * u * inner * band * innerness;
      down[j] += 0.03 * u * band * innerness;
    });

    // squint: the painted eye is squeezed from below (cheek pushes up) and a little from above
    face.eyes.forEach((e, k) => {
      const across = bell(z - e.z, 0.26 * u) * smooth(e.x - 0.45 * u, e.x - 0.1 * u, x);
      if (across < 0.01) return;
      const below = bell(y - (e.y - 0.13 * u), 0.08 * u);
      const above = bell(y - (e.y + 0.1 * u), 0.06 * u);
      const sq = k === 0 ? sq0 : sq1;
      sq[j + 1] += (0.09 * u * below - 0.05 * u * above) * across;
      sq[j] += 0.015 * u * below * across;
    });

    // blink: the painted eye collapses onto a lid line a little below its centre (the upper lid
    // travels further). Morphs add up, so this closes the eye wherever the squint and brows have
    // moved it: a blink during a smile closes the smiling, squinted eye, not the neutral one.
    face.eyes.forEach((e, k) => {
      const across = bell(z - e.z, 0.24 * u) * smooth(e.x - 0.45 * u, e.x - 0.1 * u, x);
      if (across < 0.01) return;
      const line = e.y - 0.03 * u;
      const m = across * (1 - smooth(0.1 * u, 0.26 * u, Math.abs(y - line)));
      if (m <= 0) return;
      const bl = k === 0 ? bl0 : bl1;
      bl[j + 1] += (line - y) * m * 0.45; // a squash; the lid itself is drawn by the skin shader (addEyelids)
      bl[j] += 0.008 * u * m * (y > line ? 1 : 0); // the upper lid rounds forward over the eye
    });
  }

  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = out.map((a, k) => {
    const attr = new THREE.BufferAttribute(a, 3);
    attr.name = FACE_SHAPES[k];
    return attr;
  });
}

// ── expressions: what each emotion does to the face and the posture ──

type Look = Partial<FaceWeights> & { tilt?: number; chin?: number; chest?: number };

/** Gemini's emotion vocabulary (lib/types CHARACTER_EMOTIONS) → a held expression. */
export type Expression = CharacterEmotion | 'NEUTRAL' | 'LISTENING' | 'THINKING';

export const EXPRESSION: Record<Expression, Look> = {
  NEUTRAL: {},
  // his own states while the resident talks and while the report is processed
  LISTENING: { browUp0: 0.25, browUp1: 0.2, smile: 0.2, tilt: 0.05 },
  THINKING: { browDown0: 0.5, browDown1: 0.35, squint0: 0.5, squint1: 0.35, tilt: -0.05 },
  CHEERFUL: { smile: 0.9, browUp0: 0.35, browUp1: 0.35, squint0: 0.6, squint1: 0.6, chin: -0.04, chest: 0.04 },
  IMPRESSED: { smile: 0.5, browUp0: 0.85, browUp1: 0.85, mouthRound: 0.15, chin: -0.06, chest: 0.06 },
  CONCERNED: { browUp0: 0.6, browUp1: 0.6, browDown0: 0.3, browDown1: 0.3, squint0: 0.2, squint1: 0.2, tilt: 0.06, chin: 0.05 },
  DETERMINED: { browDown0: 0.8, browDown1: 0.8, smile: 0.15, squint0: 0.7, squint1: 0.7, mouthWide: 0.1, chin: 0.03, chest: 0.05 },
  // one brow up, one down, head cocked: the classic "huh?"
  CONFUSED: { browUp0: 0.8, browDown1: 0.55, tilt: 0.14 },
};

export const EMOTION_FOR_MOOD: Record<Mood, CharacterEmotion> = {
  dismayed: 'CONCERNED',
  determined: 'DETERMINED',
  impressed: 'IMPRESSED',
  confused: 'CONFUSED',
};

/** Mouth shape from a few cheap features of his voice (no transcript, no phonemes). */
export interface VoiceShape {
  /** loudness 0..1 */
  level: number;
  /** 0..1: hiss and bright vowels — "s", "ee" — spread the lips */
  bright: number;
  /** 0..1: dark, low-heavy sound — "oo", "o" — rounds them */
  dark: number;
}

// ── eyelids drawn on the skin ──
// The eyes are painted into the texture, so a blink can't reveal skin that isn't there. Instead the
// skin shader paints a lid over each eye. Its coordinates are fixed to the bind-pose surface (an
// "eye frame" per vertex), so they travel with every morph: in a squint, a raised brow or a smile,
// the lid closes over the eye where it now is.

/** Per-vertex eye-frame coordinates: (across, up) in eye radii, and which eye (0/1, or -1 = none). */
export function addEyeFrames(geometry: THREE.BufferGeometry, face: FaceLandmarks) {
  if (geometry.getAttribute('eyeFrame')) return;
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const u = face.eyeGap;
  const rx = 0.25 * u, ry = 0.15 * u;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let best = -1, bd = Infinity;
    face.eyes.forEach((e, k) => {
      const d = Math.hypot((z - e.z) / rx, (y - e.y) / ry);
      if (x > e.x - 0.35 * u && d < bd) { bd = d; best = k; }
    });
    const e = best >= 0 ? face.eyes[best] : null;
    out.set(e ? [(z - e.z) / rx, (y - e.y) / ry, best] : [9, 9, -1], i * 3);
  }
  geometry.setAttribute('eyeFrame', new THREE.BufferAttribute(out, 3));
}

/** Average colour of the clean skin just under the eyes (above them is brow shadow), from the model's own texture. */
export function eyelidColor(geometry: THREE.BufferGeometry, map: THREE.DataTexture, face: FaceLandmarks) {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const { data, width, height } = map.image as { data: Uint8Array; width: number; height: number };
  const u = face.eyeGap;
  let r = 0, g = 0, b = 0, c = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    for (const e of face.eyes) {
      if (Math.abs(z - e.z) < 0.12 * u && y < e.y - 0.2 * u && y > e.y - 0.32 * u && x > e.x - 0.3 * u) {
        const px = Math.min(width - 1, Math.max(0, Math.round(uv.getX(i) * (width - 1))));
        const py = Math.min(height - 1, Math.max(0, Math.round(uv.getY(i) * (height - 1))));
        const k = (py * width + px) * 4;
        r += data[k]; g += data[k + 1]; b += data[k + 2]; c++;
      }
    }
  }
  const col = new THREE.Color();
  return c ? col.setRGB(r / c / 255, g / c / 255, b / c / 255, THREE.SRGBColorSpace) : col.setHex(0xc98a5c);
}

/** Paint lids over the eyes in this material's skin shader; returns the per-eye blink uniforms. */
export function addEyelids(material: THREE.MeshStandardMaterial, skin: THREE.Color) {
  const uniforms = { uBlink0: { value: 0 }, uBlink1: { value: 0 }, uLid: { value: skin } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 eyeFrame;\nvarying vec3 vEyeFrame;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeFrame = eyeFrame;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeFrame;\nuniform float uBlink0;\nuniform float uBlink1;\nuniform vec3 uLid;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vEyeFrame.z > -0.5) {
          float shut = vEyeFrame.z < 0.5 ? uBlink0 : uBlink1;
          vec2 q = vEyeFrame.xy;
          // the eye's outline, and the lid's edge sweeping down from above it to just below centre
          float inside = 1.0 - smoothstep(1.0, 1.15, length(q));
          float edge = mix(1.2, -0.62, shut) - 0.12 * q.x * q.x; // curved lid line, down to the lower lid when shut
          float lid = inside * smoothstep(edge - 0.06, edge + 0.04, q.y) * step(0.01, shut);
          diffuseColor.rgb = mix(diffuseColor.rgb, uLid, lid);
          // lashes along the lid's edge
          float lash = inside * (1.0 - smoothstep(0.04, 0.16, abs(q.y - edge))) * smoothstep(0.05, 0.3, shut);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.04, 0.04), lash * 0.9);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'mamdani-eyelids';
  return uniforms;
}
