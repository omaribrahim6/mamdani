import { hasAI, json, MODELS } from './ai';
import { category } from './categories';
import { accessToken, project, serviceAccount } from './google';
import { store } from './store';
import { STATUS_LABEL, type Issue } from './types';

// The city's record is the source of truth. After a report is filed, whatever Mamdani says about
// it in conversation is checked against the issue as it stands in Tiger Data before he says it:
//   1. Vertex AI Check Grounding — every factual claim must be supported by a fact from the record
//      (pleasantries have no claims, so they pass untouched)
//   2. if that API isn't enabled on the project, Flash-Lite judges the same question
// An unsupported answer is replaced by one written from the record alone.

export interface Verdict {
  grounded: boolean;
  score: number | null;
  method: 'check-grounding' | 'flash-lite' | 'none';
  /** what Mamdani should actually say */
  answer: string;
  facts: number;
}

const date = (ms: number) => new Date(ms).toLocaleString('en-CA', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const severityWord = (n: number) => (n >= 75 ? 'high' : n >= 45 ? 'medium' : 'low');

/** The issue, as short standalone facts. */
export function factsFor(i: Issue): string[] {
  const facts = [
    `Work order ${i.id} is a ${category(i.category).label.toLowerCase()}: ${i.title}. It is at ${i.address}.`,
    `What the crew will read: ${i.summary}`,
    `Severity is ${i.severity} out of 100, which is ${severityWord(i.severity)} severity. Safety risk is ${i.safetyRisk} out of 100.`,
    `Accessibility impact is ${i.accessibility.impact}.${i.accessibility.notes.length ? ' ' + i.accessibility.notes.join(' ') : ''}`,
    `It was sent to ${i.department}. Its current status is: ${STATUS_LABEL[i.status]}.`,
    `${i.reports} resident report${i.reports === 1 ? '' : 's'} of this same problem have been filed. It was first reported ${date(i.firstReportedAt)} and last reported ${date(i.lastReportedAt)}.`,
    `It is ranked by a priority score of ${Math.round(i.priority)}, built from severity, safety risk, accessibility, how many residents reported it, and how long it has been open.`,
    'What happens next: the department reviews the report, assigns a crew, the crew fixes it, and the resident can follow each step in My reports in the app.',
  ];
  if (i.hazards.length) facts.push(`Hazards noted: ${i.hazards.join(', ')}.`);
  for (const e of i.events.slice(-6)) facts.push(`${date(e.at)}: ${e.note}.`);
  return facts;
}

let groundingOff = 0; // Discovery Engine not enabled: don't keep asking for a while

async function checkGrounding(answer: string, facts: string[]) {
  if (!serviceAccount() || Date.now() < groundingOff) return null;
  const r = await fetch(
    `https://discoveryengine.googleapis.com/v1/projects/${project()}/locations/global/groundingConfigs/default_grounding_config:check`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', 'x-goog-user-project': project() },
      body: JSON.stringify({
        answerCandidate: answer,
        facts: facts.map((factText) => ({ factText })),
        groundingSpec: { citationThreshold: 0.6 },
      }),
    },
  );
  if (r.status === 403) {
    groundingOff = Date.now() + 10 * 60e3;
    return null;
  }
  if (!r.ok) throw new Error(`check grounding ${r.status}`);
  const j = (await r.json()) as {
    supportScore?: number;
    claims?: Array<{ claimText?: string; citationIndices?: number[]; groundingCheckRequired?: boolean }>;
  };
  const checked = (j.claims ?? []).filter((c) => c.groundingCheckRequired !== false);
  const grounded = checked.every((c) => (c.citationIndices ?? []).length > 0);
  return { grounded, score: j.supportScore ?? (checked.length ? 0 : 1) };
}

async function judge(answer: string, facts: string[]) {
  const r = await json<{ makesClaims: boolean; supported: boolean; score: number }>(
    MODELS.lite(),
    [
      {
        text: `FACTS (the city's record, the only source of truth):\n${facts.map((f, k) => `${k + 1}. ${f}`).join('\n')}\n\nANSWER a character said about this report:\n"${answer}"\n\nDoes the answer make factual claims about the report, the problem or the city's handling of it? If so, is every such claim supported by the FACTS? Score the fraction of claims supported (1 if it makes none).`,
      },
    ],
    {
      type: 'object',
      properties: { makesClaims: { type: 'boolean' }, supported: { type: 'boolean' }, score: { type: 'number', minimum: 0, maximum: 1 } },
      required: ['makesClaims', 'supported', 'score'],
    },
    0,
  );
  return { grounded: !r.makesClaims || r.supported, score: r.makesClaims ? r.score : 1 };
}

async function rewrite(question: string, answer: string, facts: string[]) {
  const r = await json<{ answer: string }>(
    MODELS.lite(),
    [
      {
        text: `You are Mamdani, a tiny friendly city inspector. Your earlier reply went beyond the city's record, so say it again using ONLY these facts. One or two short spoken sentences, warm and casual. If the facts don't answer it, say you don't have that in the report.\n\nFACTS:\n${facts.join('\n')}\n\n${question ? `The resident asked: "${question}"\n` : ''}Your earlier reply: "${answer}"`,
      },
    ],
    { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    0.3,
  );
  return r.answer;
}

export async function verifyAnswer(issueId: number, answer: string, question = ''): Promise<Verdict> {
  const found = await store.getIssue(issueId);
  if (!found || !answer.trim()) return { grounded: true, score: null, method: 'none', answer, facts: 0 };
  const facts = factsFor(found.issue);
  let v: { grounded: boolean; score: number } | null = null;
  let method: Verdict['method'] = 'none';
  try {
    v = await checkGrounding(answer, facts);
    if (v) method = 'check-grounding';
  } catch (e) {
    console.error('check grounding failed', e);
  }
  if (!v && hasAI()) {
    v = await judge(answer, facts);
    method = 'flash-lite';
  }
  if (!v || v.grounded) return { grounded: true, score: v?.score ?? null, method, answer, facts: facts.length };
  return { grounded: false, score: v.score, method, answer: await rewrite(question, answer, facts), facts: facts.length };
}
