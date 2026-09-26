'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── camera ──────────────────────────────────────────────────────────────────
export type CamState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable';

export function useCamera() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>('idle');
  const [hasAudio, setHasAudio] = useState(false);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setState('unavailable');
    setState('starting');
    const videoC = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } };
    try {
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: videoC, audio: { echoCancellation: true, noiseSuppression: true } });
        setHasAudio(true);
      } catch (e) {
        if ((e as DOMException).name === 'NotAllowedError') throw e;
        s = await navigator.mediaDevices.getUserMedia({ video: videoC }); // mic busy/missing: photos still work
        setHasAudio(false);
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      setState('live');
    } catch (e) {
      setState((e as DOMException).name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }, []);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setState('idle');
  }, []);

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  /** Current frame as a JPEG, longest side capped for upload. */
  const snap = useCallback(async (max = 1600): Promise<Blob | null> => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    return frameToJpeg(v, v.videoWidth, v.videoHeight, max);
  }, []);

  return { video, stream, state, hasAudio, start, stop, snap };
}

export async function frameToJpeg(src: CanvasImageSource, w: number, h: number, max = 1600) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.86));
}

/** Pull a representative frame out of an uploaded video file. */
export async function frameFromVideoFile(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    await new Promise((r, j) => {
      v.onloadeddata = r;
      v.onerror = j;
    });
    v.currentTime = Math.min(1, v.duration / 2 || 0);
    await new Promise((r) => (v.onseeked = r));
    return frameToJpeg(v, v.videoWidth, v.videoHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── recorder: hold the shutter to show and tell ─────────────────────────────
export function useRecorder(stream: React.RefObject<MediaStream | null>) {
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  const start = useCallback(() => {
    const s = stream.current;
    if (!s || typeof MediaRecorder === 'undefined') return false;
    const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 1_500_000 });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.start(250);
    rec.current = r;
    setRecording(true);
    return true;
  }, [stream]);

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((res) => {
        const r = rec.current;
        if (!r || r.state === 'inactive') return res(null);
        r.onstop = () => res(new Blob(chunks.current, { type: r.mimeType }));
        r.stop();
        rec.current = null;
        setRecording(false);
      }),
    [],
  );

  return { recording, start, stop };
}

// ── location ────────────────────────────────────────────────────────────────
const FALLBACK = { lat: 45.4215, lng: -75.6972 }; // downtown Ottawa

export function useLocation() {
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy: number; approximate: boolean }>({ ...FALLBACK, accuracy: 5000, approximate: true });
  const [label, setLabel] = useState<string | null>(null);
  const lastLabelAt = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, approximate: false }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (loc.approximate) return;
    const prev = lastLabelAt.current;
    if (prev && Math.abs(prev.lat - loc.lat) < 0.0003 && Math.abs(prev.lng - loc.lng) < 0.0003) return;
    lastLabelAt.current = { lat: loc.lat, lng: loc.lng };
    fetch(`/api/where?lat=${loc.lat}&lng=${loc.lng}`)
      .then((r) => r.json())
      .then((j: { label?: string }) => j.label && setLabel(j.label))
      .catch(() => {});
  }, [loc]);

  return { ...loc, label };
}

// ── voice: ElevenLabs via /api/voice, browser speech as a fallback ──────────
let ctx: AudioContext | null = null;
export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export async function speak(text: string, onStart: (analyser: AnalyserNode | null) => void, onEnd: () => void) {
  try {
    const r = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (r.status === 200) {
      const c = unlockAudio();
      const buf = await c.decodeAudioData(await r.arrayBuffer());
      const src = c.createBufferSource();
      src.buffer = buf;
      const analyser = c.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser).connect(c.destination);
      src.onended = onEnd;
      onStart(analyser);
      src.start();
      return;
    }
  } catch {
    /* fall through */
  }
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.pitch = 1.1;
    u.onstart = () => onStart(null);
    u.onend = onEnd;
    u.onerror = onEnd;
    speechSynthesis.speak(u);
  } else {
    onStart(null);
    setTimeout(onEnd, 1800);
  }
}

// ── my reports (this device) ────────────────────────────────────────────────
export interface MyReport {
  issueId: number;
  title: string;
  category: string;
  address: string;
  at: number;
  duplicate: boolean;
}
const KEY = 'mamdani.reports';
export function loadMine(): MyReport[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
export function saveMine(r: MyReport) {
  try {
    const all = [r, ...loadMine().filter((x) => x.issueId !== r.issueId)].slice(0, 50);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode: tracking just won't persist */
  }
}
