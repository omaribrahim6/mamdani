import type { LineString } from 'geojson';
import type { Issue } from '@shared/types';

// Crew routing: order the stops so the crew drives the least (nearest neighbour from the depot,
// then 2-opt to untangle crossings), then ask Mapbox Directions for the road route through them.

export interface Trip {
  order: Issue[];
  duration: number; // seconds
  distance: number; // metres
  geometry: LineString;
}

type P = [number, number];

const metres = (a: P, b: P) => {
  const r = Math.PI / 180;
  const x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r);
  const y = (b[1] - a[1]) * r;
  return Math.hypot(x, y) * 6371e3;
};

/** Visit order for an open path starting at the depot. */
export function order(depot: P, stops: Issue[]): Issue[] {
  const left = [...stops];
  const path: Issue[] = [];
  let at = depot;
  while (left.length) {
    let best = 0;
    for (let k = 1; k < left.length; k++) if (metres(at, [left[k].lng, left[k].lat]) < metres(at, [left[best].lng, left[best].lat])) best = k;
    const [next] = left.splice(best, 1);
    path.push(next);
    at = [next.lng, next.lat];
  }
  // 2-opt: reverse any stretch that makes the path shorter
  const pt = (k: number): P => (k < 0 ? depot : [path[k].lng, path[k].lat]);
  for (let improved = true, guard = 0; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const before = metres(pt(i - 1), pt(i)) + (j + 1 < path.length ? metres(pt(j), pt(j + 1)) : 0);
        const after = metres(pt(i - 1), pt(j)) + (j + 1 < path.length ? metres(pt(i), pt(j + 1)) : 0);
        if (after + 1 < before) {
          path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return path;
}

export async function optimize(depot: P, stops: Issue[]): Promise<Trip> {
  const path = order(depot, stops.slice(0, 24)); // Directions takes 25 coordinates
  const coords = [depot, ...path.map((i) => [i.lng, i.lat] as P)].map((c) => c.map((n) => n.toFixed(5)).join(',')).join(';');
  const r = await fetch(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}`,
  );
  const j = (await r.json()) as { code: string; message?: string; routes?: Array<{ geometry: LineString; duration: number; distance: number }> };
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.message ?? j.code);
  return { order: path, duration: j.routes[0].duration, distance: j.routes[0].distance, geometry: j.routes[0].geometry };
}
