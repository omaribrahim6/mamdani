import { buildMayor, type MayorOutfit, type MayorRig } from './build';
import { buildTripoMayor, parseMrig, type MrigPack } from './tripo';

// Which Mamdani gets built. Once the app has loaded the generated models (.mrig packs), every
// stage uses them; until then — or if they fail to load — the procedural one stands in.

export type ModelKind = 'suit' | 'construction';
const packs: Partial<Record<ModelKind, MrigPack>> = {};

export function registerMayorModel(kind: ModelKind, buf: ArrayBuffer) {
  packs[kind] = parseMrig(buf);
}

export const hasMayorModels = () => !!packs.suit;

/** The construction model wears the hardhat and vest; every other job is the suit plus props. */
export const modelFor = (outfit: MayorOutfit): ModelKind =>
  outfit === 'construction' || outfit === 'traffic' || outfit === 'electrician' ? 'construction' : 'suit';

export function createMayor(outfit: MayorOutfit): MayorRig {
  const pack = packs[modelFor(outfit)] ?? packs.suit;
  return pack ? buildTripoMayor(pack, outfit) : buildMayor(outfit);
}
