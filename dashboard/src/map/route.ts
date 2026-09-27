import type { LineString } from 'geojson';
import type { Issue } from '@shared/types';

// Crew routing with the Mapbox Optimization API: start at the depot, visit every stop in the
// order that minimises driving, and come back with the road geometry to draw.

export interface Trip {
  order: Issue[];
  duration: number; // seconds
  distance: number; // metres
  geometry: LineString;
}

export async function optimize(depot: [number, number], stops: Issue[]): Promise<Trip> {
  const list = stops.slice(0, 11); // the API takes 12 coordinates including the depot
  const coords = [depot, ...list.map((i) => [i.lng, i.lat] as [number, number])].map((c) => c.map((n) => n.toFixed(5)).join(',')).join(';');
  const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coords}?source=first&destination=any&roundtrip=false&geometries=geojson&overview=full&access_token=${import.meta.env.VITE_MAPBOX_ACCESS_TOKEN}`;
  const r = await fetch(url);
  const j = (await r.json()) as {
    code: string;
    message?: string;
    trips?: Array<{ geometry: LineString; duration: number; distance: number }>;
    waypoints?: Array<{ waypoint_index: number }>;
  };
  if (j.code !== 'Ok' || !j.trips?.length || !j.waypoints) throw new Error(j.message ?? j.code);
  // waypoints come back in input order, each with its position in the trip
  const order = j.waypoints
    .slice(1)
    .map((w, k) => ({ issue: list[k], at: w.waypoint_index }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.issue);
  return { order, duration: j.trips[0].duration, distance: j.trips[0].distance, geometry: j.trips[0].geometry };
}
