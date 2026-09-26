import type { Content, FunctionCall, Part } from '@google/genai';
import { embedText, genai, MODELS } from '../ai';
import { CATEGORY_IDS } from '../categories';
import { store } from '../store';
import type { Status } from '../types';
import { detail, ottawaNow, overview, query, row, type IssueQuery } from './record';
import { research, type Source } from './research';

// Ask Mamdani: the dashboard's assistant. Gemini answers city staff from the city's own record
// (Tiger Data, through the tools below) and from Google Search when the question is about the
// outside world. It can point at things on the map and propose changes, but a person confirms
// every change in the UI: the assistant never writes to the record itself.

export type AgentEvent =
  | { type: 'tool'; name: string; label: string }
  | { type: 'text'; delta: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'issues'; ids: number[] }
  | { type: 'map'; ids: number[]; label: string }
  | { type: 'route'; ids: number[]; label: string }
  | { type: 'action'; ids: number[]; status: Status; note: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskContext {
  page?: string;
  selectedIssueId?: number | null;
}

const STATUS_ENUM = ['open', 'new', 'assigned', 'in_progress', 'resolved'];

const TOOLS = [
  {
    name: 'query_issues',
    description:
      'Search the live issue record (every deduplicated problem residents reported). Filter and sort, get matching rows plus counts. Use for any question about what is open, where, how many, which are late, etc.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        status: { type: 'array', items: { type: 'string', enum: STATUS_ENUM }, description: '"open" = anything not resolved' },
        category: { type: 'array', items: { type: 'string', enum: CATEGORY_IDS } },
        department: { type: 'string', description: 'substring of the department name, e.g. "Roads", "Water", "Parks"' },
        minPriority: { type: 'number', description: '0-100 priority score' },
        accessibility: { type: 'string', enum: ['any_barrier', 'critical'] },
        serviceTarget: { type: 'string', enum: ['breached', 'at_risk', 'late_or_at_risk'], description: 'measured against the service target (SLA)' },
        text: { type: 'string', description: 'keywords matched against title, summary, address and hazards' },
        near: {
          type: 'object',
          description: 'a circle around a point in Ottawa (estimate coordinates for named places)',
          properties: { lat: { type: 'number' }, lng: { type: 'number' }, radiusM: { type: 'number' } },
          required: ['lat', 'lng', 'radiusM'],
        },
        sinceHours: { type: 'number', description: 'first reported within the last N hours' },
        sort: { type: 'string', enum: ['priority', 'newest', 'oldest', 'reports', 'severity'] },
        limit: { type: 'number', description: 'max rows, default 12, max 25' },
      },
    },
  },
  {
    name: 'get_issue',
    description: 'Everything about one work order: summary, hazards, accessibility notes, priority breakdown, history, and what residents said.',
    parametersJsonSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  {
    name: 'city_overview',
    description:
      'Citywide numbers right now: open issues by status/type/department, resident reports in the last 24h vs the 24h before, service-target breaches, median time to fix, oldest open, top priorities.',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'find_similar',
    description:
      'Semantic search over the evidence photos with Gemini embeddings in Tiger Data (pgvector). Describe what something looks like ("water pooling across a crosswalk") and get the issues whose photos match best.',
    parametersJsonSchema: {
      type: 'object',
      properties: { description: { type: 'string' }, limit: { type: 'number' } },
      required: ['description'],
    },
  },
  {
    name: 'research',
    description:
      'Google Search grounded research for facts outside the city record: weather forecasts, Ottawa/Ontario maintenance standards and by-laws, typical repair costs, best practices, news. Returns an answer with sources.',
    parametersJsonSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
  {
    name: 'show_on_map',
    description: 'Highlight work orders on the dashboard map and fly to them. Use whenever location matters to the answer.',
    parametersJsonSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'number' } }, label: { type: 'string', description: 'what these are, 2-5 words' } },
      required: ['ids', 'label'],
    },
  },
  {
    name: 'plan_route',
    description: 'Plan a crew route that visits these work orders in the best order; the dashboard draws it on the map with drive time.',
    parametersJsonSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'number' } }, label: { type: 'string' } },
      required: ['ids', 'label'],
    },
  },
  {
    name: 'propose_status_change',
    description:
      'Propose moving work orders to a new status (assign a crew, start work, mark fixed). The staff member sees a confirm button; nothing changes until they press it.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'number' } },
        status: { type: 'string', enum: ['new', 'assigned', 'in_progress', 'resolved'] },
        note: { type: 'string', description: 'the note that goes on each work order history' },
      },
      required: ['ids', 'status', 'note'],
    },
  },
];

const LABEL: Record<string, string> = {
  query_issues: 'Searched the city record',
  get_issue: 'Opened the work order',
  city_overview: 'Pulled citywide numbers',
  find_similar: 'Searched evidence photos (pgvector)',
  research: 'Researched with Google Search',
  show_on_map: 'Marked the map',
  plan_route: 'Planned a crew route',
  propose_status_change: 'Drafted a change for you to confirm',
};

function system(ctx: AskContext) {
  return `You are Mamdani: the little hard-hatted inspector who lives in the corner of the City of Ottawa's Mamdani Command dashboard. You talk with city staff (supervisors, engineers, dispatchers, councillor offices) about the issues residents report through the Mamdani app.

Now: ${ottawaNow()} (Ottawa time). The staff member is on the "${ctx.page ?? 'command'}" page${ctx.selectedIssueId ? ` with work order #${ctx.selectedIssueId} open` : ''}.

Ground rules:
- Every fact about the city comes from your tools. Never invent a number, address, status or work order. If the record doesn't say, say so.
- Refer to work orders as #1234 (the dashboard turns these into links). Mention addresses so people can picture them.
- Use research for the outside world (weather, standards, by-laws, costs) and say it came from the web.
- When location matters, call show_on_map. When they want a crew run, call plan_route. When they want something changed, call propose_status_change — they confirm it; you never claim it's done.
- Staff are busy: lead with the answer. Short markdown: a sentence or two, then bullets or a small table (max 8 rows). Bold the key numbers.
- Personality: warm, brisk, proudly municipal. At most one light joke per answer, never at a resident's expense. You love a well-filled pothole.`;
}

async function run(name: string, args: Record<string, unknown>, emit: (e: AgentEvent) => void): Promise<unknown> {
  switch (name) {
    case 'query_issues': {
      const r = await query(args as IssueQuery);
      if (r.ids.length) emit({ type: 'issues', ids: r.ids });
      const { ids: _ids, ...rest } = r;
      return rest;
    }
    case 'get_issue': {
      const d = await detail(Number(args.id));
      if (d) emit({ type: 'issues', ids: [d.id] });
      return d ?? { error: `There is no work order #${args.id}.` };
    }
    case 'city_overview':
      return overview();
    case 'find_similar': {
      const v = await embedText(String(args.description));
      if (!v) return { error: 'Photo search needs the Vertex service account.' };
      const hits = await store.similar(v, Math.min(10, Number(args.limit) || 6));
      emit({ type: 'issues', ids: hits.map((h) => h.issue.id) });
      return { matches: hits.map((h) => ({ similarity: +h.similarity.toFixed(3), ...row(h.issue) })) };
    }
    case 'research': {
      const r = await research(String(args.question));
      if (r.sources.length) emit({ type: 'sources', sources: r.sources });
      return r;
    }
    case 'show_on_map':
      emit({ type: 'map', ids: (args.ids as number[]) ?? [], label: String(args.label ?? '') });
      return { shown: true };
    case 'plan_route':
      emit({ type: 'route', ids: (args.ids as number[]) ?? [], label: String(args.label ?? '') });
      return { planned: true, note: 'The dashboard is drawing the route and drive time on the map.' };
    case 'propose_status_change':
      emit({ type: 'action', ids: (args.ids as number[]) ?? [], status: args.status as Status, note: String(args.note ?? '') });
      return { proposed: true, note: 'Waiting for the staff member to confirm in the dashboard.' };
    default:
      return { error: `unknown tool ${name}` };
  }
}

/** One question → streamed events. Tool calls loop until Gemini answers in words. */
export async function ask(history: ChatTurn[], ctx: AskContext, emit: (e: AgentEvent) => void) {
  const ai = genai();
  if (!ai) {
    emit({ type: 'text', delta: "I can't think without Gemini: this server has no Vertex AI credentials configured." });
    emit({ type: 'done' });
    return;
  }
  const contents: Content[] = history.slice(-12).map((t) => ({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text: t.text }] }));
  for (let step = 0; step < 6; step++) {
    const stream = await ai.models.generateContentStream({
      model: process.env.GEMINI_AGENT_MODEL || MODELS.decide(),
      contents,
      config: { systemInstruction: system(ctx), tools: [{ functionDeclarations: TOOLS }], temperature: 0.4 },
    });
    const parts: Part[] = [];
    const calls: FunctionCall[] = [];
    for await (const chunk of stream) {
      for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
        parts.push(p);
        if (p.functionCall) calls.push(p.functionCall);
        else if (p.text && !p.thought) emit({ type: 'text', delta: p.text });
      }
    }
    contents.push({ role: 'model', parts });
    if (!calls.length) break;
    const responses: Part[] = [];
    for (const c of calls) {
      emit({ type: 'tool', name: c.name ?? '', label: LABEL[c.name ?? ''] ?? c.name ?? '' });
      let result: unknown;
      try {
        result = await run(c.name ?? '', (c.args ?? {}) as Record<string, unknown>, emit);
      } catch (e) {
        result = { error: String(e) };
      }
      responses.push({ functionResponse: { id: c.id, name: c.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  emit({ type: 'done' });
}
