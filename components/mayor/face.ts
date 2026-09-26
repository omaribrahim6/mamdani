import * as THREE from 'three';
import type { CharacterEmotion, Mood } from '@/lib/types';

// A face for a mesh that was generated without one. The Tripo model has no face bones and no
// blendshapes, only a painted texture, so we sculpt the shapes ourselves: each morph target moves
// the vertices around a landmark (mouth, eyes) with a soft falloff. The painted beard, lips and
// brows ride along with the surface, which is exactly what a cartoon face needs.

export const FACE_SHAPES = ['jawOpen', 'mouthWide', 'mouthRound', 'smile', 'browUp0', 'browUp1', 'browDown0', 'browDown1'] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];
export type FaceWeights = Record<FaceShape, number>;

export const neutralFace = (): FaceWeights => ({
  jawOpen: 0, mouthWide: 0, mouthRound: 0, smile: 0, browUp0: 0, browUp1: 0, browDown0: 0, browDown1: 0,
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
  const [jaw, wide, round, smile, up0, up1, down0, down1] = out;
  const hinge = new THREE.Vector3(m.x - 0.9 * u, m.y + 0.05 * u, z0);
  const jawAngle = -0.3;
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
    wide[j] = -0.02 * u * corners;
    wide[j + 2] = 0.07 * u * side * corners;
    smile[j] = -0.025 * u * corners;
    smile[j + 1] = 0.11 * u * corners;
    smile[j + 2] = 0.06 * u * side * corners;
    // cheeks bunch up in a real smile
    const cheek = bell(across - 0.42 * u, 0.2 * u) * bell(dy - 0.28 * u, 0.14 * u) * front;
    smile[j] += 0.02 * u * cheek;
    smile[j + 1] += 0.05 * u * cheek;

    // "oo": the lips gather toward the centre and push forward
    const lips = bell(Math.hypot(dz, dy * 1.3), 0.32 * u) * front;
    round[j] = 0.05 * u * lips;
    round[j + 1] = -dy * 0.2 * lips;
    round[j + 2] = -dz * 0.38 * lips;

    // brows: the band just above each painted eye
    face.eyes.forEach((e, k) => {
      const band = bell(z - e.z, 0.32 * u) * bell(y - (e.y + 0.3 * u), 0.17 * u) * smooth(e.x - 0.45 * u, e.x - 0.1 * u, x);
      if (band < 0.01) return;
      const inner = Math.sign(z0 - e.z); // toward the nose
      const innerness = smooth(-0.2 * u, 0.25 * u, (z - e.z) * inner); // the inner end moves more
      const up = k === 0 ? up0 : up1;
      const down = k === 0 ? down0 : down1;
      up[j + 1] += 0.1 * u * band * (0.7 + 0.3 * innerness);
      down[j + 1] -= 0.068 * u * band * (0.4 + 0.6 * innerness);
      down[j + 2] += 0.045 * u * inner * band * innerness;
      down[j] += 0.012 * u * band * innerness;
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
  THINKING: { browDown0: 0.45, browDown1: 0.3, tilt: -0.05 },
  CHEERFUL: { smile: 0.85, browUp0: 0.3, browUp1: 0.3, chin: -0.04, chest: 0.04 },
  IMPRESSED: { smile: 0.5, browUp0: 0.85, browUp1: 0.85, mouthRound: 0.15, chin: -0.06, chest: 0.06 },
  CONCERNED: { browUp0: 0.55, browUp1: 0.55, browDown0: 0.25, browDown1: 0.25, tilt: 0.06, chin: 0.05 },
  DETERMINED: { browDown0: 0.75, browDown1: 0.75, smile: 0.15, mouthWide: 0.1, chin: 0.03, chest: 0.05 },
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
