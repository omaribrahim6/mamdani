import type { CategoryId } from '../categories';
import type { CityStats, Issue, Report, Status } from '../types';

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
}
