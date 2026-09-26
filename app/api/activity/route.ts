import { store } from '@/lib/store';

// GET /api/activity?days=7 → every resident report in that window: time, place, type
export async function GET(req: Request) {
  const days = Math.min(30, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 7));
  const now = Date.now();
  return Response.json({ now, points: await store.activity(now - days * 86400e3) });
}
