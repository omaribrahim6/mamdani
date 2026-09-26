import type { Issue, PriorityParts } from './types';

// One explainable number per issue. Each part is shown in the Command Center so a
// supervisor can see *why* something is at the top of the queue.
export function priorityOf(i: Pick<Issue, 'severity' | 'safetyRisk' | 'accessibility' | 'reports' | 'firstReportedAt' | 'status'>, now = Date.now()) {
  const parts: PriorityParts = {
    severity: Math.round(i.severity * 0.45),
    safety: Math.round(i.safetyRisk * 0.2),
    accessibility: { none: 0, low: 3, moderate: 8, critical: 15 }[i.accessibility.impact],
    // 1 report = 0, 2 = 5, 4 = 10, 8+ = 15
    confirmations: Math.min(15, Math.round(Math.log2(Math.max(1, i.reports)) * 5)),
    // open issues slowly rise: +1 per 6h, capped
    age: i.status === 'resolved' ? 0 : Math.min(8, Math.floor((now - i.firstReportedAt) / (6 * 3600e3))),
  };
  const total = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0));
  return { total: i.status === 'resolved' ? 0 : total, parts };
}

export const metersBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
