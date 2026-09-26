import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { API } from './api';

// Mamdani's voice: ElevenLabs through the web app's /api/voice (the key stays on the server).
// The clip is cached to a file and played with expo-audio; with no key, the phone's own TTS speaks.

let ready: Promise<unknown> | null = null;
const prepare = () =>
  (ready ??= setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(() => {}));

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export async function speak(text: string, onStart: () => void, onEnd: () => void) {
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };
  try {
    await prepare();
    const r = await fetch(`${API}/api/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (r.status === 200) {
      const file = new File(Paths.cache, `line-${hash(text)}.mp3`);
      if (!file.exists) file.write(new Uint8Array(await r.arrayBuffer()));
      const player = createAudioPlayer(file.uri);
      const sub = player.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) {
          sub.remove();
          player.release();
          end();
        }
      });
      onStart();
      player.play();
      // never leave him mouthing forever if the finish event goes missing
      setTimeout(end, 12000);
      return;
    }
  } catch {
    /* fall through to device speech */
  }
  Speech.speak(text, { rate: 1.02, pitch: 1.05, onStart, onDone: end, onStopped: end, onError: end });
  setTimeout(end, 9000);
}

export const hush = () => void Speech.stop();
