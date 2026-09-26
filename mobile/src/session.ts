import { MAX_PHOTO_BASE64 } from './photo';
import { disconnectedMessage, websocketURL, type Phase, type ServerEvent } from './protocol';

export interface AudioIO {
  start(send: (data: string, rate: number) => void): Promise<void>;
  play(data: string, rate: number): void;
  interrupt(): void;
  stopCapture(): Promise<void>;
  dispose(): Promise<void>;
}
type Callbacks = {
  phase: (value: Phase) => void;
  speaking: (value: boolean) => void;
  transcript: (role: 'user' | 'assistant', text: string) => void;
  error: (message: string) => void;
};

export class LiveSession {
  private ws: WebSocket;
  private audio: AudioIO;
  private closing: Promise<void> | null = null;
  private phase: Phase = 'connecting';
  private closed = false;
  private timer: ReturnType<typeof setTimeout>;
  private pendingAudio: { data: string; sampleRate: number }[] = [];
  private audioReady = false;
  readonly ready: Promise<void>;
  private finishReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(base: string, location: { latitude: number; longitude: number }, private callbacks: Callbacks,
    audioFactory: (speaking: (value: boolean) => void, fail: (message: string) => void) => AudioIO,
    socketFactory: (url: string) => WebSocket = url => new WebSocket(url)) {
    this.ready = new Promise((resolve, reject) => { this.finishReady = resolve; this.rejectReady = reject; });
    this.audio = audioFactory(callbacks.speaking, message => this.fail(message));
    this.ws = socketFactory(websocketURL(base));
    this.timer = setTimeout(() => this.fail('Could not connect. Check the backend address and your connection.'), 20000);
    this.ws.onopen = () => {
      if (!this.closed) this.ws.send(JSON.stringify({ type: 'start', ...location }));
    };
    this.ws.onmessage = event => {
      if (this.closed) return;
      try { void this.receive(JSON.parse(event.data) as ServerEvent).catch(() => this.fail('Could not start voice capture. Please try again.')); }
      catch { this.fail('The server sent an invalid response.'); }
    };
    this.ws.onerror = () => this.fail(disconnectedMessage(this.phase));
    this.ws.onclose = () => { if (!this.closed) this.fail(disconnectedMessage(this.phase)); };
  }

  private setPhase(value: Phase) { this.phase = value; this.callbacks.phase(value); }

  private async receive(event: ServerEvent) {
    switch (event.type) {
      case 'ready':
        clearTimeout(this.timer);
        await this.audio.start((data, sampleRate) => this.send({ type: 'audio', data, sampleRate }));
        if (this.closed) return;
        this.audioReady = true;
        for (const chunk of this.pendingAudio) this.audio.play(chunk.data, chunk.sampleRate);
        this.pendingAudio = [];
        this.setPhase('live'); this.finishReady();
        break;
      case 'audio':
        if (this.audioReady) this.audio.play(event.data, event.sampleRate);
        else {
          if (this.pendingAudio.length >= 100) throw new Error('Playback overloaded');
          this.pendingAudio.push(event);
        }
        break;
      case 'transcript': this.callbacks.transcript(event.role, event.text); break;
      case 'interrupted': this.pendingAudio = []; this.audio.interrupt(); break;
      case 'turn_complete': this.callbacks.transcript('assistant', '\n'); break;
      case 'capture_photo':
        if (this.phase !== 'live') return;
        this.setPhase('capturing'); this.pendingAudio = []; this.audio.interrupt();
        await this.audio.stopCapture(); break;
      case 'submitting':
        this.setPhase('submitting'); this.audio.interrupt(); await this.audio.stopCapture(); break;
      case 'success': await this.close(false); this.setPhase('success'); break;
      case 'error': this.fail(event.unknown ? disconnectedMessage('submitting') : event.message); break;
    }
  }

  private send(message: object) {
    if (this.closed || this.phase === 'submitting' || this.phase === 'capturing' || this.ws.readyState !== 1) return;
    if (this.ws.bufferedAmount > 256_000) { this.fail('The connection cannot keep up. Please start again.'); return; }
    this.ws.send(JSON.stringify(message));
  }

  frame(data: string) { if (this.phase === 'live') this.send({ type: 'video', data }); }

  photo(data: string): boolean {
    if (this.closed || this.phase !== 'capturing' || this.ws.readyState !== 1) return false;
    if (!data || data.length > MAX_PHOTO_BASE64 || this.ws.bufferedAmount > 256_000) {
      this.fail('The photo could not be sent. Please start a new report.'); return false;
    }
    // After transmission a disconnect is ambiguous: the backend may already be saving.
    this.setPhase('submitting');
    try {
      this.ws.send(JSON.stringify({ type: 'photo', data }));
      return true;
    } catch {
      this.fail(disconnectedMessage('submitting'));
      return false;
    }
  }

  private fail(message: string) {
    if (this.closed) return;
    this.rejectReady(new Error(message)); this.setPhase('error'); this.callbacks.error(message);
    void this.close(false);
  }

  close(cancel = true): Promise<void> {
    if (this.closing) return this.closing;
    if (this.closed) return Promise.resolve();
    this.closed = true; clearTimeout(this.timer);
    this.rejectReady(new Error('Session closed'));
    if (cancel && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'cancel' }));
    this.ws.close(); this.pendingAudio = [];
    this.closing = this.audio.dispose().catch(() => {});
    return this.closing;
  }
}
