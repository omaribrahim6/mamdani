import type { ReportDecision } from '../../../lib/types';
import type { Media } from '../api';

// One authoritative interaction state. Every screen, Mamdani's mode, whether Gemini Live may speak,
// whether the mic and camera stream — all of it is derived from `state`, never from loose booleans.

export type FlowState =
  | 'LIVE_IDLE' // camera up, Mamdani in his window, talking it through with the resident
  | 'CAPTURING' // he decided to report it: "hold steady" and the evidence photo
  | 'CAPTURED' // snapshot frozen
  | 'REPORT_PROCESSING' // one Gemini call is deciding the report
  | 'REPORT_CLARIFYING' // Mamdani asked which problem; nothing committed yet
  | 'REPORT_READY' // committed; the decision is in hand
  | 'CHARACTER_EXITING' // he walks out of the window; it closes
  | 'CHARACTER_ENTERING' // the same Mamdani walks into the photo
  | 'CHARACTER_ACTION' // flag / cone / clipboard …
  | 'CHARACTER_SPEAKING' // the one canonical line
  | 'REPORT_COMPLETE' // "Reported" confirmation
  | 'LIVE_CONVERSATION' // talk about the filed report
  | 'CHARACTER_RETURNING'; // he walks back to his window for the next report

/** Frozen at shutter time. The report is about this, whatever the camera sees afterwards. */
export interface Snapshot {
  sessionId: string;
  photo: Media;
  lat: number;
  lng: number;
  capturedAt: number;
  context: string;
}

export interface Flow {
  state: FlowState;
  snapshot: Snapshot | null;
  decision: ReportDecision | null;
  clarify: { question: string; options: string[] } | null;
  answer: string | null;
  notice: string | null;
}

export type FlowEvent =
  | { type: 'CAPTURE' }
  | { type: 'SHUTTER'; snapshot: Snapshot }
  | { type: 'PROCESSING' }
  | { type: 'CLARIFY'; question: string; options: string[] }
  | { type: 'ANSWERED'; answer: string }
  | { type: 'DECIDED'; decision: ReportDecision }
  | { type: 'FAILED'; message: string }
  | { type: 'EXIT' }
  | { type: 'ENTER' }
  | { type: 'ACT' }
  | { type: 'SPEAK' }
  | { type: 'SPOKEN' }
  | { type: 'CONVERSE' }
  | { type: 'NEW_REPORT' }
  | { type: 'RETURNED' }
  | { type: 'DISMISS_NOTICE' };

export const initialFlow: Flow = { state: 'LIVE_IDLE', snapshot: null, decision: null, clarify: null, answer: null, notice: null };

/** Legal transitions only. Anything else (a double tap, a late callback) leaves the flow untouched. */
export function flow(f: Flow, e: FlowEvent): Flow {
  const at = (...states: FlowState[]) => states.includes(f.state);
  switch (e.type) {
    case 'CAPTURE':
      return at('LIVE_IDLE') ? { ...initialFlow, state: 'CAPTURING' } : f;
    case 'SHUTTER':
      return at('LIVE_IDLE', 'CAPTURING') ? { ...initialFlow, state: 'CAPTURED', snapshot: e.snapshot } : f;
    case 'PROCESSING':
      return at('CAPTURED') ? { ...f, state: 'REPORT_PROCESSING' } : f;
    case 'CLARIFY':
      return at('REPORT_PROCESSING') ? { ...f, state: 'REPORT_CLARIFYING', clarify: { question: e.question, options: e.options } } : f;
    case 'ANSWERED':
      return at('REPORT_CLARIFYING') ? { ...f, state: 'REPORT_PROCESSING', answer: e.answer } : f;
    case 'DECIDED':
      return at('REPORT_PROCESSING') ? { ...f, state: 'REPORT_READY', decision: e.decision, clarify: null } : f;
    case 'FAILED':
      return at('CAPTURING', 'CAPTURED', 'REPORT_PROCESSING', 'REPORT_CLARIFYING') ? { ...initialFlow, notice: e.message } : f;
    case 'EXIT':
      return at('REPORT_READY') ? { ...f, state: 'CHARACTER_EXITING' } : f;
    case 'ENTER':
      return at('CHARACTER_EXITING') ? { ...f, state: 'CHARACTER_ENTERING' } : f;
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
  if (s === 'CHARACTER_EXITING' || s === 'CHARACTER_RETURNING') return 'TRANSITIONING';
  if (s === 'CHARACTER_ENTERING' || s === 'CHARACTER_ACTION' || s === 'CHARACTER_SPEAKING' || s === 'REPORT_COMPLETE' || s === 'LIVE_CONVERSATION')
    return 'SCENE';
  return 'PORTRAIT';
}

/** Gemini Live stays connected throughout; this is whether his voice may reach the user. While the
 *  report is being processed and he's walking into the photo, the orchestrator owns him. */
export const liveMaySpeak = (s: FlowState) =>
  s === 'LIVE_IDLE' || s === 'REPORT_CLARIFYING' || s === 'CHARACTER_SPEAKING' || s === 'REPORT_COMPLETE' || s === 'LIVE_CONVERSATION';
/** Whether the mic streams to Live. */
export const micOpen = (s: FlowState) => s === 'LIVE_IDLE' || s === 'REPORT_CLARIFYING' || s === 'REPORT_COMPLETE' || s === 'LIVE_CONVERSATION';
/** Only a live camera is shown to Live. After the photo, the report is about the snapshot. */
export const framesOpen = (s: FlowState) => s === 'LIVE_IDLE';
/** The frozen photo replaces the camera from the capture until he's back in his window. */
export const showsSnapshot = (s: FlowState) => s !== 'LIVE_IDLE' && s !== 'CAPTURING';
