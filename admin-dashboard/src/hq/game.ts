import type { ApiIssue } from '../data/api';
import { tier } from '../data/view';

// The game layer over the city record. Everything here is derived from live issues, except the
// fields in MOCK below, which the API doesn't expose yet.

export type GameStatus = 'boss' | 'quest' | 'loot';

export const GAME = {
  boss: { label: 'Critical Boss Battle', short: 'Boss Battle', color: '#EF4444' },
  quest: { label: 'Active Quest', short: 'Quest', color: '#EAB308' },
  loot: { label: 'Resolved Loot', short: 'Loot', color: '#22C55E' },
} as const;

export function gameStatus(i: ApiIssue): GameStatus {
  if (i.status === 'resolved') return 'loot';
  return tier(i) === 'Urgent' ? 'boss' : 'quest';
}

// ── mock enrichment ─────────────────────────────────────────────────────────────────────────
// AI confidence isn't in /api/issues yet (Gemini's analysis has it server-side). Until the API
// sends it, each issue gets a stable demo value from its id so the Field Quests queue has
// something to triage. Flagged in the UI as demo data.
const hash = (n: number) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
export const MOCK = {
  aiConfidence: (i: ApiIssue) => (i as ApiIssue & { confidence?: number }).confidence ?? Math.round((0.3 + hash(i.id) * 0.68) * 100) / 100,
};

/** true when the street address never resolved (empty, or only raw coordinates) */
export const missingAddress = (i: ApiIssue) => !i.address || /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(i.address.trim());

export const needsTriage = (i: ApiIssue, addr: Record<number, string>) =>
  i.status !== 'resolved' && (MOCK.aiConfidence(i) < 0.5 || (missingAddress(i) && !addr[i.id]));

export const district = (i: ApiIssue) => {
  const parts = i.address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : 'Unassigned';
};

/** 0–100. Open issues weigh by priority and how many residents they affect. */
export function healthScore(issues: ApiIssue[]) {
  const load = issues
    .filter((i) => i.status !== 'resolved')
    .reduce((s, i) => s + (i.priority / 100) * (1 + 0.15 * Math.min(i.reports, 5)), 0);
  return Math.round(100 * (1 - Math.min(1, load / 40)));
}
export const healthLabel = (s: number) => (s >= 85 ? 'Sparkling' : s >= 70 ? 'Tidy' : s >= 50 ? 'Scuffed' : 'Chaotic');

export const LEVELS = ['Pothole Patroller', 'Curb Captain', 'Ward Warden', 'Transit Titan', 'City Champion'];
export const level = (xp: number) => {
  const n = Math.floor(xp / 500);
  return { n: n + 1, title: LEVELS[Math.min(n, LEVELS.length - 1)], into: xp % 500, need: 500 };
};

export interface DistrictRow { name: string; xp: number; resolved: number; open: number }
export function leaderboard(issues: ApiIssue[]): DistrictRow[] {
  const m = new Map<string, DistrictRow>();
  for (const i of issues) {
    const d = district(i);
    const r = m.get(d) ?? { name: d, xp: 0, resolved: 0, open: 0 };
    if (i.status === 'resolved') { r.resolved++; r.xp += 120; }
    else { r.open++; r.xp += i.status === 'in_progress' ? 40 : i.status === 'assigned' ? 20 : 0; }
    m.set(d, r);
  }
  return [...m.values()].sort((a, b) => b.xp - a.xp || a.open - b.open).slice(0, 6);
}

/** Plain-language query over the record. Keyword matching for now, labelled as such; an
 *  /api/query route backed by Gemini can replace it without changing the UI. */
const SYN: Record<string, string[]> = {
  pothole: ['pothole', 'potholes', 'road', 'hole'],
  sidewalk: ['sidewalk', 'sidewalks', 'curb', 'slab'],
  streetlight: ['light', 'lights', 'streetlight', 'dark'],
  traffic: ['signal', 'sign', 'traffic'],
  bike_lane: ['bike', 'cycle', 'lane'],
  water: ['water', 'leak', 'main'],
  drainage: ['flood', 'drain', 'drainage'],
  waste: ['garbage', 'trash', 'waste', 'litter', 'bin'],
  graffiti: ['graffiti', 'tag', 'vandal'],
  tree: ['tree', 'park', 'branch'],
};
export function queryIssues(q: string, issues: ApiIssue[]) {
  const words = q.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 2);
  if (!words.length) return null;
  const cats = Object.entries(SYN).filter(([, ws]) => ws.some((w) => words.includes(w))).map(([c]) => c);
  const wantBoss = words.some((w) => ['boss', 'critical', 'urgent', 'worst'].includes(w));
  const wantLoot = words.some((w) => ['loot', 'resolved', 'fixed', 'done'].includes(w));
  const wantA11y = words.some((w) => ['accessibility', 'wheelchair', 'barrier', 'barriers'].includes(w));
  const places = words.filter((w) => !Object.values(SYN).flat().includes(w) && !['boss', 'critical', 'urgent', 'worst', 'loot', 'resolved', 'fixed', 'done', 'show', 'all', 'the', 'near', 'with', 'accessibility', 'wheelchair', 'barrier', 'barriers', 'open', 'quests', 'quest'].includes(w));
  return issues.filter((i) => {
    if (cats.length && !cats.includes(i.category)) return false;
    if (wantBoss && gameStatus(i) !== 'boss') return false;
    if (wantLoot && i.status !== 'resolved') return false;
    if (!wantLoot && words.includes('open') && i.status === 'resolved') return false;
    if (wantA11y && !i.accessibility.barrier) return false;
    if (places.length && !places.some((p) => i.address.toLowerCase().includes(p) || i.title.toLowerCase().includes(p))) return false;
    return true;
  });
}
