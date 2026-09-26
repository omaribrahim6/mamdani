import type { IssueStandard } from '../../lib/types';

// The city's official service standard for a report, as one short line for the phone.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad =(n: number) => String(n).padStart(2, '0');

/** "4 days", "48 hours" */
export function targetWords(hours: number): string {
  if (hours % 24 === 0) {
    const d = hours / 24;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/** "Tue 14:00" (this phone's clock) */
export function dueWords(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "City target: 4 days · due Tue 14:00", or null when the standard has no number */
export function targetLine(s: IssueStandard | undefined, dueAt: number | null | undefined): string | null {
  if (!s?.targetHours) return null;
  return `City target: ${targetWords(s.targetHours)}${dueAt ? ` · due ${dueWords(dueAt)}` : ''}`;
}

/** What Mamdani is told about the standard once a report is filed, or '' if there is none. */
export function standardBrief(s: IssueStandard | undefined, dueAt: number | null | undefined): string {
  if (!s) return '';
  const due = dueAt
    ? ` ${s.roadClassNote ? 'For a typical Class 3 street, the' : 'The'} city's target is to fix it within ${targetWords(s.targetHours!)} of the first report, so it's due by ${LONG_DAYS[new Date(dueAt).getDay()]} at ${dueWords(dueAt).slice(4)}.`
    : '';
  return ` The city's official service standard ("${s.sourceTitle}"): ${s.text}${due} You may quote this target and cite "${s.sourceTitle}"; no other timeline.`;
}
