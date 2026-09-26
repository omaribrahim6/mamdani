import { hasAI, json, MODELS } from '../ai';
import { detail } from './record';

// A work plan for one issue, written by Gemini from the record: what the crew brings, how long
// it takes, a cost range, and the update residents get. Labelled as an estimate everywhere.

export interface WorkPlan {
  issueId: number;
  generatedAt: number;
  crew: { size: number; hours: number; trade: string };
  cost: { low: number; high: number; currency: 'CAD'; basis: string };
  materials: string[];
  equipment: string[];
  steps: string[];
  trafficControl: string;
  riskIfDelayed: string;
  roi: string;
  residentUpdate: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    crew: {
      type: 'object',
      properties: { size: { type: 'number' }, hours: { type: 'number' }, trade: { type: 'string' } },
      required: ['size', 'hours', 'trade'],
    },
    cost: {
      type: 'object',
      properties: { low: { type: 'number' }, high: { type: 'number' }, basis: { type: 'string', description: 'one line: what the range covers' } },
      required: ['low', 'high', 'basis'],
    },
    materials: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    equipment: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    steps: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    trafficControl: { type: 'string' },
    riskIfDelayed: { type: 'string', description: 'what gets worse and roughly what it costs if this waits a month' },
    roi: { type: 'string', description: 'one sentence: why fixing now pays off (claims, damage, access), with a rough number' },
    residentUpdate: { type: 'string', description: 'a friendly 2-sentence status update for the residents who reported it, plain language' },
  },
  required: ['crew', 'cost', 'materials', 'equipment', 'steps', 'trafficControl', 'riskIfDelayed', 'roi', 'residentUpdate'],
};

const cache = new Map<string, WorkPlan>();

export async function workPlan(id: number): Promise<WorkPlan | null> {
  const d = await detail(id);
  if (!d) return null;
  const key = `${id}:${d.status}:${d.residentReports}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!hasAI()) return null;
  const r = await json<Omit<WorkPlan, 'issueId' | 'generatedAt'>>(
    MODELS.decide(),
    [
      {
        text: `You are a City of Ottawa infrastructure planner. Write a realistic work plan for this work order, using typical 2026 Ontario municipal crew rates and material costs (CAD). Be specific and practical; it is an estimate for triage, not a quote.\n\nWORK ORDER:\n${JSON.stringify(d, null, 1)}`,
      },
    ],
    SCHEMA,
    0.3,
  );
  const plan: WorkPlan = { ...r, cost: { ...r.cost, currency: 'CAD' }, issueId: id, generatedAt: Date.now() };
  cache.set(key, plan);
  return plan;
}
