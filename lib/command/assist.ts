import { hasAI, json, MODELS } from '../ai';
import { costOf, EQUIPMENT, EQUIPMENT_KINDS, LABOUR, LABOUR_ROLES, RATES_NOTE, type CostLine, type EquipmentKind, type LabourRole } from '../rates';
import { store } from '../store';
import { detail } from './record';
import { research, type Source } from './research';

// A work plan for one issue. Gemini decides the job (who, how many, how long, what equipment
// and materials, the steps) from the record; the cost is computed from the planning rates in
// lib/rates.ts, line by line, so every dollar can be traced. What happens if it waits, and why
// fixing it now pays off, are grounded in Google Search: a dollar figure only survives if a
// cited source contains it.

export interface WorkPlan {
  issueId: number;
  generatedAt: number;
  crew: Array<{ role: LabourRole; label: string; count: number; hours: number }>;
  equipment: Array<{ kind: EquipmentKind; label: string; hours: number }>;
  materials: Array<{ item: string; quantity: number; unit: string; unitCost: number }>;
  cost: { low: number; high: number; currency: 'CAD'; lines: CostLine[]; labourHours: number; basis: string };
  steps: string[];
  trafficControl: string;
  riskIfDelayed: string;
  roi: string;
  sources: Source[];
  residentUpdate: string;
}

type Drafted = Pick<WorkPlan, 'steps' | 'trafficControl' | 'riskIfDelayed' | 'roi' | 'residentUpdate'> & {
  crew: Array<{ role: LabourRole; count: number; hours: number }>;
  equipment: Array<{ kind: EquipmentKind; hours: number }>;
  materials: WorkPlan['materials'];
};

const SCHEMA = {
  type: 'object',
  properties: {
    crew: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: LABOUR_ROLES },
          count: { type: 'number', minimum: 1, maximum: 8 },
          hours: { type: 'number', minimum: 0.25, maximum: 40, description: 'hours on this job for each person, including travel to site' },
        },
        required: ['role', 'count', 'hours'],
      },
    },
    equipment: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: EQUIPMENT_KINDS }, hours: { type: 'number', minimum: 0.25, maximum: 40 } },
        required: ['kind', 'hours'],
      },
    },
    materials: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          item: { type: 'string' },
          quantity: { type: 'number', minimum: 0 },
          unit: { type: 'string', description: 'e.g. tonne, m³, each, L' },
          unitCost: { type: 'number', minimum: 0, description: 'typical Ontario municipal purchase price per unit, CAD' },
        },
        required: ['item', 'quantity', 'unit', 'unitCost'],
      },
    },
    steps: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    trafficControl: { type: 'string' },
    riskIfDelayed: {
      type: 'string',
      description: 'what gets worse if this waits a month, in words. Only include a dollar amount if it appears in the RESEARCH, and name where it comes from.',
    },
    roi: {
      type: 'string',
      description: 'one or two sentences: why fixing now pays off (safety, liability, access, cheaper repair). Only include a dollar amount if it appears in the RESEARCH.',
    },
    residentUpdate: { type: 'string', description: 'a friendly 2-sentence status update for the residents who reported it, plain language' },
  },
  required: ['crew', 'equipment', 'materials', 'steps', 'trafficControl', 'riskIfDelayed', 'roi', 'residentUpdate'],
};

/** Every dollar amount in a piece of text, as plain digit strings ("$1,500" → "1500"). */
const dollars = (t: string) => [...t.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?([kKmM])?/g)].map((m) => m[1].replace(/,/g, '') + (m[2] ?? '').toLowerCase());

/** Drop sentences that carry a dollar figure the research doesn't contain. */
function onlySourced(text: string, evidence: string) {
  const known = new Set(dollars(evidence));
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => dollars(s).every((d) => known.has(d)));
  return kept.join(' ').trim();
}

const mem = new Map<string, WorkPlan>();

export async function workPlan(id: number): Promise<WorkPlan | null> {
  const d = await detail(id);
  if (!d) return null;
  const key = `plan:v3:${id}:${d.status}:${d.residentReports}`;
  const hit = mem.get(key) ?? (await store.cacheGet<WorkPlan>(key).catch(() => null));
  if (hit) return hit;
  if (!hasAI()) return null;

  const found = await research(
    `For this municipal issue in Ottawa, Ontario: "${d.type}: ${d.title}. ${d.summary}". What typically happens if it is left unrepaired for weeks (deterioration, safety, liability, accessibility), and are there published figures on the cost of delaying this kind of repair versus fixing it early? Only cite real published numbers.`,
  ).catch(() => ({ answer: '', sources: [] as Source[] }));

  // figures only count as backed when Google actually returned sources for them
  const evidence = found.sources.length ? found.answer : '';

  const r = await json<Drafted>(
    MODELS.decide(),
    [
      {
        text: `You are a City of Ottawa infrastructure planner triaging a work order. Decide the job: which roles (only from the list), how many people, hours each, equipment and hours, materials with quantities and a typical unit cost, and the steps. Be practical and specific; size it for this exact issue, not a generic one. Do not estimate the total cost — it's calculated from the city's planning rates.

ROLES: ${LABOUR_ROLES.map((r) => `${r} (${LABOUR[r].label})`).join(', ')}
EQUIPMENT: ${EQUIPMENT_KINDS.join(', ')}

RESEARCH (Google Search; the only allowed source of dollar figures in riskIfDelayed and roi):
${evidence || 'none found (so no dollar figures in riskIfDelayed or roi)'}

WORK ORDER:
${JSON.stringify(d, null, 1)}`,
      },
    ],
    SCHEMA,
    0.3,
  );

  const crew = r.crew.filter((c) => LABOUR[c.role]).map((c) => ({ ...c, label: LABOUR[c.role].label }));
  const equipment = r.equipment.filter((e) => EQUIPMENT[e.kind]).map((e) => ({ ...e, label: EQUIPMENT[e.kind].label }));
  const cost = costOf({ crew, equipment, materials: r.materials });
  const plan: WorkPlan = {
    issueId: id,
    generatedAt: Date.now(),
    crew,
    equipment,
    materials: r.materials,
    cost: { low: cost.low, high: cost.high, currency: 'CAD', lines: cost.lines, labourHours: cost.labourHours, basis: RATES_NOTE },
    steps: r.steps,
    trafficControl: r.trafficControl,
    riskIfDelayed: onlySourced(r.riskIfDelayed, evidence) || 'Left alone, it keeps getting worse and keeps affecting the people who use this street.',
    roi: onlySourced(r.roi, evidence) || 'Fixing it now is the cheaper, safer repair.',
    sources: found.sources,
    residentUpdate: r.residentUpdate,
  };
  mem.set(key, plan);
  await store.cacheSet(key, plan).catch(() => {});
  return plan;
}
