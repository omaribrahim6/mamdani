import {
  Bike,
  CircleHelp,
  Construction,
  Droplet,
  Footprints,
  Lightbulb,
  SprayCan,
  TrafficCone,
  Trash2,
  Trees,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { CATEGORIES, category, type CategoryId } from '@shared/categories';
import { STATUS_LABEL, type Issue, type Status } from '@shared/types';

export { CATEGORIES, category, STATUS_LABEL };

export const ICON: Record<CategoryId, LucideIcon> = {
  pothole: Construction,
  sidewalk: Footprints,
  streetlight: Lightbulb,
  traffic: TrafficCone,
  bike_lane: Bike,
  water: Droplet,
  drainage: Waves,
  waste: Trash2,
  graffiti: SprayCan,
  tree: Trees,
  other: CircleHelp,
};

export const STATUS_ORDER: Status[] = ['new', 'assigned', 'in_progress', 'resolved'];
export const STATUS_SHORT: Record<Status, string> = { new: 'Waiting', assigned: 'Crew assigned', in_progress: 'Being fixed', resolved: 'Fixed' };
export const NEXT_STATUS: Partial<Record<Status, { to: Status; verb: string }>> = {
  new: { to: 'assigned', verb: 'Assign crew' },
  assigned: { to: 'in_progress', verb: 'Start work' },
  in_progress: { to: 'resolved', verb: 'Mark fixed' },
};

const H = 3600e3;

export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function hours(h: number) {
  const a = Math.abs(h);
  if (a < 1) return `${Math.round(a * 60)}m`;
  if (a < 48) return `${Math.round(a)}h`;
  return `${Math.round(a / 24)}d`;
}

export const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
export const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
export const stamp = (ms: number) => new Date(ms).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

export const openIssues = (list: Issue[]) => list.filter((i) => i.status !== 'resolved');
export const ageHours = (i: Issue, now = Date.now()) => (now - i.firstReportedAt) / H;

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** The street part of an address, and the neighbourhood after it. */
export const street = (address: string) => address.split(',')[0];
export const hood = (address: string) => address.split(',').slice(1).join(',').trim();
