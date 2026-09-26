// Minimal GLB reader for build scripts: JSON chunk, BIN chunk, typed accessors, embedded images.
import { readFileSync } from 'node:fs';

const TYPED: Record<number, { new (b: ArrayBuffer, o: number, n: number): ArrayLike<number> }> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export interface Gltf {
  json: any;
  bin: Buffer;
  accessor(i: number): { data: number[]; size: number; count: number };
  bufferView(i: number): Buffer;
}

export function readGlb(file: string): Gltf {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${file} is not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));

  const bufferView = (i: number) => {
    const v = json.bufferViews[i];
    return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  };

  const accessor = (i: number) => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const size = SIZE[a.type];
    const T = TYPED[a.componentType];
    const el: number = (T as any).BYTES_PER_ELEMENT;
    const stride = v.byteStride ?? size * el;
    const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const src = new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
    const out: number[] = new Array(a.count * size);
    const tmp = new ArrayBuffer(el * size);
    const tmpU8 = new Uint8Array(tmp);
    const view = new T(tmp, 0, size);
    for (let k = 0; k < a.count; k++) {
      tmpU8.set(src.subarray(base + k * stride, base + k * stride + el * size));
      for (let c = 0; c < size; c++) {
        let x = view[c];
        if (a.normalized) x = x / (2 ** (8 * el) - 1); // unsigned normalized (colors, weights)
        out[k * size + c] = x;
      }
    }
    return { data: out, size, count: a.count };
  };

  return { json, bin, accessor, bufferView };
}
