import type { CategoryId } from './categories';

export type AccessImpact = 'none' | 'low' | 'moderate' | 'critical';
export type Mood = 'dismayed' | 'determined' | 'impressed' | 'confused';

// ── Mamdani's performance vocabulary ──
// Gemini picks from these finite lists; the renderer only ever gets actions it knows how to play.
export const CHARACTER_OUTFITS = ['DEFAULT', 'CONSTRUCTION', 'INSPECTOR', 'SANITATION'] as const;
export const CHARACTER_ANIMATIONS = [
  'PLACE_FLAG',
  'PLACE_CONE',
  'CHECK_CLIPBOARD',
  'INSPECT_GROUND',
  'POINT_AT_ISSUE',
  'LOOK_UP',
  'SHAKE_HEAD',
  'ACKNOWLEDGE',
] as const;
export const CHARACTER_PROPS = ['NONE', 'WARNING_FLAG', 'CLIPBOARD', 'TRAFFIC_CONE', 'FLASHLIGHT'] as const;
export const CHARACTER_EMOTIONS = ['CONCERNED', 'DETERMINED', 'IMPRESSED', 'CONFUSED', 'CHEERFUL'] as const;
export type CharacterOutfit = (typeof CHARACTER_OUTFITS)[number];
export type CharacterAnimation = (typeof CHARACTER_ANIMATIONS)[number];
export type CharacterProp = (typeof CHARACTER_PROPS)[number];
export type CharacterEmotion = (typeof CHARACTER_EMOTIONS)[number];

export interface CharacterDecision {
  outfit: CharacterOutfit;
  animation: CharacterAnimation;
  prop: CharacterProp;
  emotion: CharacterEmotion;
  /** the one line he says after the action */
  response: string;
}

/** What the AI pulls out of one photo or video. */
export interface Analysis {
  isCivicIssue: boolean;
  category: CategoryId;
  title: string;
  summary: string;
  infrastructure: string;
  severity: number; // 0-100
  safetyRisk: number; // 0-100
  hazards: string[];
  accessibility: { barrier: boolean; impact: AccessImpact; notes: string[] };
  /** Where the problem is in the photo: [ymin, xmin, ymax, xmax], 0-1000 */
  box: [number, number, number, number] | null;
  transcript: string;
  mayorLine: string;
  mood: Mood;
  confidence: number; // 0-1
  engine: 'gemini' | 'demo';
  /** how Mamdani presents this (phone app); mayorLine/mood above mirror it for the web capture */
  character?: CharacterDecision;
  /** set when the photo is ambiguous: ask before committing anything */
  clarification?: { needed: boolean; question: string; options: string[] };
}

export type Status = 'new' | 'assigned' | 'in_progress' | 'resolved';

export const STATUS_LABEL: Record<Status, string> = {
  new: 'Waiting for inspection',
  assigned: 'Crew assigned',
  in_progress: 'Being fixed',
  resolved: 'Fixed',
};

export interface Report {
  id: string;
  issueId: number;
  createdAt: number;
  lat: number;
  lng: number;
  address: string;
  mediaId: string | null;
  transcript: string;
  analysis: Analysis;
}

export interface IssueEvent {
  at: number;
  kind: 'reported' | 'confirmed' | 'status';
  note: string;
}

export interface PriorityParts {
  severity: number;
  safety: number;
  accessibility: number;
  confirmations: number;
  age: number;
}

export interface Issue {
  id: number;
  category: CategoryId;
  title: string;
  summary: string;
  lat: number;
  lng: number;
  address: string;
  severity: number;
  safetyRisk: number;
  hazards: string[];
  accessibility: Analysis['accessibility'];
  department: string;
  status: Status;
  reports: number;
  firstReportedAt: number;
  lastReportedAt: number;
  resolvedAt: number | null;
  mediaId: string | null;
  box: Analysis['box'];
  priority: number;
  priorityParts: PriorityParts;
  events: IssueEvent[];
  updatedAt: number;
}

/** Returned to the citizen after they submit. */
export interface SubmitResult {
  report: Report;
  issue: Issue;
  duplicate: boolean;
}

/** One resident report on the activity timeline (dashboard charts and the map replay). */
export interface ActivityPoint {
  t: number;
  issueId: number;
  category: CategoryId;
  lat: number;
  lng: number;
}

export interface CityStats {
  hourly: Array<{ t: number; count: number }>;
  byCategory: Array<{ category: CategoryId; open: number }>;
  openCount: number;
  resolvedToday: number;
  medianHoursToFix: number | null;
  accessibilityOpen: number;
}

/**
 * The one authoritative result of a shutter press. The database got `issue`, the renderer gets
 * `character`, the voice gets `character.response`. They can't disagree because they're one object.
 */
export interface ReportDecision {
  reportId: string; // e.g. "report_1849", stable for the life of the work order
  sessionId: string; // the idempotency key the phone created at shutter time
  issue: {
    id: number;
    type: CategoryId;
    title: string;
    summary: string;
    severity: number;
    safetyRisk: number;
    accessibilityImpact: AccessImpact;
    department: string;
    address: string;
    status: Status;
    duplicateCount: number; // how many residents have reported this problem, including this one
    duplicate: boolean;
    box: Analysis['box'];
  };
  character: CharacterDecision;
  confidence: number;
  engine: Analysis['engine'];
  /** what the pipeline checked before filing */
  checks?: {
    screened: boolean;
    /** faces / licence plates blurred in the stored photo */
    blurred: number;
    /** how it was recognised as a duplicate: photo fingerprint, model comparison, or location alone */
    matchedBy: 'photo' | 'model' | 'location' | null;
    similarity: number | null;
  };
}

/** What POST /api/report answers. Only `committed` wrote anything. */
export type ReportResponse =
  | { status: 'committed'; decision: ReportDecision; analysis: Analysis; result: SubmitResult }
  | { status: 'clarify'; question: string; options: string[] }
  | { status: 'rejected'; message: string; analysis: Analysis };
