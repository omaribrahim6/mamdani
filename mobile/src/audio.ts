import { AudioContext, AudioManager, AudioRecorder, type AudioBufferQueueSourceNode } from 'react-native-audio-api';
import { decodePCM, encodePCM } from './pcm';

export class LiveAudio {
  private recorder = new AudioRecorder();
  private context: AudioContext | null = null;
  private player: AudioBufferQueueSourceNode | null = null;
  private queued = new Map<string, number>();
  private disposed = false;
  private muteUntil = 0;
  private interruption: { remove(): void } | null = null;
  private starting: Promise<void> | null = null;

  constructor(private speaking: (value: boolean) => void, private fail: (message: string) => void) {}

  start(send: (data: string, rate: number) => void): Promise<void> {
    this.starting = this.initialize(send);
    return this.starting;
  }

  private async initialize(send: (data: string, rate: number) => void) {
    if (this.disposed) return;
    AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'voiceChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'] });
    AudioManager.observeAudioInterruptions(true);
    this.interruption = AudioManager.addSystemEventListener('interruption', event => {
      if (!this.disposed && event.type === 'began') this.fail('Audio was interrupted. Please start a new report.');
    });
    await AudioManager.setAudioSessionActivity(true);
    if (this.disposed) return;
    this.context = new AudioContext({ sampleRate: 24000 });
    await this.context.resume();
    if (this.disposed) return;
    this.player = this.context.createBufferQueueSource();
    this.player.connect(this.context.destination);
    this.player.onBufferEnded = ({ bufferId }) => {
      this.queued.delete(bufferId);
      if (!this.queued.size) { this.muteUntil = Date.now() + 150; this.speaking(false); }
    };
    this.player.start(0, 0);
    this.recorder.onError(() => this.fail('The microphone stopped. Please start again.'));
    this.recorder.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => {
      if (this.disposed) return;
      // Avoid transcribing speaker playback as the resident's voice on Android.
      // Keep feeding silence so server-side voice activity detection still advances.
      const samples = buffer.getChannelData(0);
      send(encodePCM(this.queued.size || Date.now() < this.muteUntil
        ? new Float32Array(samples.length) : samples), buffer.sampleRate);
    });
    const result = await this.recorder.start();
    if (result.status === 'error') throw new Error('Could not start the microphone. Please check its permission.');
  }

  play(data: string, rate: number) {
    if (this.disposed || !this.context || !this.player) return;
    const samples = decodePCM(data);
    const duration = samples.length / rate;
    if (Array.from(this.queued.values()).reduce((a, b) => a + b, duration) > 15) {
      this.fail('Voice playback fell behind. Please start again.'); return;
    }
    const buffer = this.context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    this.queued.set(this.player.enqueueBuffer(buffer), duration);
    this.speaking(true);
  }

  interrupt() {
    this.player?.clearBuffers();
    this.queued.clear();
    this.speaking(false);
  }

  async stopCapture() {
    this.recorder.clearOnAudioReady();
    if (this.recorder.isRecording()) await this.recorder.stop();
  }

  async dispose() {
    this.disposed = true;
    // Wait for startup so a cancelled session cannot restart recording afterward.
    await this.starting?.catch(() => {});
    await this.stopCapture().catch(() => {});
    this.recorder.clearOnError();
    this.interruption?.remove(); this.interruption = null;
    AudioManager.observeAudioInterruptions(false);
    this.interrupt();
    if (this.player) {
      this.player.onBufferEnded = null;
      try { this.player.stop(); this.player.disconnect(); } catch {}
      this.player = null;
    }
    await this.context?.close().catch(() => {}); this.context = null;
    await AudioManager.setAudioSessionActivity(false).catch(() => {});
  }
}
