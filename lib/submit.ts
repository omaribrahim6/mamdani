import { embedImage } from './ai';
import { analyze } from './analyze';
import { commitReport, type IntakeChecks } from './intake';
import { blurRegions, screenPhoto } from './screen';
import { store } from './store';
import type { Analysis, ReportDecision, ReportResponse, SubmitResult } from './types';

// The phone's shutter press, end to end. Phases, in order:
//   ANALYZE  one Gemini call over the frozen snapshot (photo + what was said) → one decision,
//            alongside a Flash-Lite screen (appropriate? faces/plates to blur) and the photo's
//            embedding (for finding the same problem again)
//   CLARIFY  if it can't tell which problem is meant, ask; nothing is written
//   COMMIT   exactly once per sessionId, however many times the request arrives
//
// The session id is created on the phone at shutter time. A retry, a double tap or a flaky network
// all arrive with the same id and get the same report back.

export const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface Snapshot {
  sessionId: string;
  photo: { data: Buffer; mime: string };
  lat: number;
  lng: number;
  capturedAt: number;
  context?: string;
  answer?: string;
  final?: boolean;
}

export async function submitReport(s: Snapshot): Promise<ReportResponse> {
  const done = await store.getSession(s.sessionId);
  if (done?.response) return done.response;
  if (done) return waitFor(s.sessionId);

  const [analysis, screen, embedding] = await Promise.all([
    analyze({ photo: s.photo, context: s.context, answer: s.answer, final: s.final }),
    screenPhoto(s.photo),
    embedImage(s.photo).catch((e) => {
      console.error('embedding failed', e);
      return null;
    }),
  ]);

  // nothing inappropriate is stored or shown to city staff
  if (!screen.appropriate) return { status: 'rejected', message: screen.reason, analysis };

  if (analysis.clarification?.needed && !s.final && !s.answer) {
    return { status: 'clarify', question: analysis.clarification.question, options: analysis.clarification.options };
  }
  if (!analysis.isCivicIssue) {
    return {
      status: 'rejected',
      message: 'I couldn’t quite tell what we’re looking at. Try another photo, closer to the problem.',
      analysis,
    };
  }

  if (!(await store.claimSession(s.sessionId))) return waitFor(s.sessionId);
  try {
    const { result, checks } = await commitReport({
      analysis,
      photo: blurRegions(s.photo, screen.blur),
      lat: s.lat,
      lng: s.lng,
      transcript: s.context,
      embedding,
      blurred: screen.blur.length,
    });
    const response: ReportResponse = { status: 'committed', decision: decide(s.sessionId, analysis, result, checks), analysis, result };
    await store.completeSession(s.sessionId, result.issue.id, response);
    return response;
  } catch (e) {
    await store.releaseSession(s.sessionId);
    throw e;
  }
}

/** Another request is committing this session right now: hand back its result when it lands. */
async function waitFor(id: string): Promise<ReportResponse> {
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await store.getSession(id);
    if (s?.response) return s.response;
    if (!s) break; // the other attempt failed and released it
  }
  throw new Error('The report is still being filed. Try again in a moment.');
}

function decide(sessionId: string, a: Analysis, r: SubmitResult, checks: IntakeChecks): ReportDecision {
  const { issue } = r;
  return {
    reportId: `report_${issue.id}`,
    sessionId,
    issue: {
      id: issue.id,
      type: issue.category,
      title: a.title,
      summary: a.summary,
      severity: issue.severity,
      safetyRisk: issue.safetyRisk,
      accessibilityImpact: issue.accessibility.impact,
      department: issue.department,
      address: issue.address,
      status: issue.status,
      duplicateCount: issue.reports,
      duplicate: r.duplicate,
      box: a.box,
    },
    character: a.character!,
    confidence: a.confidence,
    engine: a.engine,
    checks: { screened: true, ...checks },
  };
}
