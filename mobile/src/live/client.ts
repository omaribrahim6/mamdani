import { API } from '../api';
import { base64ToBytes, utf8 } from './pcm';

// Gemini Live over a raw WebSocket: Mamdani's eyes (camera frames), ears (mic PCM) and
// conversation. It stays connected the whole time; the app's state machine decides whether a
// reply is allowed to reach the user. The client never files anything — reports are the shutter's job.

export interface LiveReply {
  text: string; // what Mamdani said (output transcription)
  audio: Uint8Array[]; // his native audio, 24 kHz int16, used only if our voice service is unavailable
}

export interface TranscriptLine {
  who: 'resident' | 'mamdani';
  text: string;
  at: number;
}

type Status = 'off' | 'connecting' | 'live' | 'unavailable';

interface TokenInfo {
  token: string;
  model: string;
  url: string;
  config: { systemInstruction: unknown };
}

export class LiveClient {
  status: Status = 'off';
  onStatus?: (s: Status) => void;
  /** a completed model turn */
  onReply?: (r: LiveReply) => void;
  /** a chunk of what the resident is saying, as Live hears it */
  onHeard?: (text: string) => void;

  private ws: WebSocket | null = null;
  private info: TokenInfo | null = null;
  private resumeHandle: string | null = null;
  private disposed = false;
  private retry = 0;
  private turnText = '';
  private turnAudio: Uint8Array[] = [];
  private heard = '';
  private log: TranscriptLine[] = [];

  async start() {
    this.disposed = false;
    if (this.status === 'connecting' || this.status === 'live') return;
    this.set('connecting');
    try {
      if (!this.info) {
        const r = await fetch(`${API}/api/live`, { method: 'POST' });
        if (r.status === 503) return this.set('unavailable');
        if (!r.ok) throw new Error(`token ${r.status}`);
        this.info = (await r.json()) as TokenInfo;
      }
      this.open(this.info);
    } catch {
      this.scheduleReconnect();
    }
  }

  private open(info: TokenInfo) {
    const ws = new WebSocket(`${info.url}?access_token=${encodeURIComponent(info.token)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: info.model,
            generationConfig: { responseModalities: ['AUDIO'] },
            systemInstruction: info.config.systemInstruction,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
          },
        }),
      );
    };
    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : utf8(new Uint8Array(ev.data as ArrayBuffer));
      try {
        this.handle(JSON.parse(raw));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.disposed) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    this.set('connecting');
    this.retry++;
    // a token is single-use for new sessions; resuming with a handle doesn't spend it
    if (!this.resumeHandle || this.retry > 2) this.info = null;
    setTimeout(() => void (this.status !== 'live' && !this.disposed && this.startAgain()), Math.min(8000, 600 * this.retry));
  }
  private startAgain() {
    this.status = 'off';
    void this.start();
  }

  private handle(m: Record<string, any>) {
    if (m.setupComplete) {
      this.retry = 0;
      this.set('live');
      return;
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = m.sessionResumptionUpdate.newHandle;
    }
    if (m.goAway) {
      // the socket is about to close; reconnect cleanly with the resumption handle
      this.ws?.close();
      return;
    }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) {
      this.heard += sc.inputTranscription.text;
      this.onHeard?.(sc.inputTranscription.text);
    }
    if (sc.outputTranscription?.text) this.turnText += sc.outputTranscription.text;
    for (const p of sc.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) this.turnAudio.push(base64ToBytes(p.inlineData.data));
    }
    if (sc.interrupted) {
      this.turnText = '';
      this.turnAudio = [];
    }
    if (sc.turnComplete) {
      if (this.heard.trim()) this.log.push({ who: 'resident', text: this.heard.trim(), at: Date.now() });
      this.heard = '';
      const reply = { text: this.turnText.trim(), audio: this.turnAudio };
      this.turnText = '';
      this.turnAudio = [];
      if (reply.text) this.log.push({ who: 'mamdani', text: reply.text, at: Date.now() });
      if (reply.text || reply.audio.length) this.onReply?.(reply);
    }
  }

  private set(s: Status) {
    this.status = s;
    this.onStatus?.(s);
  }

  private send(msg: object) {
    if (this.status === 'live' && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendAudio(b64: string) {
    this.send({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } });
  }

  sendFrame(b64: string) {
    this.send({ realtimeInput: { video: { data: b64, mimeType: 'image/jpeg' } } });
  }

  /** Quietly tell Mamdani something (e.g. the filed report). He takes it in without replying. */
  tell(text: string) {
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false } });
  }

  /** The last couple of minutes of conversation, oldest first — frozen into the report at shutter time. */
  recentConversation(ms = 120_000) {
    const since = Date.now() - ms;
    const lines = this.log.filter((l) => l.at >= since);
    if (this.heard.trim()) lines.push({ who: 'resident', text: this.heard.trim(), at: Date.now() });
    return lines.map((l) => `${l.who === 'resident' ? 'Resident' : 'Mamdani'}: ${l.text}`).join('\n');
  }

  stop() {
    this.disposed = true;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.set('off');
  }
}
