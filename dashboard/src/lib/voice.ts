import { useSyncExternalStore } from 'react';
import { API } from './api';

// Mamdani's voice on the dashboard: Gemini TTS with the Orus voice (the same voice as the phone
// and the chat), played through Web Audio so his 3D mouth follows the real loudness. Long text
// is split into sentences: they're voiced in parallel and played in order, so he starts talking
// after the first sentence instead of after the whole memo. Only his voice — no browser fallback.

let ctx: AudioContext | null = null;
let run = 0;
let source: AudioBufferSourceNode | null = null;

type VoiceState = { speaking: boolean; preparing: boolean; failed: boolean; analyser: AnalyserNode | null };
let state: VoiceState = { speaking: false, preparing: false, failed: false, analyser: null };
const subs = new Set<() => void>();
const set = (s: Partial<VoiceState>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};

export function useVoice() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  );
}

/** Markdown and tables don't read well: keep the spoken sentences. */
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

/** Sentences grouped into pieces of about `size` characters. */
function pieces(text: string, size = 240) {
  const sentences = text.match(/[^.!?]+[.!?]+["”']?\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > size) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function voice(line: string): Promise<ArrayBuffer> {
  const r = await fetch(`${API}/api/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: line }) });
  if (!r.ok) throw new Error(`speak ${r.status}`);
  return r.arrayBuffer();
}

export function stopVoice() {
  run++;
  try {
    source?.stop();
  } catch {
    /* already stopped */
  }
  source = null;
  set({ speaking: false, preparing: false, analyser: null });
}

export async function speak(text: string, max = 420) {
  stopVoice();
  const line = spoken(text, max);
  if (!line) return;
  const mine = ++run;
  // the audio context has to be unlocked inside the click, before any waiting
  ctx ??= new AudioContext();
  void ctx.resume();
  set({ preparing: true, failed: false });
  const parts = pieces(line);
  // two requests in flight at a time, in reading order; each finished one starts the next
  const audio: Array<Promise<ArrayBuffer>> = [];
  let next = 0;
  const request = () => {
    if (next >= parts.length || mine !== run) return;
    const k = next++;
    audio[k] = voice(parts[k]);
    audio[k].then(request, request);
  };
  request();
  request();

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.connect(ctx.destination);
  for (let k = 0; k < parts.length; k++) {
    let buf: AudioBuffer;
    try {
      while (!audio[k]) {
        if (mine !== run) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      buf = await ctx.decodeAudioData(await audio[k]);
    } catch {
      if (mine === run) set({ speaking: false, preparing: false, analyser: null, failed: k === 0 });
      return;
    }
    if (mine !== run) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(analyser);
    source = src;
    set({ preparing: false, speaking: true, analyser });
    await new Promise<void>((done) => {
      src.onended = () => done();
      src.start();
    });
    if (mine !== run) return;
  }
  if (mine === run) set({ speaking: false, analyser: null });
}
