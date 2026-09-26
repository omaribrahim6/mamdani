import type { CategoryId } from './categories';

export type AccessImpact = 'none' | 'low' | 'moderate' | 'critical';
export type Mood = 'dismayed' | 'determined' | 'impressed' | 'confused';

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

export interface CityStats {
  hourly: Array<{ t: number; count: number }>;
  byCategory: Array<{ category: CategoryId; open: number }>;
  openCount: number;
  resolvedToday: number;
  medianHoursToFix: number | null;
  accessibilityOpen: number;
}
