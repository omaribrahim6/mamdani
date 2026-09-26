import { fromByteArray, toByteArray } from 'base64-js';

export function encodePCM(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return fromByteArray(bytes);
}

export function decodePCM(data: string): Float32Array<ArrayBuffer> {
  const bytes = toByteArray(data);
  if (!bytes.length || bytes.length % 2) throw new Error('Invalid PCM audio');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}
