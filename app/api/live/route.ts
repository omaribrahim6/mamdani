import { mintLiveToken } from '@/lib/live';

// POST → a single-use Gemini Live token for the phone, plus the socket URL and session config.
// 503 when no Gemini key is configured: the app still reports, Mamdani just can't chat.
export async function POST() {
  try {
    const live = await mintLiveToken();
    if (!live) return Response.json({ error: 'Live conversation isn’t set up on this server.' }, { status: 503 });
    return Response.json(live, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('live token failed', e);
    return Response.json({ error: 'Couldn’t start a live session.' }, { status: 502 });
  }
}
