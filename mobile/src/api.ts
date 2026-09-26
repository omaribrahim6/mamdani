import type { Analysis, Issue, SubmitResult } from '../../lib/types';

// The phone is a client of the web app's API: Gemini, dedupe and the Tiger Data store all run there.
export const API = (process.env.EXPO_PUBLIC_API_URL || 'https://mamdani.vercel.app').replace(/\/$/, '');

export interface Media {
  uri: string;
  width: number;
  height: number;
}

export async function sendReport(p: {
  photo: Media;
  video?: { uri: string; mime: string } | null;
  lat: number;
  lng: number;
}): Promise<{ analysis: Analysis; result: SubmitResult | null }> {
  const fd = new FormData();
  // React Native's FormData takes { uri, name, type } for files
  fd.append('photo', { uri: p.photo.uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  if (p.video) {
    const name = p.video.mime.includes('quicktime') ? 'clip.mov' : 'clip.mp4';
    fd.append('video', { uri: p.video.uri, name, type: p.video.mime } as unknown as Blob);
  }
  fd.append('lat', String(p.lat));
  fd.append('lng', String(p.lng));
  let r: Response;
  try {
    r = await fetch(`${API}/api/report`, { method: 'POST', body: fd });
  } catch {
    throw new Error('No connection to the city. Check your signal and try again.');
  }
  if (r.status === 413) throw new Error('That clip is too big to send. Keep it under 10 seconds.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The report didn’t go through.');
  return j;
}

export async function getIssue(id: number): Promise<Issue | null> {
  try {
    const r = await fetch(`${API}/api/issues/${id}`);
    if (!r.ok) return null;
    return (await r.json()).issue as Issue;
  } catch {
    return null;
  }
}

export async function whereLabel(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`${API}/api/where?lat=${lat}&lng=${lng}`);
    return r.ok ? ((await r.json()).label as string) : null;
  } catch {
    return null;
  }
}
