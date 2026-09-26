import { streetAddress } from '@/lib/geo';

// GET /api/where?lat=&lng= → a street label for the location chip
export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get('lat'));
  const lng = Number(u.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng)) return Response.json({ error: 'Missing location.' }, { status: 400 });
  return Response.json({ label: await streetAddress(lat, lng) });
}
