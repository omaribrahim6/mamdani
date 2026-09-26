// Byte plumbing for the Live session: base64 <-> bytes, int16 PCM resampling and loudness, WAV
// wrapping, and a UTF-8 decoder (Hermes has no TextDecoder).

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Mono int16 at any rate → int16 at 16 kHz (what Live expects). */
export function to16k(pcm: Int16Array, rate: number): Int16Array {
  if (rate === 16000) return pcm;
  const ratio = rate / 16000;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const a = Math.floor(x);
    const b = Math.min(pcm.length - 1, a + 1);
    out[i] = pcm[a] + (pcm[b] - pcm[a]) * (x - a);
  }
  return out;
}

/** 0..1 loudness of an int16 buffer. */
export function rms(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i += 2) s += pcm[i] * pcm[i];
  return Math.min(1, Math.sqrt(s / (pcm.length / 2)) / 8000);
}

/** Raw 16-bit mono PCM chunks → a playable WAV file's bytes. */
export function wav(chunks: Uint8Array[], rate: number): Uint8Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(44 + len);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + len, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, len, true);
  let o = 44;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function utf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = (((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}
