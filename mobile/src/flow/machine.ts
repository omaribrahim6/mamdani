import type { ReportDecision } from '../../../lib/types';
import type { Media } from '../api';

// One authoritative interaction state. Every screen, Mamdani's mode, whether Gemini Live may speak,
// whether the mic and camera stream — all of it is derived from `state`, never from loose booleans.
//
// The report is analysed while he's already walking out of his window: he leaves right after the
// photo, the window closes, the waiting music plays, and he comes in dressed for whatever Gemini
// decided. If Gemini needs to ask something, or turns the photo down, he comes back to his window.

export type FlowState =
  | 'LIVE_IDLE' // camera up, Mamdani in his window, talking it through with the resident
  | 'CAPTURING' // he decided to report it: "hold steady" and the evidence photo
  | 'CAPTURED' // snapshot frozen; analysis starts now
  | 'CHARACTER_EXITING' // he walks out of his window (analysis running)
  | 'REPORT_PROCESSING' // window closed; waiting music until the decision lands
  | 'CHARACTER_RECALLED' // Gemini needs to ask or said no: he walks back into his window
  | 'REPORT_CLARIFYING' // he asks which problem; nothing committed yet
  | 'CHARACTER_ENTERING' // he walks into the photo, dressed for the job
  | 'CHARACTER_ACTION' // flag / cone / clipboard …
  | 'CHARACTER_SPEAKING' // the one canonical line
  | 'REPORT_COMPLETE' // "Reported" confirmation
  | 'LIVE_CONVERSATION' // talk about the filed report
  | 'CHARACTER_RETURNING'; // he walks back to his window for the next report

/** Frozen at capture time. The report is about this, whatever the camera sees afterwards. */
export interface Snapshot {
  sessionId: string;
  photo: Media;
  lat: number;
  lng: number;
  capturedAt: number;
  context: string;
}

/** What analysis said when it didn't file: he has to come back and say it. */
export type Outcome = { kind: 'clarify'; question: string; options: string[] } | { kind: 'failed'; message: string };

export interface Flow {
  state: FlowState;
  snapshot: Snapshot | null;
  decision: ReportDecision | null;
  outcome: Outcome | null;
  clarify: { question: string; options: string[] } | null;
  answer: string | null;
  /** increments each time the snapshot is (re)analysed */
  run: number;
  notice: string | null;
}

export type FlowEvent =
  | { type: 'CAPTURE' }
  | { type: 'SHUTTER'; snapshot: Snapshot }
  | { type: 'EXIT' }
  | { type: 'EXITED' }
  | { type: 'DECIDED'; decision: ReportDecision }
  | { type: 'CLARIFY'; question: string; options: string[] }
  | { type: 'FAILED'; message: string }
  | { type: 'RECALLED' }
  | { type: 'ANSWERED'; answer: string }
  | { type: 'ACT' }
  | { type: 'SPEAK' }
  | { type: 'SPOKEN' }
  | { type: 'CONVERSE' }
  | { type: 'NEW_REPORT' }
  | { type: 'RETURNED' }
  | { type: 'DISMISS_NOTICE' };

export const initialFlow: Flow = {
  state: 'LIVE_IDLE',
  snapshot: null,
  decision: null,
  outcome: null,
  clarify: null,
  answer: null,
  run: 0,
  notice: null,
};

/** Legal transitions only. Anything else (a double tap, a late callback) leaves the flow untouched. */
export function flow(f: Flow, e: FlowEvent): Flow {
  const at = (...states: FlowState[]) => states.includes(f.state);
  switch (e.type) {
    case 'CAPTURE':
      return at('LIVE_IDLE') ? { ...initialFlow, state: 'CAPTURING' } : f;
    case 'SHUTTER':
      return at('LIVE_IDLE', 'CAPTURING') ? { ...initialFlow, state: 'CAPTURED', snapshot: e.snapshot, run: f.run + 1 } : f;
    case 'EXIT':
      return at('CAPTURED') ? { ...f, state: 'CHARACTER_EXITING' } : f;
    case 'EXITED':
      if (!at('CHARACTER_EXITING')) return f;
      if (f.decision) return { ...f, state: 'CHARACTER_ENTERING' };
      if (f.outcome) return { ...f, state: 'CHARACTER_RECALLED' };
      return { ...f, state: 'REPORT_PROCESSING' };
    case 'DECIDED':
      if (at('CAPTURED', 'CHARACTER_EXITING')) return { ...f, decision: e.decision };
      return at('REPORT_PROCESSING') ? { ...f, state: 'CHARACTER_ENTERING', decision: e.decision } : f;
    case 'CLARIFY':
    case 'FAILED': {
      const outcome: Outcome = e.type === 'CLARIFY' ? { kind: 'clarify', question: e.question, options: e.options } : { kind: 'failed', message: e.message };
      // before he's left (camera trouble), just go back to talking
      if (at('CAPTURING')) return { ...initialFlow, notice: e.type === 'FAILED' ? e.message : null };
      if (at('CAPTURED', 'CHARACTER_EXITING')) return { ...f, outcome };
      return at('REPORT_PROCESSING') ? { ...f, state: 'CHARACTER_RECALLED', outcome } : f;
    }
    case 'RECALLED':
      if (!at('CHARACTER_RECALLED') || !f.outcome) return f;
      return f.outcome.kind === 'clarify'
        ? { ...f, state: 'REPORT_CLARIFYING', clarify: { question: f.outcome.question, options: f.outcome.options }, outcome: null }
        : { ...initialFlow, notice: f.outcome.message };
    case 'ANSWERED':
      // the same snapshot goes back for analysis, with the answer; he heads out again
      return at('REPORT_CLARIFYING') ? { ...f, state: 'CAPTURED', answer: e.answer, clarify: null, outcome: null, decision: null, run: f.run + 1 } : f;
    case 'ACT':
      return at('CHARACTER_ENTERING') ? { ...f, state: 'CHARACTER_ACTION' } : f;
    case 'SPEAK':
      return at('CHARACTER_ACTION') ? { ...f, state: 'CHARACTER_SPEAKING' } : f;
    case 'SPOKEN':
      return at('CHARACTER_SPEAKING') ? { ...f, state: 'REPORT_COMPLETE' } : f;
    case 'CONVERSE':
      return at('REPORT_COMPLETE') ? { ...f, state: 'LIVE_CONVERSATION' } : f;
    case 'NEW_REPORT':
      return at('REPORT_COMPLETE', 'LIVE_CONVERSATION') ? { ...f, state: 'CHARACTER_RETURNING' } : f;
    case 'RETURNED':
      return at('CHARACTER_RETURNING') ? initialFlow : f;
    case 'DISMISS_NOTICE':
      return { ...f, notice: null };
  }
}

// ── everything else is derived ──

export type MamdaniMode = 'PORTRAIT' | 'TRANSITIONING' | 'SCENE';
export function mamdaniMode(s: FlowState): MamdaniMode {
  if (s === 'CHARACTER_EXITING' || s === 'REPORT_PROCESSING' || s === 'CHARACTER_RECALLED' || s === 'CHARACTER_RETURNING') return 'TRANSITIONING';
  if (s === 'CHARACTER_ENTERING' || s === 'CHARACTER_ACTION' || s === 'CHARACTER_SPEAKING' || s === 'REPORT_COMPLETE' || s === 'LIVE_CONVERSATION')
    return 'SCENE';
  return 'PORTRAIT';
}

/** Gemini Live stays connected throughout; this is whether his voice may reach the user. While the
 *  report is being processed and he's walking about, the orchestrator owns him. */
export const liveMaySpeak = (s: FlowState) =>
  s === 'LIVE_IDLE' || s === 'REPORT_CLARIFYING' || s === 'CHARACTER_SPEAKING' || s === 'REPORT_COMPLETE' || s === 'LIVE_CONVERSATION';
/** Whether the mic streams to Live. */
export const micOpen = (s: FlowState) => s === 'LIVE_IDLE' || s === 'REPORT_CLARIFYING' || s === 'REPORT_COMPLETE' || s === 'LIVE_CONVERSATION';
/** Only a live camera is shown to Live. After the photo, the report is about the snapshot. */
export const framesOpen = (s: FlowState) => s === 'LIVE_IDLE';
/** The frozen photo replaces the camera from the capture until he's back in his window. */
export const showsSnapshot = (s: FlowState) => s !== 'LIVE_IDLE' && s !== 'CAPTURING';
