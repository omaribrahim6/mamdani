import type { CategoryId } from '../categories';
import type { CityStats, Issue, Report, ReportResponse, Status } from '../types';

export interface NewIssue extends Omit<Issue, 'id' | 'priority' | 'priorityParts' | 'events' | 'updatedAt'> {}

export interface Store {
  kind: 'tiger' | 'memory';
  listIssues(): Promise<Issue[]>;
  changedSince(ts: number): Promise<Issue[]>;
  getIssue(id: number): Promise<{ issue: Issue; reports: Report[] } | null>;
  openNear(lat: number, lng: number, radiusM: number, category: CategoryId): Promise<Array<Issue & { distance: number }>>;
  createIssue(i: NewIssue, first: Omit<Report, 'id' | 'issueId'>): Promise<{ issue: Issue; report: Report }>;
  confirmIssue(id: number, r: Omit<Report, 'id' | 'issueId'>): Promise<{ issue: Issue; report: Report }>;
  setStatus(id: number, status: Status, note: string): Promise<Issue | null>;
  putMedia(data: Buffer, mime: string): Promise<string>;
  getMedia(id: string): Promise<{ data: Buffer; mime: string } | null>;
  stats(): Promise<CityStats>;

  // Idempotency ledger for phone submissions: one shutter press (session) → at most one commit.
  /** the stored outcome of a session, if it finished; `pending` if another request is committing it */
  getSession(id: string): Promise<{ response: ReportResponse | null } | null>;
  /** true if this request now owns the commit; false if the session already exists */
  claimSession(id: string): Promise<boolean>;
  completeSession(id: string, issueId: number, response: ReportResponse): Promise<void>;
  /** the commit failed: let a retry with the same session try again */
  releaseSession(id: string): Promise<void>;
}
