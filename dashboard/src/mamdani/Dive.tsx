import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import gsap from 'gsap';
import type { Issue } from '@shared/types';
import { useCity } from '../lib/city';
import { category, street } from '../lib/format';
import { go } from '../lib/router';
import { speak } from '../lib/voice';
import { activeMap, setPhase, useDivePhase, type MapHandle } from './diveStore';
import { LeapStage } from './Leap';
import { bearing, HEIGHT, MapMamdani, metres, offset, type LngLat } from './MapMamdani';
import { loadModel } from './MamdaniCanvas';
import './dive.css';

// "Send Mamdani". He leaps out of his corner, over the dashboard and into the live map, lands on
// a real street next to the worst open pothole, looks around, spots the potholes near him (the
// actual work orders, lit up on the map) and runs down the real streets to each one, planting a
// flag. The camera rides over his shoulder, so it's his view of the job. Then he waves and heads
// back to his corner.

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const voiceOn = () => {
  try {
    return localStorage.getItem('mamdani-voice') === 'on';
  } catch {
    return false;
  }
};

/** The job: the worst open pothole and up to two more close to it (any problem if there are no potholes). */
function pickStops(issues: Issue[]) {
  const open = issues.filter((i) => i.status !== 'resolved' && i.lat && i.lng);
  const pool = open.some((i) => i.category === 'pothole') ? open.filter((i) => i.category === 'pothole') : open;
  const first = [...pool].sort((a, b) => b.priority - a.priority)[0];
  if (!first) return [];
  const near = pool
    .filter((i) => i.id !== first.id && metres([first.lng, first.lat], [i.lng, i.lat]) < 1000)
    .sort((a, b) => metres([first.lng, first.lat], [a.lng, a.lat]) - metres([first.lng, first.lat], [b.lng, b.lat]))
    .slice(0, 2);
  return [first, ...near];
}

/** A walking route on real streets (Mapbox Directions); a straight line if that fails. */
async function streets(a: LngLat, b: LngLat): Promise<LngLat[]> {
  try {
    const q = [a, b].map((c) => c.map((n) => n.toFixed(6)).join(',')).join(';');
    const r = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${q}?geometries=geojson&overview=full&access_token=${mapboxgl.accessToken}`);
    const j = (await r.json()) as { routes?: Array<{ geometry: { coordinates: LngLat[] } }> };
    const c = j.routes?.[0]?.geometry.coordinates;
    if (c && c.length > 1) return c;
  } catch {
    /* straight line below */
  }
  return [a, b];
}

/** The path, ending `d` metres before its last point. */
function shortOf(path: LngLat[], d: number): LngLat[] {
  const lens = path.slice(1).map((p, i) => metres(path[i], p));
  let left = lens.reduce((a, b) => a + b, 0) - d;
  if (left < 3) return path;
  const out: LngLat[] = [path[0]];
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]) {
      const u = left / lens[i];
      out.push([path[i][0] + (path[i + 1][0] - path[i][0]) * u, path[i][1] + (path[i + 1][1] - path[i][1]) * u]);
      return out;
    }
    left -= lens[i];
    out.push(path[i + 1]);
  }
  return out;
}

function ring(center: LngLat, r: number) {
  const pts: LngLat[] = [];
  for (let k = 0; k <= 72; k++) pts.push(offset(center, (k / 72) * 360, r));
  return { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: pts } };
}

export function Dive() {
  const city = useCity();
  const phase = useDivePhase();
  const overlay = useRef<HTMLCanvasElement>(null);
  const [bubble, setBubble] = useState<{ text: string; x: number; y: number } | null>(null);
  const cityRef = useRef(city);
  cityRef.current = city;

  useEffect(() => {
    if (phase !== 'starting') return;
    let stopped = false;
    let finished = false;
    const cleanups: Array<() => void> = [];
    const alive = () => !stopped;
    // Escape calls him back at any point
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopped = true;
        finish();
      }
    };
    addEventListener('keydown', onKey);
    cleanups.push(() => removeEventListener('keydown', onKey));

    (async () => {
      // the full live map is the best stage; open it if it isn't up
      let h: MapHandle | null = activeMap();
      if (!h || h.variant !== 'full') {
        go('map');
        for (let k = 0; k < 40 && (!(h = activeMap()) || h.variant !== 'full'); k++) await wait(100);
      }
      if (!h || !alive()) return finish();
      const { map, pins, box } = h;
      if (!map.isStyleLoaded()) await new Promise((r) => map.once('idle', r));

      const stops = pickStops(cityRef.current.issues);
      if (!stops.length) {
        cityRef.current.toast({ tone: 'info', title: 'Nothing for Mamdani to fix', body: 'There are no open issues on the map.' });
        return finish();
      }
      const kind = category(stops[0].category).label.toLowerCase();
      const first: LngLat = [stops[0].lng, stops[0].lat];

      // where he lands: on the street, a block short of the first pothole
      const [legs] = await Promise.all([
        Promise.all([
          streets(offset(first, 215, 110), first),
          ...stops.slice(1).map((s, k) => streets([stops[k].lng, stops[k].lat], [s.lng, s.lat])),
        ]),
        loadModel('suit'),
        loadModel('construction'),
      ]);
      const approach = legs[0];
      const landing = approach[0];
      const firstHeading = bearing(landing, approach[Math.min(approach.length - 1, 2)]);
      if (!alive()) return finish();

      const mm = new MapMamdani(landing);
      map.addLayer(mm.layer);
      if (import.meta.env.DEV) Object.assign(globalThis, { __dive: { map, mm, stops, legs, landing } });
      cleanups.push(() => {
        if (map.getLayer(mm.layer.id)) map.removeLayer(mm.layer.id);
      });
      setPhase('away');

      // the map swings round to where he's going to land, facing up the street he'll run down
      const landView = { center: offset(landing, firstHeading, HEIGHT * 1.6), zoom: 17.7, pitch: 58, bearing: firstHeading };
      map.flyTo({ ...landView, duration: 1700, essential: true });
      await new Promise((r) => map.once('moveend', r));
      await wait(60); // one frame with the new camera, so the projection below is current
      if (!alive()) return finish();

      // ── the leap ──
      const rect = box.getBoundingClientRect();
      const feet = mm.screen(landing, 0);
      const head = mm.screen(landing, HEIGHT);
      const to = { x: rect.left + feet.x, y: rect.top + feet.y };
      const endPx = Math.max(24, feet.y - head.y);
      const canvas = overlay.current!;
      canvas.style.display = 'block';
      const leap = new LeapStage(canvas);
      cleanups.push(() => {
        leap.dispose();
        canvas.style.display = 'none';
      });
      await leap.leap({ x: innerWidth - 84, y: innerHeight + 30 }, Math.min(420, innerHeight * 0.42), to, endPx, ['suit', 'construction']);
      if (!alive()) return finish();

      // ── the map's Mamdani takes over, exactly where the leaping one arrived ──
      mm.show('construction', landing, firstHeading);
      leap.clear();
      await mm.land(() => {
        gsap.fromTo(box, { y: 0 }, { y: 7, duration: 0.05, repeat: 5, yoyo: true, ease: 'none', clearProps: 'transform' });
      });
      leap.dispose();
      canvas.style.display = 'none';

      // his head, for the speech bubble
      let raf = 0;
      let line: string | null = null;
      const track = () => {
        raf = requestAnimationFrame(track);
        if (!line) return setBubble(null);
        const p = mm.screen(mm.at, HEIGHT * 1.12);
        const r = box.getBoundingClientRect();
        setBubble({ text: line, x: r.left + p.x, y: r.top + p.y });
      };
      track();
      cleanups.push(() => cancelAnimationFrame(raf));
      const say = (text: string | null, ms = 0) => {
        line = text;
        if (text && voiceOn()) void speak(text);
        return ms ? wait(ms) : Promise.resolve();
      };

      // ── his view: the camera comes down over his shoulder ──
      const chase = (at: LngLat, hd: number) => ({ center: offset(at, hd, HEIGHT * 2.3), zoom: 19.0, pitch: 72, bearing: hd });
      map.easeTo({ ...chase(landing, firstHeading), duration: 1500, easing: (t) => 1 - (1 - t) ** 3 });
      await wait(900);
      await mm.lookAround();
      if (!alive()) return finish();

      // he spots them: a ring goes out from where he stands, and the potholes light up as it reaches them
      map.addSource('mamdani-scan', { type: 'geojson', data: ring(landing, 1) });
      map.addLayer({ id: 'mamdani-scan', type: 'line', source: 'mamdani-scan', slot: 'top', paint: { 'line-color': '#ff6a13', 'line-width': 4, 'line-opacity': 0.9, 'line-blur': 1.5 } });
      cleanups.push(() => {
        if (map.getLayer('mamdani-scan')) map.removeLayer('mamdani-scan');
        if (map.getSource('mamdani-scan')) map.removeSource('mamdani-scan');
      });
      const reach = Math.max(200, ...stops.map((s) => metres(landing, [s.lng, s.lat]) + 40));
      const dist = stops.map((s) => metres(landing, [s.lng, s.lat]));
      const lit = new Set<number>();
      const scan = { r: 1 };
      await new Promise<void>((res) =>
        gsap.to(scan, {
          r: reach,
          duration: 1.4,
          ease: 'power2.out',
          onUpdate: () => {
            (map.getSource('mamdani-scan') as mapboxgl.GeoJSONSource | undefined)?.setData(ring(landing, scan.r));
            map.setPaintProperty('mamdani-scan', 'line-opacity', 0.9 * (1 - scan.r / reach) + 0.1);
            stops.forEach((s, k) => {
              if (!lit.has(s.id) && scan.r >= dist[k]) {
                lit.add(s.id);
                pins.get(s.id)?.el.classList.add('spotted');
              }
            });
          },
          onComplete: () => res(),
        }),
      );
      cleanups.push(() => stops.forEach((s) => pins.get(s.id)?.el.classList.remove('spotted', 'flagged', 'working')));
      map.setPaintProperty('mamdani-scan', 'line-opacity', 0);
      const where = street(stops[0].address);
      await say(stops.length > 1 ? `${stops.length} ${kind}s around ${where}. On it.` : `A ${kind} on ${where}. On it.`, 1500);
      await say(null);

      // ── the run: down the real streets to each one, a flag in every hole ──
      let hd = firstHeading;
      for (let k = 0; k < stops.length; k++) {
        if (!alive()) return finish();
        // stop a few metres short, so the pothole (and its pin) sit just past him, not under him
        const path = shortOf(legs[k], 9);
        const len = path.slice(1).reduce((a, p, i) => a + metres(path[i], p), 0);
        const speed = Math.max(30, len / 4.5); // a few seconds a stretch, whatever the distance
        await mm.run(path, speed, (at, h2) => {
          hd = h2;
          map.jumpTo(chase(at, hd));
        });
        const s = stops[k];
        const spot: LngLat = [s.lng, s.lat];
        // swing round beside him for the flag; the pin steps back while he works on it
        const pin = pins.get(s.id)?.el;
        pin?.classList.add('working');
        map.easeTo({ center: offset(mm.at, hd, HEIGHT * 0.5), zoom: 18.7, pitch: 52, bearing: hd - 60, duration: 700 });
        await mm.plantFlag(spot, () => pin?.classList.add('flagged'));
        await say(`#${s.id} flagged.`, 750);
        // the last one stays faded: he's standing at it for the wave
        pin?.classList.remove('spotted');
        if (k < stops.length - 1) pin?.classList.remove('working');
        await say(null);
      }

      // ── done: pull up to see the flags, wave, and head home ──
      // pull back just enough to see him by his last flag (the whole run is a kilometre; he'd be a speck)
      map.easeTo({ center: mm.at, zoom: 18.25, pitch: 58, bearing: map.getBearing() + 25, duration: 1600, easing: (t) => 1 - (1 - t) ** 3 });
      await wait(900);
      void mm.wave((map.getBearing() + 180) % 360);
      await say(stops.length > 1 ? `${stops.length} flagged. Crews are on the way.` : 'Flagged. The crew is on the way.', 2600);
      await say(null);

      // ── home: he leaps back out of the map and into his corner ──
      const r2 = box.getBoundingClientRect();
      const f2 = mm.screen(mm.at, 0);
      const h2 = mm.screen(mm.at, HEIGHT);
      canvas.style.display = 'block'; // before the stage sizes itself to the canvas
      const home = new LeapStage(canvas);
      cleanups.push(() => {
        home.dispose();
        canvas.style.display = 'none';
      });
      mm.lift();
      await home.leapHome({ x: r2.left + f2.x, y: r2.top + f2.y }, Math.max(24, f2.y - h2.y), { x: innerWidth - 84, y: innerHeight + 30 }, Math.min(420, innerHeight * 0.42), ['construction', 'suit']);
      finish();
    })().catch((e) => {
      console.warn('Mamdani dive stopped', e);
      finish();
    });

    function finish() {
      if (finished) return;
      finished = true;
      stopped = true;
      setBubble(null);
      cleanups.reverse().forEach((f) => {
        try {
          f();
        } catch {
          /* already gone */
        }
      });
      cleanups.length = 0;
      setPhase('returning');
      setTimeout(() => setPhase('idle'), 50);
    }

    // the dive runs to its end on its own; nothing to undo when the phase moves on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'starting']);

  return (
    <>
      <canvas ref={overlay} className="dive-leap" aria-hidden />
      {bubble && (
        <div className="dive-bubble" style={{ left: bubble.x, top: bubble.y }} role="status">
          {bubble.text}
        </div>
      )}
    </>
  );
}
