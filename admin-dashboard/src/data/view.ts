import type { ApiIssue, Status } from './api';
import { category } from './categories';

export type Tier = 'Urgent' | 'High' | 'Standard' | 'Closed';

export const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  assigned: 'Crew assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

export function tier(issue: ApiIssue): Tier {
  if (issue.status === 'resolved') return 'Closed';
  if (issue.priority >= 70 || issue.accessibility.impact === 'critical') return 'Urgent';
  if (issue.priority >= 45) return 'High';
  return 'Standard';
}

/** 0 (calm) … 1 (on fire). Drives the card shimmer and the table glow. */
export function urgency(issue: ApiIssue, now: number): number {
  if (issue.status === 'resolved') return 0;
  let u = Math.min(1, Math.max(0, (issue.priority - 25) / 65));
  if (issue.dueAt) {
    const left = (issue.dueAt - now) / 3_600_000;
    if (left < 0) u = 1;
    else u = Math.max(u, 1 - Math.min(1, left / 48));
  }
  return u;
}

export const tone = (issue: ApiIssue) => category(issue.category).color;

export function ago(ms: number, now: number): string {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleString('en-CA', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

export const ticketId = (issue: ApiIssue) => `OTT-${String(issue.id).padStart(4, '0')}`;
