import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { renderToStaticMarkup } from 'react-dom/server';
import gsap from 'gsap';
import { Box, Flame, Maximize2, Minus, Navigation, Plus, X } from 'lucide-react';
import type { ActivityPoint, Issue } from '@shared/types';
import type { CategoryId } from '@shared/categories';
import { useCity } from '../lib/city';
import { CATEGORIES, category, ICON, STATUS_SHORT, street } from '../lib/format';
import { go } from '../lib/router';
import { optimize, type Trip } from './route';
import { registerMap, sendMamdani, useDivePhase } from '../mamdani/diveStore';
import './map.css';

// The city on Mapbox Standard (monochrome, 3D buildings, day/night with the theme). Issues are
// pins you can click; resident reports feed a heat layer; Mamdani can highlight issues or ask for
// a crew route, which Mapbox's optimizer orders and draws.

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? '';

const OTTAWA: [number, number] = [-75.6933, 45.4175];
/** where crews leave from: Public Works yard by City Hall */
export const DEPOT: [number, number] = [-75.6953, 45.4206];

const ICON_SVG = Object.fromEntries(
  (Object.keys(ICON) as CategoryId[]).map((k) => {
    const I = ICON[k];
    return [k, renderToStaticMarkup(<I size={15} strokeWidth={2} color="currentColor" />)];
  }),
) as Record<CategoryId, string>;

const dark = () => document.documentElement.dataset.theme === 'dark';

export interface CityMapProps {
  issues: Issue[];
  variant: 'compact' | 'full';
  heat?: boolean;
  buildings?: boolean;
  replayAt?: number | null;
  activity?: ActivityPoint[];
  picking?: Set<number>;
  onPick?: (id: number) => void;
  onTrip?: (t: Trip | null) => void;
}

export function CityMap({ issues, variant, heat = true, buildings = true, replayAt = null, activity, picking, onPick, onTrip }: CityMapProps) {
  const city = useCity();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markers = useRef(new Map<number, { m: mapboxgl.Marker; el: HTMLDivElement }>());
  const stopMarkers = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [routing, setRouting] = useState(false);
  const draw = useRef<gsap.core.Tween | null>(null);
  const points = activity ?? city.activity;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const dive = useDivePhase();

  // ── the map itself ──
  useEffect(() => {
    const m = new mapboxgl.Map({
      container: box.current!,
      style: 'mapbox://styles/mapbox/standard',
      center: OTTAWA,
      zoom: variant === 'full' ? 13.6 : 13,
      pitch: variant === 'full' ? 52 : 38,
      bearing: -18,
      antialias: true,
      attributionControl: false,
      config: {
        basemap: {
          theme: 'monochrome',
          lightPreset: dark() ? 'night' : 'day',
          showPointOfInterestLabels: false,
          showTransitLabels: false,
          show3dObjects: buildings,
        },
      },
    });
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    m.on('style.load', () => {
      m.addSource('reports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'heat',
        type: 'heatmap',
        source: 'reports',
        slot: 'middle',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 16, 2.2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 11, 18, 16, 46],
          'heatmap-opacity': 0.75,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0,
            'rgba(255,106,19,0)',
            0.25,
            'rgba(255,179,112,0.45)',
            0.55,
            'rgba(255,106,19,0.75)',
            0.85,
            'rgba(255,46,136,0.85)',
            1,
            'rgba(138,63,214,0.9)',
          ],
        },
      });
      m.addLayer({
        id: 'report-dots',
        type: 'circle',
        source: 'reports',
        slot: 'top',
        minzoom: 12,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 16, 4],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': dark() ? '#0b0c0c' : '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9,
        },
      });
      m.addSource('route', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route',
        slot: 'top',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': dark() ? '#000' : '#fff', 'line-width': 10, 'line-opacity': 0.9, 'line-trim-offset': [0, 0] },
      });
      m.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        slot: 'top',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 5,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#2f6bff', 0.5, '#ff2e88', 1, '#ff6a13'],
          'line-trim-offset': [0, 0],
        },
      });
      setReady(true);
    });
    map.current = m;
    // "Send Mamdani" drives this map: its camera, its pins, a 3D layer with him in it
    const unregister = registerMap({ map: m, pins: markers.current, variant, box: box.current! });

    const themeWatch = new MutationObserver(() => {
      if (!m.isStyleLoaded()) return;
      m.setConfigProperty('basemap', 'lightPreset', dark() ? 'night' : 'day');
      m.setPaintProperty('route-casing', 'line-color', dark() ? '#000' : '#fff');
      m.setPaintProperty('report-dots', 'circle-stroke-color', dark() ? '#0b0c0c' : '#ffffff');
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current!);

    return () => {
      unregister();
      draw.current?.kill();
      themeWatch.disconnect();
      ro.disconnect();
      markers.current.clear();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (ready && m) m.setConfigProperty('basemap', 'show3dObjects', buildings);
  }, [buildings, ready]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setLayoutProperty('heat', 'visibility', heat ? 'visible' : 'none');
    m.setLayoutProperty('report-dots', 'visibility', heat ? 'visible' : 'none');
  }, [heat, ready]);

  // ── reports → heat (and the replay cursor) ──
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const shown = replayAt == null ? points : points.filter((p) => p.t <= replayAt && p.t > replayAt - 24 * 3600e3);
    (m.getSource('reports') as mapboxgl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: shown
        .filter((p) => p.lat && Math.abs(p.lat - 45.42) + Math.abs(p.lng + 75.69) > 0.0005)
        .map((p) => ({ type: 'Feature', properties: { t: p.t, color: CATEGORIES[p.category]?.color ?? '#888' }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
    });
  }, [points, replayAt, ready]);

  // ── issue pins ──
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<number>();
    for (const i of issues) {
      seen.add(i.id);
      let entry = markers.current.get(i.id);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'pin';
        el.innerHTML = `<div class="pin-head"></div><div class="pin-card"></div><div class="pin-foot"></div>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (pickRef.current) pickRef.current(Number(el.dataset.id));
          else city.open(Number(el.dataset.id));
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([i.lng, i.lat]).addTo(m);
        entry = { m: marker, el };
        markers.current.set(i.id, entry);
        gsap.from(el.firstElementChild, { y: -24, opacity: 0, duration: 0.7, ease: 'bounce.out', delay: Math.random() * 0.5 });
      }
      const { el } = entry;
      el.dataset.id = String(i.id);
      el.dataset.status = i.status;
      el.classList.toggle('hot', i.priority >= 70 && i.status !== 'resolved');
      el.classList.toggle('fresh', city.fresh.has(i.id));
      el.style.setProperty('--c', category(i.category).color);
      (el.firstElementChild as HTMLElement).innerHTML = ICON_SVG[i.category];
      (el.children[1] as HTMLElement).innerHTML = `<b>#${i.id}</b><span>${street(i.address)}</span><em>${category(i.category).label} · ${STATUS_SHORT[i.status]}</em>`;
      entry.m.setLngLat([i.lng, i.lat]);
    }
    for (const [id, e] of markers.current) {
      if (!seen.has(id)) {
        e.m.remove();
        markers.current.delete(id);
      }
    }
  }, [issues, city, city.fresh]);

  // selection + route picking state on pins
  useEffect(() => {
    for (const [id, { el }] of markers.current) {
      el.classList.toggle('selected', city.selectedId === id);
      el.classList.toggle('picked', !!picking?.has(id));
    }
  }, [city.selectedId, picking, issues]);

  // ── Mamdani (or anyone) asked to show something ──
  useEffect(() => {
    const m = map.current;
    const f = city.focus;
    for (const [id, { el }] of markers.current) {
      el.classList.toggle('focus', !!f?.ids.includes(id));
      el.classList.toggle('dim', !!f && !f.ids.includes(id));
    }
    if (!m || !ready) return;
    if (!f) {
      clearRoute();
      return;
    }
    const pts = f.ids.map((id) => city.byId.get(id)).filter(Boolean) as Issue[];
    if (!pts.length) return;
    if (f.mode === 'route' && variant === 'full') void drawRoute(pts);
    else fit(pts.map((p) => [p.lng, p.lat]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.focus, ready]);

  // fly to the open issue
  useEffect(() => {
    const m = map.current;
    const i = city.selectedId ? city.byId.get(city.selectedId) : null;
    if (m && i && variant === 'full') m.flyTo({ center: [i.lng, i.lat], zoom: 16.2, pitch: 58, duration: 1400, essential: true, offset: [-160, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.selectedId]);

  function fit(coords: Array<[number, number]>) {
    const m = map.current!;
    if (coords.length === 1) {
      m.flyTo({ center: coords[0], zoom: 16, duration: 1400 });
      return;
    }
    const b = coords.reduce((bb, c) => bb.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
    m.fitBounds(b, { padding: variant === 'full' ? { top: 120, bottom: 140, left: 420, right: 120 } : 60, duration: 1400, maxZoom: 16, pitch: variant === 'full' ? 50 : 35 });
  }

  function clearRoute() {
    const m = map.current;
    draw.current?.kill();
    stopMarkers.current.forEach((s) => s.remove());
    stopMarkers.current = [];
    if (m?.getSource('route')) (m.getSource('route') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
    setTrip(null);
    onTrip?.(null);
  }

  async function drawRoute(pts: Issue[]) {
    const m = map.current!;
    clearRoute();
    setRouting(true);
    try {
      const t = await optimize(DEPOT, pts);
      setTrip(t);
      onTrip?.(t);
      (m.getSource('route') as mapboxgl.GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: t.geometry });
      fit(t.geometry.coordinates as Array<[number, number]>);
      // draw the line along its length
      const o = { p: 0 };
      draw.current?.kill();
      draw.current = gsap.to(o, {
        p: 1,
        duration: 2.2,
        ease: 'power2.inOut',
        onUpdate: () => {
          if (map.current !== m || !m.getLayer('route')) return;
          m.setPaintProperty('route', 'line-trim-offset', [Math.min(o.p, 0.9999), 1]);
          m.setPaintProperty('route-casing', 'line-trim-offset', [Math.min(o.p, 0.9999), 1]);
        },
      });
      const depot = document.createElement('div');
      depot.className = 'stop depot';
      depot.innerHTML = renderToStaticMarkup(<Navigation size={14} />);
      stopMarkers.current.push(new mapboxgl.Marker({ element: depot }).setLngLat(DEPOT).addTo(m));
      t.order.forEach((issue, k) => {
        const s = document.createElement('div');
        s.className = 'stop';
        s.textContent = String(k + 1);
        stopMarkers.current.push(new mapboxgl.Marker({ element: s, offset: [16, -46] }).setLngLat([issue.lng, issue.lat]).addTo(m));
        gsap.from(s, { scale: 0, duration: 0.5, ease: 'back.out(2)', delay: 0.4 + (k / t.order.length) * 1.8 });
      });
    } catch (e) {
      city.toast({ tone: 'bad', title: 'Route planning failed', body: String((e as Error).message) });
    } finally {
      setRouting(false);
    }
  }

  const zoom = (d: number) => map.current?.easeTo({ zoom: (map.current.getZoom() ?? 13) + d, duration: 400 });
  const label = useMemo(() => city.focus?.label, [city.focus]);

  return (
    <div className={`citymap ${variant}`}>
      <div ref={box} className="citymap-gl" />
      {label && (
        <div className="focus-chip">
          <span className="focus-dot" />
          {routing ? 'Planning route…' : label}
          <button onClick={city.clearFocus} aria-label="Clear">
            <X size={14} />
          </button>
        </div>
      )}
      {variant === 'compact' && (
        <button className="map-expand icon-btn" onClick={() => go('map')} aria-label="Open the live map">
          <Maximize2 size={16} />
        </button>
      )}
      <button className="dive-btn" onClick={sendMamdani} disabled={dive !== 'idle'} title="Mamdani jumps into the map and goes to the potholes">
        <img src="/mamdani-face.png" alt="" />
        {dive === 'idle' ? 'Send Mamdani' : 'Mamdani’s out'}
      </button>
      <div className="map-zoom">
        <button onClick={() => zoom(1)} aria-label="Zoom in">
          <Plus size={16} />
        </button>
        <button onClick={() => zoom(-1)} aria-label="Zoom out">
          <Minus size={16} />
        </button>
      </div>
      {trip && variant === 'full' && <TripCard trip={trip} onClose={city.clearFocus} />}
    </div>
  );
}

function TripCard({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const city = useCity();
  const manifest = () => {
    const lines = [
      `CREW RUN — ${new Date().toLocaleString('en-CA')}`,
      `${trip.order.length} stops · ${Math.round(trip.duration / 60)} min driving · ${(trip.distance / 1000).toFixed(1)} km`,
      'Start: Public Works yard, 110 Laurier Ave W',
      ...trip.order.map((i, k) => `${k + 1}. #${i.id} ${category(i.category).label} — ${i.address} (${i.title})`),
    ];
    void navigator.clipboard?.writeText(lines.join('\n'));
    city.toast({ tone: 'good', title: 'Crew manifest copied', body: 'Paste it into the crew’s dispatch message.' });
  };
  return (
    <div className="trip">
      <div className="trip-head">
        <div>
          <span className="trip-kicker">Optimized crew run</span>
          <div className="trip-stats">
            <b className="num">{Math.round(trip.duration / 60)}</b>
            <span>min driving</span>
            <b className="num">{(trip.distance / 1000).toFixed(1)}</b>
            <span>km</span>
            <b className="num">{trip.order.length}</b>
            <span>stops</span>
          </div>
        </div>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close route">
          <X size={16} />
        </button>
      </div>
      <ol className="trip-list">
        {trip.order.map((i, k) => (
          <li key={i.id} onClick={() => city.open(i.id)}>
            <span className="trip-n">{k + 1}</span>
            <div>
              <b>{i.title}</b>
              <span>
                #{i.id} · {street(i.address)}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="trip-actions">
        <button className="btn small primary" onClick={manifest}>
          Copy crew manifest
        </button>
        <button
          className="btn small soft"
          onClick={() => {
            const ids = trip.order.filter((i) => i.status === 'new').map((i) => i.id);
            if (ids.length) void city.setStatus(ids, 'assigned', 'Batched into an optimized crew run');
          }}
        >
          Assign all
        </button>
      </div>
    </div>
  );
}

export function MapLayers({ heat, setHeat, buildings, setBuildings }: { heat: boolean; setHeat: (v: boolean) => void; buildings: boolean; setBuildings: (v: boolean) => void }) {
  return (
    <div className="layers">
      <button className={heat ? 'on' : ''} onClick={() => setHeat(!heat)}>
        <Flame size={14} /> Report heat
      </button>
      <button className={buildings ? 'on' : ''} onClick={() => setBuildings(!buildings)}>
        <Box size={14} /> 3D city
      </button>
    </div>
  );
}
