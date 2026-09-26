import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { whereLabel } from './api';

const FALLBACK = { lat: 45.4215, lng: -75.6972 }; // downtown Ottawa

export interface Where {
  lat: number;
  lng: number;
  approximate: boolean;
  denied: boolean;
  label: string | null;
}

/** Follows the phone's position and names the street for the location chip. */
export function useWhere(): Where {
  const [w, setW] = useState<Where>({ ...FALLBACK, approximate: true, denied: false, label: null });

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    let named: { lat: number; lng: number } | null = null;

    const name = async (lat: number, lng: number) => {
      // re-label only after moving roughly 40 m
      if (named && Math.abs(named.lat - lat) < 0.0004 && Math.abs(named.lng - lng) < 0.0005) return;
      named = { lat, lng };
      let label: string | null = null;
      try {
        const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (a) label = [a.streetNumber, a.street].filter(Boolean).join(' ') || a.name || null;
      } catch {
        /* ask the server instead */
      }
      label ??= await whereLabel(lat, lng);
      if (alive) setW((p) => ({ ...p, label }));
    };

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (alive) setW((p) => ({ ...p, denied: true }));
        return;
      }
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last && alive) {
        setW((p) => ({ ...p, lat: last.coords.latitude, lng: last.coords.longitude, approximate: false }));
        void name(last.coords.latitude, last.coords.longitude);
      }
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, (pos) => {
        if (!alive) return;
        const { latitude: lat, longitude: lng } = pos.coords;
        setW((p) => ({ ...p, lat, lng, approximate: false }));
        void name(lat, lng);
      });
      if (!alive) sub.remove();
    })();

    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  return w;
}
