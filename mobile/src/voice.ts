import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { API } from './api';
import { wav } from './live/pcm';

// Mamdani has one voice. Every line he says, the report line and live chat alike, goes through
// ElevenLabs via the web app's /api/voice (the key stays on the server). If that's unavailable,
// Live's own audio plays; failing that, the phone's speech. Loudness drives his mouth.

export interface VoiceHandlers {
  onStart?: () => void;
  onLevel?: (v: number) => void;
  onEnd?: () => void;
}

let ready: Promise<unknown> | null = null;
/** Record (for Live) and play through the speaker at the same time. */
export const prepareAudio = () =>
  (ready ??= setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    shouldRouteThroughEarpiece: false,
    interruptionMode: 'duckOthers',
  }).catch(() => {}));

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

let current: { player: AudioPlayer | null; end: () => void } | null = null;

/** Stop whatever he's saying. */
export function hush() {
  const c = current;
  current = null;
  c?.player?.pause();
  c?.player?.release();
  void Speech.stop();
  c?.end();
}

function play(uri: string, h: VoiceHandlers, maxMs: number) {
  return new Promise<void>((resolve) => {
    const player = createAudioPlayer(uri);
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      sub.remove();
      samples?.remove();
      if (current?.player === player) current = null;
      try {
        player.release();
      } catch {
        /* already released */
      }
      h.onLevel?.(0);
      h.onEnd?.();
      resolve();
    };
    const sub = player.addListener('playbackStatusUpdate', (s) => s.didJustFinish && end());
    let samples: { remove(): void } | null = null;
    if (h.onLevel && player.isAudioSamplingSupported) {
      player.setAudioSamplingEnabled(true);
      samples = player.addListener('audioSampleUpdate', (s) => {
        const f = s.channels[0]?.frames ?? [];
        let sum = 0;
        for (let i = 0; i < f.length; i += 4) sum += f[i] * f[i];
        h.onLevel!(Math.min(1, Math.sqrt(sum / Math.max(1, f.length / 4)) * 3.2));
      });
    }
    current = { player, end };
    h.onStart?.();
    player.play();
    setTimeout(end, maxMs);
  });
}

/** Say a line in Mamdani's voice. `fallbackPcm` is Live's own audio for the same words. */
export async function say(text: string, h: VoiceHandlers = {}, fallbackPcm?: Uint8Array[]) {
  hush();
  await prepareAudio();
  try {
    const r = await fetch(`${API}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (r.status === 200) {
      const file = new File(Paths.cache, `line-${hash(text)}.mp3`);
      if (!file.exists) file.write(new Uint8Array(await r.arrayBuffer()));
      return play(file.uri, h, 15000);
    }
  } catch {
    /* try the fallbacks */
  }
  if (fallbackPcm?.length) {
    const file = new File(Paths.cache, `live-${Date.now()}.wav`);
    file.write(wav(fallbackPcm, 24000));
    return play(file.uri, h, 20000);
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      h.onEnd?.();
      resolve();
    };
    current = { player: null, end };
    Speech.speak(text, { rate: 1.02, pitch: 1.05, onStart: h.onStart, onDone: end, onStopped: end, onError: end });
    setTimeout(end, 9000);
  });
}
