import type { CategoryId } from './categories';
import type { Issue } from './types';

// Service targets: how long each kind of problem may stay open before it's late. Modelled on
// Ottawa's published maintenance standards (hazards in hours, cosmetic work in days); the
// dashboard and Mamdani's briefings measure every open issue against them.
export const SLA_HOURS: Record<CategoryId, number> = {
  pothole: 96,
  sidewalk: 72,
  streetlight: 72,
  traffic: 24,
  bike_lane: 24,
  water: 24,
  drainage: 48,
  waste: 48,
  graffiti: 168,
  tree: 120,
  other: 120,
};

/** The target for this issue: safety-critical ones get half the time. */
export const slaHours = (i: Pick<Issue, 'category' | 'safetyRisk'>) => SLA_HOURS[i.category] * (i.safetyRisk >= 75 ? 0.5 : 1);

export type SlaState = 'met' | 'ok' | 'at_risk' | 'breached';

/** Where an issue stands against its target, and how many hours are left (negative = late). */
export function sla(i: Pick<Issue, 'category' | 'safetyRisk' | 'status' | 'firstReportedAt' | 'resolvedAt'>, now = Date.now()) {
  const target = slaHours(i);
  const end = i.status === 'resolved' && i.resolvedAt ? i.resolvedAt : now;
  const used = (end - i.firstReportedAt) / 3600e3;
  const left = target - used;
  const state: SlaState = i.status === 'resolved' ? (left >= 0 ? 'met' : 'breached') : left < 0 ? 'breached' : left < target * 0.25 ? 'at_risk' : 'ok';
  return { target, used, left, state };
}
