import { GoogleGenAI } from '@google/genai';
import { accessToken, project, serviceAccount, vertexKey } from './google';

// Every Google model the app uses, and why:
//   gemini-3.8-flash       the report decision: what's broken, how bad, who fixes it, what Mamdani does
//   gemini-3.5-flash-lite  fast checks: is the photo appropriate, where are faces/plates to blur,
//                          and is Mamdani's answer backed by the city's record
//   gemini-embedding-2     a fingerprint of each evidence photo, so the same pothole is found again
//   gemini-3.8-live        Mamdani's eyes, ears and conversation on the phone (lib/live.ts)
// Calls go through Vertex AI: the express key for Gemini, the service account for the rest.

export const MODELS = {
  decide: () => process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  lite: () => process.env.GEMINI_LITE_MODEL || 'gemini-3.5-flash-lite',
  embed: () => process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2',
  live: () => process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live',
};

let client: GoogleGenAI | null | undefined;
/** Gemini through Vertex AI (express key), or the Gemini API if that's what's configured. */
export function genai(): GoogleGenAI | null {
  if (client !== undefined) return client;
  if (vertexKey()) client = new GoogleGenAI({ vertexai: true, apiKey: vertexKey() });
  else if (process.env.GEMINI_API_KEY) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  else client = null;
  return client;
}

export const hasAI = () => genai() !== null;

/** One JSON answer from a model, validated against a schema. */
export async function json<T>(model: string, parts: Array<Record<string, unknown>>, schema: object, temperature = 0.2): Promise<T> {
  const ai = genai();
  if (!ai) throw new Error('no model configured');
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature },
  });
  return JSON.parse(res.text ?? '{}') as T;
}

export const EMBED_DIMS = 768;

/** Photo (and optional words) → a unit vector. Same problem from another angle lands close by. */
export async function embedImage(photo: { data: Buffer; mime: string }, text?: string): Promise<number[] | null> {
  const parts: Array<Record<string, unknown>> = [{ inlineData: { mimeType: photo.mime, data: photo.data.toString('base64') } }];
  if (text) parts.push({ text });
  return embed(parts);
}

/** Words → a vector in the same space as the photos, so staff can search evidence by description. */
export const embedText = (text: string) => embed([{ text }]);

async function embed(parts: Array<Record<string, unknown>>): Promise<number[] | null> {
  if (!serviceAccount()) return null;
  const token = await accessToken();
  const url = `https://aiplatform.googleapis.com/v1/projects/${project()}/locations/global/publishers/google/models/${MODELS.embed()}:embedContent`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: { parts }, outputDimensionality: EMBED_DIMS }),
  });
  const j = (await r.json()) as { embedding?: { values: number[] }; error?: { message: string } };
  if (!j.embedding) throw new Error(`embedding: ${j.error?.message ?? r.status}`);
  const v = j.embedding.values;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
