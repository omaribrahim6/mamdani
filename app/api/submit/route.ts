import { SESSION_ID, submitReport } from '@/lib/submit';

export const maxDuration = 60;

// The phone app's shutter press. POST multipart:
//   photo      the evidence (jpeg), captured in-app at shutter time
//   sessionId  idempotency key created at shutter time; retries reuse it
//   lat, lng, capturedAt
//   context    what was said in the live session before the shutter (optional)
//   answer     the resident's answer to a clarifying question (optional)
//   final      "1" to decide without asking again
// → ReportResponse: committed | clarify | rejected
export async function POST(req: Request) {
  const form = await req.formData();
  const photo = form.get('photo');
  if (!(photo instanceof File)) return Response.json({ error: 'Take a photo of the problem.' }, { status: 400 });
  const sessionId = String(form.get('sessionId') ?? '');
  if (!SESSION_ID.test(sessionId)) return Response.json({ error: 'Missing report session.' }, { status: 400 });
  const lat = Number(form.get('lat'));
  const lng = Number(form.get('lng'));
  if (!isFinite(lat) || !isFinite(lng)) return Response.json({ error: 'Location is missing.' }, { status: 400 });
  const text = (k: string) => String(form.get(k) ?? '').slice(0, 4000) || undefined;

  try {
    const res = await submitReport({
      sessionId,
      photo: { data: Buffer.from(await photo.arrayBuffer()), mime: photo.type || 'image/jpeg' },
      lat,
      lng,
      capturedAt: Number(form.get('capturedAt')) || Date.now(),
      context: text('context'),
      answer: text('answer'),
      final: form.get('final') === '1',
    });
    return Response.json(res);
  } catch (e) {
    console.error('submit failed', e);
    return Response.json({ error: 'I couldn’t file that one. Try again in a moment.' }, { status: 502 });
  }
}
