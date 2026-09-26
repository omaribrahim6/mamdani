import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { pulseLayer } from '../gl/mapPulse';

interface ReportMapProps {
  coordinates: [number, number];
  label: string;
  color?: string;
}

export function ReportMap({ coordinates, label, color = '#E8DFC1' }: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  const [lng, lat] = coordinates;

  useEffect(() => {
    if (!token || !containerRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard', center: [lng, lat], zoom: 16.4,
      pitch: 62, bearing: -22, antialias: true, attributionControl: false,
      config: { basemap: { theme: 'monochrome', lightPreset: 'dusk', showPointOfInterestLabels: false, showTransitLabels: false } },
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    const markerElement = document.createElement('div');
    markerElement.className = 'map-marker';
    markerElement.style.setProperty('--tone', color);
    markerElement.setAttribute('aria-label', label);
    new mapboxgl.Marker({ element: markerElement, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
    map.on('style.load', () => {
      try { map.addLayer(pulseLayer([lng, lat], color)); } catch { /* custom layer unsupported: marker is enough */ }
      // a slow drift around the report keeps the 3D city alive
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) map.easeTo({ bearing: 38, duration: 24000, easing: (t) => t });
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    return () => { resizeObserver.disconnect(); map.remove(); };
  }, [lng, lat, label, token, color]);

  if (!token) {
    return (
      <div className="map-fallback" role="status">
        <div className="fallback-grid" aria-hidden="true" /><span className="fallback-pin" aria-hidden="true" />
        <div><strong>Map view unavailable</strong><p>Add a Mapbox public token to display the 3D location.</p><small>{lat.toFixed(4)}, {lng.toFixed(4)}</small></div>
      </div>
    );
  }

  return <div ref={containerRef} className="report-map" aria-label={`3D map showing ${label}`} />;
}
