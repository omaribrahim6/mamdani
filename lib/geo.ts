// Reverse geocoding via OpenStreetMap Nominatim (free, 1 req/s). Cached per ~10 m cell.
const cache = new Map<string, string>();
let last = 0;

export async function streetAddress(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const wait = Math.max(0, last + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`,
      { headers: { 'User-Agent': 'mamdani-civic-hackathon/0.1 (Hack the Hill III)' }, signal: AbortSignal.timeout(4000) },
    );
    const j = (await r.json()) as { address?: Record<string, string> };
    const a = j.address ?? {};
    const street = a.road || a.pedestrian || a.footway || a.cycleway || a.path;
    const near = a.house_number ? `${a.house_number} ${street}` : street;
    const label = [near, a.neighbourhood || a.suburb || a.quarter].filter(Boolean).join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    cache.set(key, label);
    return label;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}
