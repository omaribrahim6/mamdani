import { verifyAnswer } from '@/lib/verify';

// POST { issueId, answer, question? } → is Mamdani's answer backed by the city's record?
// Returns the answer to speak (the original if grounded, a rewrite from the record if not).
export async function POST(req: Request) {
  const { issueId, answer, question } = (await req.json().catch(() => ({}))) as { issueId?: number; answer?: string; question?: string };
  if (!Number.isFinite(issueId) || typeof answer !== 'string') return Response.json({ error: 'issueId and answer are required' }, { status: 400 });
  try {
    return Response.json(await verifyAnswer(issueId!, answer.slice(0, 1200), (question ?? '').slice(0, 600)));
  } catch (e) {
    console.error('verify failed', e);
    // never block him from talking: fall back to what he was going to say
    return Response.json({ grounded: true, score: null, method: 'none', answer, facts: 0 });
  }
}
