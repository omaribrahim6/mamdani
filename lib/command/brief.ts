import { hasAI, json, MODELS } from '../ai';
import { overview } from './record';
import { research, type Source } from './research';

// Mamdani's daily brief: the morning memo a supervisor reads before assigning crews. Numbers
// come from the record; the outside world (weather, events) from Google Search; Gemini writes
// the judgement calls — what matters today, which crews go where, what to watch.

export interface Brief {
  generatedAt: number;
  model: string;
  headline: string;
  greeting: string;
  summary: string;
  priorities: Array<{ issueId: number; why: string; action: string }>;
  watchlist: Array<{ kind: 'weather' | 'trend' | 'equity' | 'backlog' | 'event'; title: string; detail: string }>;
  crewPlan: Array<{ department: string; focus: string; issueIds: number[] }>;
  outlook: { expectedReports: number; reasoning: string };
  signoff: string;
  conditions: { answer: string; sources: Source[] };
  numbers: Awaited<ReturnType<typeof overview>>;
}

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'the one-line state of the city today, max 10 words, no emoji' },
    greeting: { type: 'string', description: "Mamdani's opening line to the supervisor, one sentence, warm and a little funny" },
    summary: { type: 'string', description: '2-3 sentences: what changed, what matters most, what to do first' },
    priorities: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: { issueId: { type: 'number' }, why: { type: 'string' }, action: { type: 'string' } },
        required: ['issueId', 'why', 'action'],
      },
    },
    watchlist: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['weather', 'trend', 'equity', 'backlog', 'event'] },
          title: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['kind', 'title', 'detail'],
      },
    },
    crewPlan: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: { department: { type: 'string' }, focus: { type: 'string' }, issueIds: { type: 'array', items: { type: 'number' } } },
        required: ['department', 'focus', 'issueIds'],
      },
    },
    outlook: {
      type: 'object',
      properties: { expectedReports: { type: 'number' }, reasoning: { type: 'string' } },
      required: ['expectedReports', 'reasoning'],
    },
    signoff: { type: 'string', description: 'one short closing line in Mamdani\'s voice' },
  },
  required: ['headline', 'greeting', 'summary', 'priorities', 'watchlist', 'crewPlan', 'outlook', 'signoff'],
};

let cache: { at: number; brief: Brief } | null = null;
let pending: Promise<Brief> | null = null;

export async function brief(refresh = false): Promise<Brief> {
  if (!refresh && cache && Date.now() - cache.at < 20 * 60e3) return cache.brief;
  return (pending ??= build().finally(() => (pending = null)));
}

async function build(): Promise<Brief> {
  const numbers = await overview();
  const conditions = hasAI()
    ? await research(
        'Ottawa weather for the next 48 hours (temperatures, precipitation, freeze-thaw) and any events, closures or conditions that would affect road, sidewalk, water or waste operations.',
      ).catch(() => ({ answer: '', sources: [] }))
    : { answer: '', sources: [] };
  if (!hasAI()) {
    const b: Brief = {
      generatedAt: Date.now(),
      model: 'demo',
      headline: `${numbers.openIssues} open issues across the city`,
      greeting: 'Morning! No Gemini on this server, so this brief is just the numbers.',
      summary: `${numbers.newLast24h} new issues in the last day; ${numbers.serviceTargets.breached} past their service target.`,
      priorities: numbers.topPriorities.slice(0, 5).map((r) => ({ issueId: r.id, why: `Priority ${r.priority}`, action: 'Review' })),
      watchlist: [],
      crewPlan: [],
      outlook: { expectedReports: numbers.residentReportsLast24h, reasoning: 'Same as the last 24 hours.' },
      signoff: 'Go fix something.',
      conditions,
      numbers,
    };
    return (cache = { at: Date.now(), brief: b }).brief;
  }
  const r = await json<Omit<Brief, 'generatedAt' | 'model' | 'conditions' | 'numbers'>>(
    MODELS.decide(),
    [
      {
        text: `You are Mamdani, the City of Ottawa's operations inspector, writing today's brief for the operations supervisor.

THE CITY RECORD (source of truth; cite work orders by issueId, never invent one):
${JSON.stringify(numbers, null, 1)}

CONDITIONS FROM THE WEB (Google Search):
${conditions.answer || 'unavailable'}

Write the brief:
- priorities: the up-to-5 work orders to act on first today, each with why (grounded in severity, safety, accessibility, resident reports, service target) and a concrete action.
- watchlist: weather impacts on specific infrastructure, report-volume trends, accessibility/equity concerns, backlog risks.
- crewPlan: which department does what, naming the issueIds to batch together (nearby ones in one run).
- outlook.expectedReports: your estimate of resident reports in the next 24 hours, from the last two days and the conditions.
Plain, specific, municipal. Numbers must match the record.`,
      },
    ],
    SCHEMA,
    0.35,
  );
  const known = new Set([...numbers.topPriorities, ...numbers.oldestOpen].map((i) => i.id));
  const b: Brief = {
    ...r,
    priorities: r.priorities.filter((p) => known.has(p.issueId)),
    generatedAt: Date.now(),
    model: MODELS.decide(),
    conditions,
    numbers,
  };
  cache = { at: Date.now(), brief: b };
  return b;
}
