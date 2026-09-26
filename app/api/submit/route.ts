import { SESSION_ID, submitReport } from '@/lib/submit';

export const maxDuration = 60;

// The phone app's shutter press. POST JSON (photo as { data: base64, mime }) or multipart:
//   photo      the evidence (jpeg), captured in-app at shutter time
//   sessionId  idempotency key created at shutter time; retries reuse it
//   lat, lng, capturedAt
//   context    what was said in the live session before the shutter (optional)
//   answer     the resident's answer to a clarifying question (optional)
//   final      "1" to decide without asking again
// → ReportResponse: committed | clarify | rejected
export async function POST(req: Request) {
  const f = await readFields(req);
  if (!f.photo) return Response.json({ error: 'Take a photo of the problem.' }, { status: 400 });
  if (!SESSION_ID.test(f.sessionId)) return Response.json({ error: 'Missing report session.' }, { status: 400 });
  if (!isFinite(f.lat) || !isFinite(f.lng)) return Response.json({ error: 'Location is missing.' }, { status: 400 });
  const text = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 4000) : undefined);

  try {
    const res = await submitReport({
      sessionId: f.sessionId,
      photo: f.photo,
      lat: f.lat,
      lng: f.lng,
      capturedAt: f.capturedAt || Date.now(),
      context: text(f.context),
      answer: text(f.answer),
      final: f.final,
    });
    return Response.json(res);
  } catch (e) {
    console.error('submit failed', e);
    return Response.json({ error: 'I couldn’t file that one. Try again in a moment.' }, { status: 502 });
  }
}

/** The phone sends JSON with a base64 photo; the web form sends multipart. */
async function readFields(req: Request) {
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ph = j.photo as { data?: string; mime?: string } | undefined;
    return {
      photo: ph?.data ? { data: Buffer.from(ph.data, 'base64'), mime: ph.mime || 'image/jpeg' } : null,
      sessionId: String(j.sessionId ?? ''),
      lat: Number(j.lat),
      lng: Number(j.lng),
      capturedAt: Number(j.capturedAt),
      context: j.context,
      answer: j.answer,
      final: j.final === true || j.final === '1',
    };
  }
  const form = await req.formData();
  const photo = form.get('photo');
  return {
    photo: photo instanceof File ? { data: Buffer.from(await photo.arrayBuffer()), mime: photo.type || 'image/jpeg' } : null,
    sessionId: String(form.get('sessionId') ?? ''),
    lat: Number(form.get('lat')),
    lng: Number(form.get('lng')),
    capturedAt: Number(form.get('capturedAt')),
    context: form.get('context'),
    answer: form.get('answer'),
    final: form.get('final') === '1',
  };
}
