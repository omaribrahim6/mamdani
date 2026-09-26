import { randomUUID } from 'node:crypto';
import { category, CATEGORY_IDS, type CategoryId } from '../categories';
import { metersBetween, priorityOf } from '../priority';
import { SEED } from '../seed';
import type { Analysis, CityStats, Issue, Report, ReportResponse, Status } from '../types';
import { STATUS_LABEL } from '../types';
import type { NewIssue, Store } from './types';

// In-process store for local dev and offline demos, seeded with two days of Ottawa reports.
// Same interface as the Tiger Data store, so the app never knows which one it's talking to.

interface State {
  issues: Map<number, Issue>;
  reports: Report[];
  media: Map<string, { data: Buffer; mime: string }>;
  sessions: Map<string, ReportResponse | null>;
  embeddings: Map<number, number[]>;
  nextId: number;
}

const H = 3600e3;

function reprioritize(i: Issue, now = Date.now()) {
  const p = priorityOf(i, now);
  i.priority = p.total;
  i.priorityParts = p.parts;
  return i;
}

function seed(): State {
  const now = Date.now();
  const st: State = { issues: new Map(), reports: [], media: new Map(), sessions: new Map(), embeddings: new Map(), nextId: 1831 };
  // deterministic jitter so the charts look the same on every restart
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const d of SEED) {
    const id = st.nextId++;
    const first = now - d.firstHoursAgo * H;
    const lastSpan = Math.max(0.2, (d.resolvedHoursAgo ? d.firstHoursAgo - d.resolvedHoursAgo : d.firstHoursAgo) * H);
    const times = [first, ...Array.from({ length: d.reports - 1 }, () => first + rnd() * lastSpan)].sort((a, b) => a - b);
    const analysis: Analysis = {
      isCivicIssue: true, category: d.category, title: d.title, summary: d.summary, infrastructure: '', severity: d.severity,
      safetyRisk: d.safetyRisk, hazards: d.hazards, accessibility: { barrier: d.access[0] === 'critical' || d.access[0] === 'moderate', impact: d.access[0], notes: d.access[1] },
      box: null, transcript: '', mayorLine: '', mood: 'determined', confidence: 0.8, engine: 'demo',
    };
    const events: Issue['events'] = times.map((t, k) => ({ at: t, kind: k ? 'confirmed' : 'reported', note: k ? 'Another resident reported this' : 'First report' }));
    if (d.status !== 'new') events.push({ at: first + lastSpan * 0.6, kind: 'status', note: STATUS_LABEL.assigned });
    if (d.status === 'in_progress' || d.status === 'resolved') events.push({ at: first + lastSpan * 0.8, kind: 'status', note: STATUS_LABEL.in_progress });
    if (d.status === 'resolved') events.push({ at: now - (d.resolvedHoursAgo ?? 1) * H, kind: 'status', note: STATUS_LABEL.resolved });
    const issue: Issue = {
      id, category: d.category, title: d.title, summary: d.summary, lat: d.lat, lng: d.lng, address: d.address,
      severity: d.severity, safetyRisk: d.safetyRisk, hazards: d.hazards, accessibility: analysis.accessibility,
      department: category(d.category).department, status: d.status, reports: d.reports, firstReportedAt: first,
      lastReportedAt: times[times.length - 1], resolvedAt: d.status === 'resolved' ? now - (d.resolvedHoursAgo ?? 1) * H : null,
      mediaId: null, box: null, priority: 0, priorityParts: { severity: 0, safety: 0, accessibility: 0, confirmations: 0, age: 0 },
      events: events.sort((a, b) => a.at - b.at), updatedAt: now,
    };
    st.issues.set(id, reprioritize(issue, now));
    times.forEach((t, k) => {
      const jitter = () => (rnd() - 0.5) * 0.00018;
      st.reports.push({ id: `seed-${id}-${k}`, issueId: id, createdAt: t, lat: d.lat + jitter(), lng: d.lng + jitter(), address: d.address, mediaId: null, transcript: '', analysis });
    });
  }
  // a background hum of other (already closed) reports so the hourly chart has a real daily rhythm
  for (let h = 48; h > 0; h--) {
    const hourOfDay = new Date(now - h * H).getHours();
    const rush = hourOfDay >= 7 && hourOfDay <= 9 ? 3 : hourOfDay >= 16 && hourOfDay <= 18 ? 4 : hourOfDay >= 23 || hourOfDay <= 5 ? 0 : 1;
    for (let k = 0; k < rush + Math.round(rnd()); k++) {
      const cat = CATEGORY_IDS[Math.floor(rnd() * (CATEGORY_IDS.length - 1))];
      st.reports.push({
        id: `bg-${h}-${k}`, issueId: 0, createdAt: now - h * H + rnd() * H, lat: 45.42, lng: -75.69, address: '', mediaId: null, transcript: '',
        analysis: { category: cat } as Analysis,
      });
    }
  }
  return st;
}

const g = globalThis as unknown as { __mamdaniMemory?: State };
const state = () => (g.__mamdaniMemory ??= seed());

export const memoryStore: Store = {
  kind: 'memory',

  async listIssues() {
    const now = Date.now();
    return [...state().issues.values()].map((i) => reprioritize(i, now)).sort((a, b) => b.priority - a.priority);
  },

  async changedSince(ts) {
    return [...state().issues.values()].filter((i) => i.updatedAt > ts);
  },

  async getIssue(id) {
    const issue = state().issues.get(id);
    if (!issue) return null;
    return { issue: reprioritize(issue), reports: state().reports.filter((r) => r.issueId === id).sort((a, b) => b.createdAt - a.createdAt) };
  },

  async openNear(lat, lng, radiusM, cat: CategoryId, embedding) {
    const st = state();
    return [...st.issues.values()]
      .filter((i) => i.status !== 'resolved' && i.category === cat)
      .map((i) => {
        const e = st.embeddings.get(i.id);
        const similarity = e && embedding ? e.reduce((s, x, k) => s + x * embedding[k], 0) : null;
        return { ...i, distance: metersBetween(lat, lng, i.lat, i.lng), similarity };
      })
      .filter((i) => i.distance <= radiusM)
      .sort((a, b) => a.distance - b.distance);
  },

  async createIssue(n: NewIssue, first, embedding) {
    const st = state();
    const id = st.nextId++;
    if (embedding) st.embeddings.set(id, embedding);
    const now = Date.now();
    const issue: Issue = reprioritize({
      ...n, id, priority: 0, priorityParts: { severity: 0, safety: 0, accessibility: 0, confirmations: 0, age: 0 },
      events: [{ at: now, kind: 'reported', note: 'First report' }], updatedAt: now,
    });
    st.issues.set(id, issue);
    const report: Report = { ...first, id: randomUUID(), issueId: id };
    st.reports.push(report);
    return { issue, report };
  },

  async confirmIssue(id, r) {
    const st = state();
    const issue = st.issues.get(id)!;
    const now = Date.now();
    issue.reports += 1;
    issue.lastReportedAt = now;
    // the city trusts the worst credible assessment
    issue.severity = Math.max(issue.severity, r.analysis.severity);
    issue.safetyRisk = Math.max(issue.safetyRisk, r.analysis.safetyRisk);
    const rank = { none: 0, low: 1, moderate: 2, critical: 3 };
    if (rank[r.analysis.accessibility.impact] > rank[issue.accessibility.impact]) issue.accessibility = r.analysis.accessibility;
    if (!issue.mediaId && r.mediaId) {
      issue.mediaId = r.mediaId;
      issue.box = r.analysis.box;
    }
    issue.events.push({ at: now, kind: 'confirmed', note: 'Another resident reported this' });
    issue.updatedAt = now;
    reprioritize(issue, now);
    const report: Report = { ...r, id: randomUUID(), issueId: id };
    st.reports.push(report);
    return { issue, report };
  },

  async setStatus(id, status: Status, note) {
    const issue = state().issues.get(id);
    if (!issue) return null;
    const now = Date.now();
    issue.status = status;
    issue.resolvedAt = status === 'resolved' ? now : null;
    issue.events.push({ at: now, kind: 'status', note: note || STATUS_LABEL[status] });
    issue.updatedAt = now;
    return reprioritize(issue, now);
  },

  async putMedia(data, mime) {
    const id = randomUUID();
    state().media.set(id, { data, mime });
    return id;
  },

  async getMedia(id) {
    return state().media.get(id) ?? null;
  },

  async getSession(id) {
    const st = state();
    return st.sessions.has(id) ? { response: st.sessions.get(id) ?? null } : null;
  },

  async claimSession(id) {
    const st = state();
    if (st.sessions.has(id)) return false;
    st.sessions.set(id, null);
    return true;
  },

  async completeSession(id, _issueId, response) {
    state().sessions.set(id, response);
  },

  async releaseSession(id) {
    state().sessions.delete(id);
  },

  async similar(embedding, limit) {
    const st = state();
    return [...st.embeddings.entries()]
      .map(([id, e]) => ({ issue: reprioritize(st.issues.get(id)!), similarity: e.reduce((s, x, k) => s + x * embedding[k], 0) }))
      .filter((m) => m.issue)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  },

  async activity(since) {
    return state()
      .reports.filter((r) => r.createdAt > since)
      .map((r) => ({ t: r.createdAt, issueId: r.issueId, category: r.analysis.category, lat: r.lat, lng: r.lng }))
      .sort((a, b) => a.t - b.t);
  },

  async stats(): Promise<CityStats> {
    const now = Date.now();
    const st = state();
    const hourly = Array.from({ length: 48 }, (_, k) => {
      const t = Math.floor((now - (47 - k) * H) / H) * H;
      return { t, count: st.reports.filter((r) => r.createdAt >= t && r.createdAt < t + H).length };
    });
    const open = [...st.issues.values()].filter((i) => i.status !== 'resolved');
    const counts = new Map<CategoryId, number>();
    open.forEach((i) => counts.set(i.category, (counts.get(i.category) ?? 0) + 1));
    const fixed = [...st.issues.values()].filter((i) => i.resolvedAt);
    const durations = fixed.map((i) => (i.resolvedAt! - i.firstReportedAt) / H).sort((a, b) => a - b);
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);
    return {
      hourly,
      byCategory: [...counts.entries()].map(([c, n]) => ({ category: c, open: n })).sort((a, b) => b.open - a.open),
      openCount: open.length,
      resolvedToday: fixed.filter((i) => i.resolvedAt! >= startOfDay).length,
      medianHoursToFix: durations.length ? durations[Math.floor(durations.length / 2)] : null,
      accessibilityOpen: open.filter((i) => i.accessibility.impact === 'critical' || i.accessibility.impact === 'moderate').length,
    };
  },
};
