import type { CategoryId } from './categories';
import type { Issue, IssueStandard } from './types';
import data from './standards.json';

// The official City of Ottawa / Ontario service standard for each kind of problem, looked up once
// by scripts/fetch-standards.ts and baked into lib/standards.json. Derived on read: nothing about
// it is stored per issue, so updating the JSON updates every issue.

export interface CityStandard {
  category: CategoryId;
  /** one sentence, as the source states it */
  standard: string;
  /** the target in hours, or null when no official number was found */
  targetHours: number | null;
  roadClassNote?: string;
  sourceUrl: string;
  sourceTitle: string;
  confidence: 'high' | 'medium' | 'low';
  /** low confidence, no number or no real URL: a human should check it before it's quoted */
  needsReview?: boolean;
  /** why a human flagged it; set needsReview to false once checked */
  reviewNote?: string;
  /** pages the search actually grounded on (audit trail) */
  grounding?: string[];
}

export interface StandardsFile {
  fetchedAt: string;
  model: string;
  standards: Partial<Record<CategoryId, CityStandard>>;
}

const FILE = data as unknown as StandardsFile;
const H = 3600e3;

/**
 * The standard for a category, or null. Low-confidence, unsourced or flagged (needsReview) entries
 * stay in the JSON for a human to check, but are never attached to an issue: Mamdani only cites
 * what the city published, for the problem it actually covers.
 */
export function standardFor(category: CategoryId | string): IssueStandard | null {
  const s = FILE.standards[category as CategoryId];
  if (!s || s.needsReview || s.confidence === 'low' || !/^https?:\/\//.test(s.sourceUrl) || !s.standard) return null;
  return {
    text: s.standard,
    targetHours: s.targetHours,
    sourceUrl: s.sourceUrl,
    sourceTitle: s.sourceTitle,
    ...(s.roadClassNote ? { roadClassNote: s.roadClassNote } : {}),
  };
}

/** When the city's own standard says this should be done: first report + target. */
export function dueBy(issue: Pick<Issue, 'category' | 'firstReportedAt'>): number | null {
  const s = standardFor(issue.category);
  return s?.targetHours ? issue.firstReportedAt + s.targetHours * H : null;
}

/** Fill in `standard` and `dueAt` on an issue as it's read. Mutates and returns it. */
export function withStandard<T extends Issue>(issue: T): T {
  const s = standardFor(issue.category);
  if (s) {
    issue.standard = s;
    issue.dueAt = s.targetHours ? issue.firstReportedAt + s.targetHours * H : null;
  } else {
    delete issue.standard;
    delete issue.dueAt;
  }
  return issue;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

/** The standard as standalone facts for the city's record (lib/verify.ts) and Mamdani's briefing. */
export function standardFacts(issue: Pick<Issue, 'category' | 'firstReportedAt'>): string[] {
  const s = standardFor(issue.category);
  if (!s) return [];
  const facts = [`The city's official service standard for this kind of problem, from "${s.sourceTitle}": ${s.text}`];
  if (s.targetHours) {
    const due = issue.firstReportedAt + s.targetHours * H;
    facts.push(
      `${s.roadClassNote ? 'For a typical Class 3 street, the' : 'The'} city's target is to fix it within ${targetWords(s.targetHours)} (${s.targetHours} hours) of the first report, so this one is due by ${when(due).replace(/\.$/, '')}.`,
    );
  }
  if (s.roadClassNote) facts.push(`How the target varies: ${s.roadClassNote}`);
  return facts;
}

/** "4 days", "48 hours", "30 days" */
export function targetWords(hours: number): string {
  if (hours % 24 === 0) {
    const d = hours / 24;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
