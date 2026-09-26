import snapshotIssues from '../fixtures/issues.json';
import snapshotStats from '../fixtures/stats.json';

// The Command Center reads the same API the phone writes to (Next app: /api/issues, /api/stats).
// In development Vite proxies /api to it. If it can't be reached, a snapshot of real Ottawa
// reports keeps the console usable offline.

export type Status = 'new' | 'assigned' | 'in_progress' | 'resolved';

export interface IssueEvent { at: number; kind: 'reported' | 'confirmed' | 'status'; note: string }

export interface ApiIssue {
  id: number;
  category: string;
  title: string;
  summary: string;
  lat: number;
  lng: number;
  address: string;
  severity: number;
  safetyRisk: number;
  hazards: string[];
  accessibility: { notes: string[]; impact: 'none' | 'low' | 'moderate' | 'critical'; barrier: boolean };
  department: string;
  status: Status;
  reports: number;
  firstReportedAt: number;
  lastReportedAt: number;
  resolvedAt: number | null;
  mediaId: string | null;
  box: [number, number, number, number] | null;
  events: IssueEvent[];
  updatedAt: number;
  priority: number;
  priorityParts: Record<string, number>;
  /** present once the city-standards branch lands */
  dueAt?: number | null;
  standard?: { text: string; targetHours: number | null; sourceUrl: string; sourceTitle: string };
}

export interface ApiStats {
  hourly: Array<{ t: number; count: number }>;
  byCategory: Array<{ category: string; open: number }>;
  openCount: number;
  resolvedToday: number;
  medianHoursToFix: number | null;
  accessibilityOpen: number;
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
export const WRITES_ENABLED = import.meta.env.VITE_ALLOW_WRITES === '1';

export const mediaUrl = (id: string | null) => (id ? `${BASE}/api/media/${id}` : null);

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return (await r.json()) as T;
}

export async function loadCity(): Promise<{ issues: ApiIssue[]; stats: ApiStats; live: boolean }> {
  try {
    const [i, s] = await Promise.all([getJson<{ issues: ApiIssue[] }>('/api/issues'), getJson<ApiStats>('/api/stats')]);
    return { issues: i.issues, stats: s, live: true };
  } catch {
    return { issues: (snapshotIssues as { issues: ApiIssue[] }).issues, stats: snapshotStats as ApiStats, live: false };
  }
}

export async function setStatus(id: number, status: Status, note: string): Promise<ApiIssue | null> {
  if (!WRITES_ENABLED) return null;
  const r = await fetch(`${BASE}/api/issues/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note }),
  });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return ((await r.json()) as { issue: ApiIssue }).issue;
}
