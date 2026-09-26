import { requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { bytesToBase64, rms, to16k } from './pcm';

/**
 * The microphone as a stream of 16 kHz PCM chunks for Gemini Live, plus a loudness level for the
 * UI. `enabled` gates what's sent; the stream itself keeps running so there's no warm-up lag.
 */
export function useMic(enabled: boolean, onChunk: (b64: string) => void) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [level, setLevel] = useState(0);
  const gate = useRef(enabled);
  const send = useRef(onChunk);
  gate.current = enabled;
  send.current = onChunk;
  const lastLevel = useRef(0);

  const { stream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buf) => {
      let pcm: Int16Array = new Int16Array(buf.data);
      if (buf.channels > 1) pcm = pcm.filter((_, i) => i % buf.channels === 0);
      pcm = to16k(pcm, buf.sampleRate);
      const v = rms(pcm);
      // don't re-render on every buffer; only when the level visibly moves
      if (Math.abs(v - lastLevel.current) > 0.04) {
        lastLevel.current = v;
        setLevel(v);
      }
      if (gate.current) send.current(bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)));
    },
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await requestRecordingPermissionsAsync();
      if (!alive) return;
      setGranted(p.granted);
      if (p.granted) await stream.start().catch(() => setGranted(false));
    })();
    return () => {
      alive = false;
      try {
        stream.stop();
      } catch {
        /* already stopped */
      }
    };
  }, [stream]);

  return { granted, level: enabled ? level : 0 };
}
