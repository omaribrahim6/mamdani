import { API } from '../api';
import { utf8 } from './pcm';

// Gemini Live over a raw WebSocket (Vertex AI, short-lived token from /api/live): Mamdani's eyes
// (camera frames), ears (mic PCM), voice (streamed 24 kHz audio) and judgement — he decides, with
// the report_issue tool, when he's seen and heard enough to take the evidence photo. The app's
// state machine decides whether what he says may be heard.

export interface ToolCall {
  id: string;
  name: string;
  args: { visual_description?: string; clarification?: string };
}

export interface TranscriptLine {
  who: 'resident' | 'mamdani';
  text: string;
  at: number;
}

type Status = 'off' | 'connecting' | 'live' | 'unavailable';

interface SessionInfo {
  token: string;
  model: string;
  url: string;
  /** raw setup fields: systemInstruction, tools, generationConfig, transcription… */
  setup: Record<string, unknown>;
}

export class LiveClient {
  status: Status = 'off';
  onStatus?: (s: Status) => void;
  /** a chunk of his voice, base64 16-bit PCM at 24 kHz */
  onAudio?: (pcm: string) => void;
  /** his words as he says them */
  onSaid?: (chunk: string) => void;
  /** the resident's words as Live hears them */
  onHeard?: (chunk: string) => void;
  /** a turn of his finished: everything he said in it, and what the resident had just said */
  onTurn?: (said: string, heard: string) => void;
  /** the resident talked over him: drop what's queued */
  onInterrupted?: () => void;
  onToolCall?: (call: ToolCall) => void;
  /** the first time a session is ready (not on silent resumptions) */
  onFirstReady?: () => void;
  /** change the session setup the server hands out before it's sent (the demo branch uses this) */
  adjustSetup?: (setup: Record<string, unknown>) => Record<string, unknown>;

  private ws: WebSocket | null = null;
  private info: SessionInfo | null = null;
  private resumeHandle: string | null = null;
  private disposed = false;
  private retry = 0;
  private failures = 0;
  private setupDone = false;
  private everReady = false;
  private turnText = '';
  private heard = '';
  private log: TranscriptLine[] = [];
  private lastClose: { code: number; reason: string; afterSetup: boolean; error?: string } | null = null;

  async start() {
    this.disposed = false;
    if (this.status === 'connecting' || this.status === 'live') return;
    this.set('connecting');
    try {
      if (!this.info) {
        const r = await fetch(`${API}/api/live`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ previous: this.lastClose }),
        });
        if (r.status === 503) return this.set('unavailable');
        if (!r.ok) throw new Error(`token ${r.status}`);
        this.info = (await r.json()) as SessionInfo;
      }
      this.open(this.info);
    } catch {
      this.scheduleReconnect();
    }
  }

  private open(info: SessionInfo) {
    const ws = new WebSocket(`${info.url}?access_token=${encodeURIComponent(info.token)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.setupDone = false;
    let error: string | undefined;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          setup: { model: info.model, ...(this.adjustSetup?.(info.setup) ?? info.setup), sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {} },
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
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.lastClose = { code: ev.code, reason: String(ev.reason ?? '').slice(0, 300), afterSetup: this.setupDone, error };
      console.warn('Mamdani live closed', this.lastClose);
      if (!this.disposed) this.scheduleReconnect();
    };
    ws.onerror = (ev) => {
      error = String((ev as unknown as { message?: string }).message ?? 'socket error').slice(0, 300);
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    if (!this.setupDone && ++this.failures >= 5) {
      this.info = null;
      return this.set('unavailable');
    }
    this.set('connecting');
    this.retry++;
    // tokens last an hour; fetch a fresh one if resuming keeps failing
    if (!this.resumeHandle || this.retry > 2) this.info = null;
    setTimeout(() => {
      if (this.status === 'live' || this.disposed) return;
      this.status = 'off';
      void this.start();
    }, Math.min(8000, 600 * this.retry));
  }

  private handle(m: Record<string, any>) {
    if (m.setupComplete) {
      this.retry = 0;
      this.failures = 0;
      this.setupDone = true;
      this.set('live');
      if (!this.everReady) {
        this.everReady = true;
        this.onFirstReady?.();
      }
      return;
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.resumeHandle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) {
      this.ws?.close();
      return;
    }
    if (m.toolCall?.functionCalls) {
      for (const c of m.toolCall.functionCalls) this.onToolCall?.({ id: c.id, name: c.name, args: c.args ?? {} });
      return;
    }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) {
      this.heard += sc.inputTranscription.text;
      this.onHeard?.(sc.inputTranscription.text);
    }
    if (sc.outputTranscription?.text) {
      this.turnText += sc.outputTranscription.text;
      this.onSaid?.(sc.outputTranscription.text);
    }
    for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) this.onAudio?.(p.inlineData.data);
    if (sc.interrupted) {
      this.turnText = '';
      this.onInterrupted?.();
    }
    if (sc.turnComplete) {
      const heard = this.heard.trim();
      const said = this.turnText.trim();
      if (heard) this.log.push({ who: 'resident', text: heard, at: Date.now() });
      if (said) this.log.push({ who: 'mamdani', text: said, at: Date.now() });
      this.heard = '';
      this.turnText = '';
      this.onTurn?.(said, heard);
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

  /** A message from the app that he responds to (e.g. "begin", "say this"). */
  prompt(text: string) {
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: `[App] ${text}` }] }], turnComplete: true } });
  }

  /** Quietly tell him something; he takes it in without replying. */
  tell(text: string) {
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: `[App] ${text}` }] }], turnComplete: false } });
  }

  respond(call: ToolCall, response: Record<string, unknown>) {
    this.send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response }] } });
  }

  /** The last few minutes of conversation, oldest first — frozen into the report at capture. */
  recentConversation(ms = 180_000) {
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
