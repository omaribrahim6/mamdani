import { fromByteArray, toByteArray } from 'base64-js';
import {
  AudioContext,
  AudioManager,
  AudioRecorder,
  type AudioBuffer,
  type AudioBufferQueueSourceNode,
  type AudioBufferSourceNode,
  type GainNode,
} from 'react-native-audio-api';

// Mamdani's ears and voice on the phone (react-native-audio-api, needs a development build):
//   • the mic streams 16 kHz PCM to Gemini Live
//   • Live's 24 kHz PCM reply is queued and played as it arrives, so he answers without a wait
//   • while he talks (and a beat after) the mic sends silence, so he doesn't hear himself
//   • loudness of what's playing *right now* drives his mouth; loudness of the mic, his listening
// Adapted from Nick's LiveAudio (nick branch).

export function encodePCM(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(v * (v < 0 ? 32768 : 32767)), true);
  }
  return fromByteArray(bytes);
}

export function decodePCM(data: string): Float32Array<ArrayBuffer> {
  const bytes = toByteArray(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

const rms = (s: Float32Array, from = 0, to = s.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

export class LiveAudio {
  private recorder: AudioRecorder | null = null; // created on start(), not per instance
  private context: AudioContext | null = null;
  private player: AudioBufferQueueSourceNode | null = null;
  private queued = new Map<string, number>();
  private queueEnd = 0; // context time when everything queued will have played
  private envelope: Array<{ start: number; step: number; levels: number[] }> = [];
  private muteUntil = 0;
  private waiters = new Set<() => void>();
  private disposed = false;
  private starting: Promise<void> | null = null;
  /** mic loudness 0..1, for "he's listening" */
  micLevel = 0;
  /** true while muted by the resident */
  muted = false;
  onSpeaking?: (on: boolean) => void;
  onError?: (message: string) => void;

  static async permission(): Promise<boolean> {
    return (await AudioManager.requestRecordingPermissions()) === 'Granted';
  }

  start(send: (pcm16k: string) => void): Promise<void> {
    this.starting ??= this.init(send);
    return this.starting;
  }

  private async init(send: (pcm16k: string) => void) {
    // voiceChat = the phone's own echo cancellation; speaker, not earpiece
    AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'voiceChat', iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'] });
    await AudioManager.setAudioSessionActivity(true);
    if (this.disposed) return;
    this.context = new AudioContext({ sampleRate: 24000 });
    await this.context.resume();
    this.player = this.context.createBufferQueueSource();
    this.player.connect(this.context.destination);
    this.player.onBufferEnded = ({ bufferId }) => {
      this.queued.delete(bufferId);
      if (!this.queued.size) {
        this.muteUntil = Date.now() + 250;
        this.onSpeaking?.(false);
        for (const w of this.waiters) w();
        this.waiters.clear();
      }
    };
    this.player.start(0, 0);
    const recorder = (this.recorder = new AudioRecorder());
    recorder.onError(() => this.onError?.('The microphone stopped.'));
    recorder.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => {
      if (this.disposed) return;
      const samples = buffer.getChannelData(0);
      const silent = this.muted || this.queued.size > 0 || Date.now() < this.muteUntil;
      this.micLevel = silent ? 0 : Math.min(1, rms(samples) * 6);
      // keep sending (silence) so Live's voice detection keeps moving
      send(encodePCM(silent ? new Float32Array(samples.length) : samples));
    });
    const r = await recorder.start();
    if (r.status === 'error') throw new Error('Could not start the microphone.');
  }

  /** Queue a chunk of Live's voice (base64 16-bit PCM). */
  play(data: string, rate = 24000) {
    this.enqueue(decodePCM(data), rate);
  }

  /** Decode a bundled clip (a require()'d asset) to play later with playClip. */
  async loadClip(asset: number): Promise<AudioBuffer | null> {
    await this.starting?.catch(() => {});
    if (!this.context) return null;
    try {
      return await this.context.decodeAudioData(asset);
    } catch (e) {
      console.warn('clip decode failed', e);
      return null;
    }
  }

  /** Play a decoded clip as his voice (mouth, mic muting and drain() all apply). */
  playClip(clip: AudioBuffer): boolean {
    if (this.disposed || !this.context || !this.player) return false;
    this.enqueue(new Float32Array(clip.getChannelData(0)), clip.sampleRate);
    return true;
  }

  private enqueue(samples: Float32Array<ArrayBuffer>, rate: number) {
    if (this.disposed || !this.context || !this.player) return;
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const duration = samples.length / rate;
    const start = Math.max(this.context.currentTime, this.queueEnd);
    this.queueEnd = start + duration;
    // loudness every 40 ms of this chunk, to animate the mouth in step with the sound
    const step = 0.04;
    const n = Math.max(1, Math.ceil(duration / step));
    const per = Math.floor(samples.length / n);
    const levels = Array.from({ length: n }, (_, k) => Math.min(1, rms(samples, k * per, Math.min(samples.length, (k + 1) * per)) * 4));
    this.envelope.push({ start, step, levels });
    if (this.envelope.length > 200) this.envelope.splice(0, this.envelope.length - 200);
    this.queued.set(this.player.enqueueBuffer(buffer), duration);
    this.onSpeaking?.(true);
  }

  /** Loudness of the voice playing right now, 0..1. */
  levelNow(): number {
    if (!this.context || !this.queued.size) return 0;
    const t = this.context.currentTime;
    for (let i = this.envelope.length - 1; i >= 0; i--) {
      const e = this.envelope[i];
      if (t >= e.start) {
        const k = Math.floor((t - e.start) / e.step);
        return k < e.levels.length ? e.levels[k] : 0;
      }
    }
    return 0;
  }

  get speaking() {
    return this.queued.size > 0;
  }

  // ── the waiting music (Lyria), while he's off getting ready ──
  private musicBuffer: AudioBuffer | null = null;
  private music: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  /** Decode a bundled track once (a require()'d asset). */
  async loadMusic(asset: number) {
    await this.starting?.catch(() => {});
    if (!this.context || this.musicBuffer) return;
    try {
      this.musicBuffer = await this.context.decodeAudioData(asset);
    } catch (e) {
      console.warn('music decode failed', e);
    }
  }

  startMusic(volume = 0.32, fadeIn = 0.5) {
    if (!this.context || !this.musicBuffer || this.music) return;
    const t = this.context.currentTime;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + fadeIn);
    const src = this.context.createBufferSource();
    src.buffer = this.musicBuffer;
    src.loop = true;
    src.connect(gain);
    gain.connect(this.context.destination);
    src.start(t);
    this.music = { src, gain };
  }

  stopMusic(fadeOut = 0.7) {
    const m = this.music;
    if (!m || !this.context) return;
    this.music = null;
    const t = this.context.currentTime;
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + fadeOut);
    setTimeout(() => {
      try {
        m.src.stop();
        m.src.disconnect();
        m.gain.disconnect();
      } catch {
        /* already stopped */
      }
    }, fadeOut * 1000 + 100);
  }

  /** Resolves when everything queued has been heard. */
  drain(timeoutMs = 15000): Promise<void> {
    if (!this.queued.size) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.waiters.delete(done);
        resolve();
      };
      const t = setTimeout(done, timeoutMs);
      this.waiters.add(done);
    });
  }

  /** Stop talking now (barge-in, or the app took over). */
  interrupt() {
    this.player?.clearBuffers();
    this.queued.clear();
    this.envelope = [];
    this.queueEnd = 0;
    this.onSpeaking?.(false);
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  async dispose() {
    this.disposed = true;
    this.stopMusic(0.05);
    await this.starting?.catch(() => {});
    const rec = this.recorder;
    this.recorder = null;
    if (rec) {
      rec.clearOnAudioReady();
      if (rec.isRecording()) await rec.stop().catch(() => {});
      rec.clearOnError();
    }
    this.interrupt();
    if (this.player) {
      this.player.onBufferEnded = null;
      try {
        this.player.stop();
        this.player.disconnect();
      } catch {
        /* already stopped */
      }
      this.player = null;
    }
    await this.context?.close().catch(() => {});
    this.context = null;
    await AudioManager.setAudioSessionActivity(false).catch(() => {});
  }
}
