import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import type { Issue, ReportResponse } from '../../lib/types';

// The phone is a client of the web app's API: Gemini, dedupe and the Tiger Data store all run there.
export const API = (process.env.EXPO_PUBLIC_API_URL || 'https://mamdani.vercel.app').replace(/\/$/, '');

export interface Media {
  uri: string;
  width: number;
  height: number;
}

/** Created at shutter time; every retry of this report reuses it, so it's filed exactly once. */
export const newSessionId = () => `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export async function submitReport(p: {
  sessionId: string;
  photo: Media;
  lat: number;
  lng: number;
  capturedAt: number;
  context: string;
  answer?: string | null;
  final?: boolean;
}): Promise<ReportResponse> {
  const fd = new FormData();
  // Expo's fetch (the global one since SDK 52+) reads files from expo-file-system File objects;
  // React Native's old { uri, name, type } parts make it throw before anything is sent.
  if (Platform.OS === 'web') fd.append('photo', await (await fetch(p.photo.uri)).blob(), 'photo.jpg');
  else fd.append('photo', new File(p.photo.uri) as unknown as Blob, 'photo.jpg');
  fd.append('sessionId', p.sessionId);
  fd.append('lat', String(p.lat));
  fd.append('lng', String(p.lng));
  fd.append('capturedAt', String(p.capturedAt));
  if (p.context) fd.append('context', p.context);
  if (p.answer) fd.append('answer', p.answer);
  if (p.final) fd.append('final', '1');

  // the same session can be retried safely: the server returns the report it already filed
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API}/api/submit`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j as ReportResponse;
      last = new Error(j.error || 'I couldn’t file that one. Try again.');
      if (r.status < 500) break;
    } catch (e) {
      console.warn('submit failed', e);
      last = new Error('No connection to the city. Check your signal and try again.');
    }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  throw last!;
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

/** Is what Mamdani is about to say backed by the city's record of this report? Returns what to say. */
export async function verifyAnswer(issueId: number, answer: string, question: string): Promise<{ grounded: boolean; answer: string }> {
  try {
    const r = await fetch(`${API}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId, answer, question }),
    });
    if (!r.ok) return { grounded: true, answer };
    const j = await r.json();
    return { grounded: j.grounded !== false, answer: String(j.answer || answer) };
  } catch {
    return { grounded: true, answer };
  }
}
