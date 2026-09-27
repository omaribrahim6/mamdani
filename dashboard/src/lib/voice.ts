import { useSyncExternalStore } from 'react';
import { API } from './api';

// Mamdani's voice on the dashboard: Gemini TTS (the Orus voice, same as the phone), played
// through Web Audio so his 3D mouth can follow the actual loudness. One line at a time; the
// browser's own speech steps in if the server can't talk.

let ctx: AudioContext | null = null;
let current: { stop: () => void } | null = null;
let state = { speaking: false, analyser: null as AnalyserNode | null };
const subs = new Set<() => void>();
const set = (s: Partial<typeof state>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

export function useVoice() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  );
}

/** Markdown and tables don't read well: keep the first few spoken sentences. */
export function spoken(text: string, max = 420) {
  const plain = text
    .split('\n')
    .filter((l) => !l.trim().startsWith('|'))
    .join(' ')
    .replace(/[*_#`>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#(\d{3,6})/g, 'number $1')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 80 ? cut.slice(0, end + 1) : cut + '…';
}

export function stopVoice() {
  current?.stop();
  current = null;
  speechSynthesis?.cancel();
  set({ speaking: false, analyser: null });
}

export async function speak(text: string, max = 420) {
  stopVoice();
  const line = spoken(text, max);
  if (!line) return;
  const mine = { stop: () => {} };
  current = mine;
  try {
    const r = await fetch(`${API}/api/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line }) });
    if (!r.ok) throw new Error(String(r.status));
    const buf = await r.arrayBuffer();
    if (current !== mine) return;
    ctx ??= new AudioContext();
    await ctx.resume();
    const audio = await ctx.decodeAudioData(buf);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser).connect(ctx.destination);
    mine.stop = () => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    };
    src.onended = () => {
      if (current === mine) set({ speaking: false, analyser: null });
    };
    set({ analyser, speaking: true });
    src.start();
  } catch {
    if (current !== mine) return;
    // fallback: the browser's voice (mouth flaps on its own)
    const u = new SpeechSynthesisUtterance(line);
    u.onend = u.onerror = () => current === mine && set({ speaking: false });
    mine.stop = () => speechSynthesis.cancel();
    set({ speaking: true });
    speechSynthesis.speak(u);
  }
}
