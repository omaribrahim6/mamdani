import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildConstructionMayor, buildSuitMayor } from '../components/mayor/build';

// GLTFExporter uses FileReader for its binary Blob even when a model has no textures.
// This small adapter is confined to this Node export command, never the web/mobile app.
class BlobReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((data) => { this.result = data; this.onloadend?.(); });
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((data) => {
      this.result = `data:${blob.type};base64,${Buffer.from(data).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
globalThis.FileReader ??= BlobReader as unknown as typeof FileReader;

const destination = new URL('../public/models/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const [name, build] of [
  ['mamdani-construction', buildConstructionMayor],
  ['mamdani-suit', buildSuitMayor],
] as const) {
  const rig = build();
  rig.root.updateMatrixWorld(true);
  const data = await new GLTFExporter().parseAsync(rig.root, { binary: true, trs: true });
  if (!(data instanceof ArrayBuffer)) throw new Error(`Expected a binary GLB for ${name}`);
  const target = new URL(`${name}.glb`, destination);
  await writeFile(target, Buffer.from(data));
  console.log(`${fileURLToPath(target)} (${(data.byteLength / 1024).toFixed(0)} KB)`);
}
