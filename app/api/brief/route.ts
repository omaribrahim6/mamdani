import { brief } from '@/lib/command/brief';

export const maxDuration = 120;

// GET /api/brief            → today's brief (cached for 20 minutes)
// GET /api/brief?refresh=1  → write a fresh one
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.has('refresh');
  try {
    return Response.json(await brief(refresh));
  } catch (e) {
    console.error('brief failed', e);
    return Response.json({ error: 'The brief could not be written right now.' }, { status: 502 });
  }
}
