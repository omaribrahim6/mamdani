import { category, CATEGORY_IDS, type CategoryId } from '../categories';
import { metersBetween } from '../priority';
import { sla } from '../sla';
import { store } from '../store';
import { STATUS_LABEL, type Issue, type Status } from '../types';

// The city's record, shaped for Gemini: compact rows it can reason over and cite by work-order
// number. Everything the dashboard's assistant and briefings claim comes through here.

const H = 3600e3;
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

export const ottawaNow = () =>
  new Date().toLocaleString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

/** One issue as a row the model can quote. */
export function row(i: Issue, now = Date.now()) {
  const s = sla(i, now);
  return {
    id: i.id,
    type: category(i.category).label,
    title: i.title,
    address: i.address,
    status: STATUS_LABEL[i.status],
    department: i.department,
    priority: Math.round(i.priority),
    severity: i.severity,
    safetyRisk: i.safetyRisk,
    accessibility: i.accessibility.impact,
    residentReports: i.reports,
    openHours: Math.round((now - i.firstReportedAt) / H),
    serviceTarget: `${s.state.replace('_', ' ')} (${Math.round(s.target)}h target, ${s.left >= 0 ? `${Math.round(s.left)}h left` : `${Math.round(-s.left)}h late`})`,
    lat: +i.lat.toFixed(5),
    lng: +i.lng.toFixed(5),
  };
}

/** Everything about one issue, with its reports' words. */
export async function detail(id: number) {
  const found = await store.getIssue(id);
  if (!found) return null;
  const { issue: i, reports } = found;
  return {
    ...row(i),
    summary: i.summary,
    hazards: i.hazards,
    accessibilityNotes: i.accessibility.notes,
    priorityBreakdown: i.priorityParts,
    firstReported: when(i.firstReportedAt),
    lastReported: when(i.lastReportedAt),
    resolved: i.resolvedAt ? when(i.resolvedAt) : null,
    hasPhoto: !!i.mediaId,
    history: i.events.slice(-10).map((e) => `${when(e.at)} — ${e.note}`),
    residentWords: reports
      .filter((r) => r.transcript)
      .slice(0, 5)
      .map((r) => `${when(r.createdAt)}: "${r.transcript.slice(0, 240)}"`),
  };
}

export interface IssueQuery {
  status?: Array<Status | 'open'>;
  category?: CategoryId[];
  department?: string;
  minPriority?: number;
  accessibility?: 'any_barrier' | 'critical';
  serviceTarget?: 'breached' | 'at_risk' | 'late_or_at_risk';
  text?: string;
  near?: { lat: number; lng: number; radiusM: number };
  sinceHours?: number;
  sort?: 'priority' | 'newest' | 'oldest' | 'reports' | 'severity';
  limit?: number;
}

export async function query(q: IssueQuery) {
  const now = Date.now();
  let list = await store.listIssues();
  if (q.status?.length) list = list.filter((i) => q.status!.includes(i.status) || (q.status!.includes('open') && i.status !== 'resolved'));
  if (q.category?.length) list = list.filter((i) => q.category!.includes(i.category));
  if (q.department) list = list.filter((i) => i.department.toLowerCase().includes(q.department!.toLowerCase()));
  if (q.minPriority) list = list.filter((i) => i.priority >= q.minPriority!);
  if (q.accessibility === 'critical') list = list.filter((i) => i.accessibility.impact === 'critical');
  if (q.accessibility === 'any_barrier') list = list.filter((i) => i.accessibility.impact === 'moderate' || i.accessibility.impact === 'critical');
  if (q.serviceTarget) {
    const want = q.serviceTarget === 'late_or_at_risk' ? ['breached', 'at_risk'] : [q.serviceTarget];
    list = list.filter((i) => i.status !== 'resolved' && want.includes(sla(i, now).state));
  }
  if (q.sinceHours) list = list.filter((i) => i.firstReportedAt > now - q.sinceHours! * H);
  if (q.text) {
    const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((i) => {
      const hay = `${i.title} ${i.summary} ${i.address} ${i.hazards.join(' ')} ${category(i.category).label}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  if (q.near) list = list.filter((i) => metersBetween(q.near!.lat, q.near!.lng, i.lat, i.lng) <= q.near!.radiusM);
  const by: Record<string, (a: Issue, b: Issue) => number> = {
    priority: (a, b) => b.priority - a.priority,
    newest: (a, b) => b.firstReportedAt - a.firstReportedAt,
    oldest: (a, b) => a.firstReportedAt - b.firstReportedAt,
    reports: (a, b) => b.reports - a.reports,
    severity: (a, b) => b.severity - a.severity,
  };
  list.sort(by[q.sort ?? 'priority']);
  const limit = Math.min(25, q.limit ?? 12);
  const count = (key: (i: Issue) => string) => list.reduce<Record<string, number>>((m, i) => ((m[key(i)] = (m[key(i)] ?? 0) + 1), m), {});
  return {
    matched: list.length,
    byStatus: count((i) => STATUS_LABEL[i.status]),
    byType: count((i) => category(i.category).label),
    issues: list.slice(0, limit).map((i) => row(i, now)),
    ids: list.slice(0, limit).map((i) => i.id),
  };
}

/** The whole city at a glance: what the brief and the stats tool stand on. */
export async function overview() {
  const now = Date.now();
  const [issues, stats, activity] = await Promise.all([store.listIssues(), store.stats(), store.activity(now - 48 * H)]);
  const open = issues.filter((i) => i.status !== 'resolved');
  const slas = open.map((i) => ({ i, s: sla(i, now) }));
  const last24 = activity.filter((a) => a.t > now - 24 * H).length;
  const prev24 = activity.length - last24;
  const byDept = open.reduce<Record<string, { open: number; late: number; topPriority: number }>>((m, i) => {
    const d = (m[i.department] ??= { open: 0, late: 0, topPriority: 0 });
    d.open++;
    if (sla(i, now).state === 'breached') d.late++;
    d.topPriority = Math.max(d.topPriority, Math.round(i.priority));
    return m;
  }, {});
  return {
    now: ottawaNow(),
    openIssues: open.length,
    byStatus: Object.fromEntries((['new', 'assigned', 'in_progress', 'resolved'] as Status[]).map((s) => [STATUS_LABEL[s], issues.filter((i) => i.status === s).length])),
    newLast24h: open.filter((i) => i.firstReportedAt > now - 24 * H).length,
    residentReportsLast24h: last24,
    residentReportsPrevious24h: prev24,
    resolvedToday: stats.resolvedToday,
    medianHoursToFix: stats.medianHoursToFix == null ? null : +stats.medianHoursToFix.toFixed(1),
    accessibilityBarriersOpen: stats.accessibilityOpen,
    serviceTargets: {
      breached: slas.filter((x) => x.s.state === 'breached').length,
      atRisk: slas.filter((x) => x.s.state === 'at_risk').length,
    },
    openByType: Object.fromEntries(CATEGORY_IDS.map((c) => [category(c).label, open.filter((i) => i.category === c).length]).filter(([, n]) => n)),
    openByDepartment: byDept,
    oldestOpen: [...open].sort((a, b) => a.firstReportedAt - b.firstReportedAt).slice(0, 3).map((i) => row(i, now)),
    topPriorities: open.slice(0, 8).map((i) => row(i, now)),
  };
}
