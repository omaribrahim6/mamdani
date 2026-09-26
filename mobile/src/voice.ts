import * as Speech from 'expo-speech';

// Mamdani's voice is Gemini Live's own. This is only the fallback for when Live can't be reached:
// the phone's speech, so the report still gets its spoken confirmation.

let ending: (() => void) | null = null;

export function sayOnDevice(text: string, onStart?: () => void): Promise<void> {
  hush();
  return new Promise((resolve) => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      ending = null;
      resolve();
    };
    ending = end;
    Speech.speak(text, { rate: 1.02, pitch: 1.05, onStart, onDone: end, onStopped: end, onError: end });
    setTimeout(end, 9000);
  });
}

export function hush() {
  void Speech.stop();
  ending?.();
}
