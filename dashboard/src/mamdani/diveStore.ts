import { useSyncExternalStore } from 'react';
import type mapboxgl from 'mapbox-gl';

// "Send Mamdani": the dock, the map and the dive choreography talk through this little store.
// The map registers itself (and its pins); the dock hides while he's away; Dive.tsx runs the show.

export type DivePhase = 'idle' | 'starting' | 'away' | 'returning';

export interface MapHandle {
  map: mapboxgl.Map;
  pins: Map<number, { el: HTMLDivElement }>;
  variant: 'compact' | 'full';
  box: HTMLElement;
}

let phase: DivePhase = 'idle';
const maps = new Set<MapHandle>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function registerMap(h: MapHandle) {
  maps.add(h);
  emit();
  return () => {
    maps.delete(h);
    emit();
  };
}

/** The biggest map on screen (the full live map beats the Command page's card). */
export function activeMap(): MapHandle | null {
  let best: MapHandle | null = null;
  for (const h of maps) if (!best || (h.variant === 'full' && best.variant !== 'full')) best = h;
  return best;
}

export function setPhase(p: DivePhase) {
  phase = p;
  emit();
}

export function sendMamdani() {
  if (phase === 'idle') setPhase('starting');
}

export function useDivePhase() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => phase,
  );
}
