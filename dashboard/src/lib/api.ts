import type { ActivityPoint, CityStats, Issue, Report, Status } from '@shared/types';

// The Mamdani API (the Next app at the repo root). Same origin in dev through Vite's proxy;
// VITE_API_URL when the dashboard is deployed on its own.
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function get<T>(path: string): Promise<T> {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  issues: (since?: number) => get<{ issues: Issue[]; now: number; store: 'tiger' | 'memory' }>(`/api/issues${since ? `?since=${since}` : ''}`),
  issue: (id: number) => get<{ issue: Issue; reports: Report[] }>(`/api/issues/${id}`),
  stats: () => get<CityStats>('/api/stats'),
  activity: (days = 7) => get<{ now: number; points: ActivityPoint[] }>(`/api/activity?days=${days}`),
  search: (q: string) => get<{ results: Array<{ id: number; score: number; via: 'photo' | 'text' }> }>(`/api/search?q=${encodeURIComponent(q)}`),
  brief: (refresh = false) => get<Brief>(`/api/brief${refresh ? '?refresh=1' : ''}`),
  plan: (id: number) => get<WorkPlan>(`/api/issues/${id}/plan`),
  media: (id: string) => `${API}/api/media/${id}`,
  async setStatus(id: number, status: Status, note: string) {
    const r = await fetch(`${API}/api/issues/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note }),
    });
    if (!r.ok) throw new Error(`status → ${r.status}`);
    return ((await r.json()) as { issue: Issue }).issue;
  },
};

export interface Source {
  title: string;
  uri: string;
}

export interface Brief {
  generatedAt: number;
  model: string;
  headline: string;
  greeting: string;
  summary: string;
  priorities: Array<{ issueId: number; why: string; action: string }>;
  watchlist: Array<{ kind: 'weather' | 'trend' | 'equity' | 'backlog' | 'event'; title: string; detail: string }>;
  crewPlan: Array<{ department: string; focus: string; issueIds: number[] }>;
  outlook: { expectedReports: number; reasoning: string };
  signoff: string;
  conditions: { answer: string; sources: Source[] };
  numbers: {
    openIssues: number;
    newLast24h: number;
    residentReportsLast24h: number;
    residentReportsPrevious24h: number;
    resolvedToday: number;
    medianHoursToFix: number | null;
    accessibilityBarriersOpen: number;
    serviceTargets: { breached: number; atRisk: number };
  };
}

export interface WorkPlan {
  issueId: number;
  generatedAt: number;
  crew: Array<{ role: string; label: string; count: number; hours: number }>;
  equipment: Array<{ kind: string; label: string; hours: number }>;
  materials: Array<{ item: string; quantity: number; unit: string; unitCost: number }>;
  cost: {
    low: number;
    high: number;
    currency: 'CAD';
    labourHours: number;
    basis: string;
    lines: Array<{ kind: 'labour' | 'equipment' | 'materials' | 'contingency'; label: string; detail: string; low: number; high: number }>;
  };
  steps: string[];
  trafficControl: string;
  riskIfDelayed: string;
  roi: string;
  sources: Source[];
  residentUpdate: string;
}

export type AgentEvent =
  | { type: 'tool'; name: string; label: string }
  | { type: 'text'; delta: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'issues'; ids: number[] }
  | { type: 'map'; ids: number[]; label: string }
  | { type: 'route'; ids: number[]; label: string }
  | { type: 'action'; ids: number[]; status: Status; note: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Ask Mamdani; events arrive as the server streams them. */
export async function ask(
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
  context: { page: string; selectedIssueId: number | null },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
) {
  const r = await fetch(`${API}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`ask → ${r.status}`);
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, cut).trim();
      buf = buf.slice(cut + 2);
      if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
    }
  }
}
