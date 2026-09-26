import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface ReportMapProps {
  coordinates: [number, number];
  label: string;
}

export function ReportMap({ coordinates, label }: ReportMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    if (!token || !containerRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard', center: coordinates, zoom: 16.2,
      pitch: 62, bearing: -22, antialias: true, attributionControl: false,
      config: { basemap: { theme: 'monochrome', lightPreset: 'day', showPointOfInterestLabels: false, showTransitLabels: false } },
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    const markerElement = document.createElement('div');
    markerElement.className = 'map-marker';
    markerElement.setAttribute('aria-label', label);
    new mapboxgl.Marker({ element: markerElement, anchor: 'bottom' }).setLngLat(coordinates).addTo(map);

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);
    return () => { resizeObserver.disconnect(); map.remove(); };
  }, [coordinates, label, token]);

  if (!token) {
    return (
      <div className="map-fallback" role="status">
        <div className="fallback-grid" aria-hidden="true" /><span className="fallback-pin" aria-hidden="true" />
        <div><strong>Map view unavailable</strong><p>Add a Mapbox public token to display the 3D location.</p><small>{coordinates[1].toFixed(4)}, {coordinates[0].toFixed(4)}</small></div>
      </div>
    );
  }

  return <div ref={containerRef} className="report-map" aria-label={`3D map showing ${label}`} />;
}
