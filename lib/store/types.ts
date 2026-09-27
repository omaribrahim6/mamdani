import type { CategoryId } from '../categories';
import type { ActivityPoint, CityStats, Issue, Report, ReportResponse, Status } from '../types';

export interface NewIssue extends Omit<Issue, 'id' | 'priority' | 'priorityParts' | 'events' | 'updatedAt'> {}

export interface Store {
  kind: 'tiger' | 'memory';
  listIssues(): Promise<Issue[]>;
  changedSince(ts: number): Promise<Issue[]>;
  getIssue(id: number): Promise<{ issue: Issue; reports: Report[] } | null>;
  /** open issues of a category near a point; with an embedding, each also carries photo similarity (-1..1) */
  openNear(
    lat: number,
    lng: number,
    radiusM: number,
    category: CategoryId,
    embedding?: number[] | null,
  ): Promise<Array<Issue & { distance: number; similarity: number | null }>>;
  createIssue(i: NewIssue, first: Omit<Report, 'id' | 'issueId'>, embedding?: number[] | null): Promise<{ issue: Issue; report: Report }>;
  confirmIssue(id: number, r: Omit<Report, 'id' | 'issueId'>): Promise<{ issue: Issue; report: Report }>;
  setStatus(id: number, status: Status, note: string): Promise<Issue | null>;
  putMedia(data: Buffer, mime: string): Promise<string>;
  getMedia(id: string): Promise<{ data: Buffer; mime: string } | null>;
  stats(): Promise<CityStats>;
  /** issues whose evidence photo sits closest to a query vector (text or photo), best first */
  similar(embedding: number[], limit: number): Promise<Array<{ issue: Issue; similarity: number }>>;
  /** every resident report since a time, light enough to plot: when, where, what */
  activity(since: number): Promise<ActivityPoint[]>;
  /** small durable key/value cache for generated content (today's brief) that must outlive a server instance */
  cacheGet<T>(key: string): Promise<T | null>;
  cacheSet(key: string, value: unknown): Promise<void>;

  // Idempotency ledger for phone submissions: one shutter press (session) → at most one commit.
  /** the stored outcome of a session, if it finished; `pending` if another request is committing it */
  getSession(id: string): Promise<{ response: ReportResponse | null } | null>;
  /** true if this request now owns the commit; false if the session already exists */
  claimSession(id: string): Promise<boolean>;
  completeSession(id: string, issueId: number, response: ReportResponse): Promise<void>;
  /** the commit failed: let a retry with the same session try again */
  releaseSession(id: string): Promise<void>;
}
