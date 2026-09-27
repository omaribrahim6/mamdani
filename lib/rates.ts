// Planning rates for work-plan estimates, in CAD per hour, "fully loaded" (wage plus benefits,
// overhead and supervision, which municipalities typically put at about 1.35-1.5x base wage).
// These are planning assumptions for triage, not City of Ottawa tender or collective-agreement
// figures: every estimate shows which rates it used, and they're meant to be replaced with the
// city's own numbers. Gemini only chooses roles, counts, hours and equipment; the arithmetic
// happens here.

export const RATES_NOTE =
  'Planning rates (CAD/h, fully loaded: wage + benefits + overhead). Assumptions for triage, not City tender rates.';

export const LABOUR = {
  labourer: { label: 'Road maintenance worker', rate: 62 },
  operator: { label: 'Equipment operator', rate: 72 },
  concrete: { label: 'Concrete finisher', rate: 78 },
  electrician: { label: 'Street lighting / signal technician', rate: 95 },
  arborist: { label: 'Forestry arborist', rate: 80 },
  water: { label: 'Water / sewer operator', rate: 75 },
  sanitation: { label: 'Solid waste / cleaning crew', rate: 58 },
  bylaw: { label: 'By-law officer', rate: 70 },
  inspector: { label: 'Inspector / technologist', rate: 82 },
  traffic_control: { label: 'Traffic control person', rate: 55 },
} as const;

export const EQUIPMENT = {
  pickup: { label: 'Pickup / service truck', rate: 35 },
  dump_truck: { label: 'Dump / crew truck', rate: 85 },
  patch_truck: { label: 'Asphalt hot box / patch truck', rate: 110 },
  bucket_truck: { label: 'Bucket truck', rate: 140 },
  mini_excavator: { label: 'Mini excavator', rate: 95 },
  vacuum_truck: { label: 'Vacuum / flusher truck', rate: 180 },
  sweeper: { label: 'Street sweeper', rate: 120 },
  arrow_board_truck: { label: 'Arrow board / attenuator truck', rate: 90 },
  chipper: { label: 'Wood chipper', rate: 60 },
  pressure_washer: { label: 'Hot-water pressure washer trailer', rate: 45 },
  concrete_saw: { label: 'Concrete saw', rate: 25 },
  plate_compactor: { label: 'Plate compactor', rate: 15 },
} as const;

export type LabourRole = keyof typeof LABOUR;
export type EquipmentKind = keyof typeof EQUIPMENT;

export const LABOUR_ROLES = Object.keys(LABOUR) as LabourRole[];
export const EQUIPMENT_KINDS = Object.keys(EQUIPMENT) as EquipmentKind[];

/** Contingency on the subtotal, and how much longer than planned the high end allows for. */
export const CONTINGENCY = 0.15;
export const OVERRUN = 0.5;

export interface CostLine {
  kind: 'labour' | 'equipment' | 'materials' | 'contingency';
  label: string;
  detail: string;
  low: number;
  high: number;
}

export interface CostInput {
  crew: Array<{ role: LabourRole; count: number; hours: number }>;
  equipment: Array<{ kind: EquipmentKind; hours: number }>;
  materials: Array<{ item: string; quantity: number; unit: string; unitCost: number }>;
}

const round = (n: number) => Math.round(n / 5) * 5;

/**
 * The cost range, line by line. Low: the plan as stated. High: time runs OVERRUN longer and the
 * contingency is spent. Materials use Gemini's unit-cost estimates and are labelled as such.
 */
export function costOf(input: CostInput) {
  const lines: CostLine[] = [];
  for (const c of input.crew) {
    const r = LABOUR[c.role];
    if (!r) continue;
    const low = c.count * c.hours * r.rate;
    lines.push({ kind: 'labour', label: r.label, detail: `${c.count} × ${c.hours} h × $${r.rate}/h`, low, high: low * (1 + OVERRUN) });
  }
  for (const e of input.equipment) {
    const r = EQUIPMENT[e.kind];
    if (!r) continue;
    const low = e.hours * r.rate;
    lines.push({ kind: 'equipment', label: r.label, detail: `${e.hours} h × $${r.rate}/h`, low, high: low * (1 + OVERRUN) });
  }
  for (const m of input.materials) {
    const low = m.quantity * m.unitCost;
    if (!low) continue;
    lines.push({ kind: 'materials', label: m.item, detail: `${m.quantity} ${m.unit} × ~$${m.unitCost} (estimated unit cost)`, low, high: low });
  }
  const sub = lines.reduce((s, l) => ({ low: s.low + l.low, high: s.high + l.high }), { low: 0, high: 0 });
  lines.push({ kind: 'contingency', label: 'Contingency', detail: `${Math.round(CONTINGENCY * 100)}% on the high end`, low: 0, high: sub.high * CONTINGENCY });
  return {
    lines: lines.map((l) => ({ ...l, low: Math.round(l.low), high: Math.round(l.high) })),
    low: round(sub.low),
    high: round(sub.high * (1 + CONTINGENCY)),
    labourHours: input.crew.reduce((s, c) => s + c.count * c.hours, 0),
  };
}
