import { GoogleGenAI } from '@google/genai';
import { analyze, hasGemini } from './analyze';
import { category } from './categories';
import { streetAddress } from './geo';
import { store } from './store';
import type { Analysis, SubmitResult } from './types';

// One submission → one structured report, merged into an existing issue when it's the same problem.
//
// Duplicate detection, cheapest signal first:
//   1. same category + still open
//   2. within a radius that depends on the asset (a dead streetlight is a point; a blocked bike lane is a stretch)
//   3. Gemini compares the two photos: "is this the same physical problem?"

const RADIUS: Partial<Record<Analysis['category'], number>> = { bike_lane: 80, drainage: 50, waste: 40, streetlight: 30 };

export async function intake(input: {
  photo: { data: Buffer; mime: string };
  video: { data: Buffer; mime: string } | null;
  lat: number;
  lng: number;
  hint?: string;
}): Promise<{ analysis: Analysis; result: SubmitResult | null }> {
  const [analysis, address] = await Promise.all([analyze(input), streetAddress(input.lat, input.lng)]);
  if (!analysis.isCivicIssue) return { analysis, result: null };

  const mediaId = await store.putMedia(input.photo.data, input.photo.mime);
  const report = { createdAt: Date.now(), lat: input.lat, lng: input.lng, address, mediaId, transcript: analysis.transcript, analysis };

  const candidates = await store.openNear(input.lat, input.lng, RADIUS[analysis.category] ?? 35, analysis.category);
  for (const c of candidates.slice(0, 3)) {
    if (await sameProblem(input.photo, c.mediaId)) {
      const { issue, report: saved } = await store.confirmIssue(c.id, report);
      return { analysis, result: { issue, report: saved, duplicate: true } };
    }
  }

  const { issue, report: saved } = await store.createIssue(
    {
      category: analysis.category,
      title: analysis.title,
      summary: analysis.summary,
      lat: input.lat,
      lng: input.lng,
      address,
      severity: analysis.severity,
      safetyRisk: analysis.safetyRisk,
      hazards: analysis.hazards,
      accessibility: analysis.accessibility,
      department: category(analysis.category).department,
      status: 'new',
      reports: 1,
      firstReportedAt: report.createdAt,
      lastReportedAt: report.createdAt,
      resolvedAt: null,
      mediaId,
      box: analysis.box,
    },
    report,
  );
  return { analysis, result: { issue, report: saved, duplicate: false } };
}

async function sameProblem(photo: { data: Buffer; mime: string }, otherMediaId: string | null): Promise<boolean> {
  // no photo to compare (older/seeded issue) or no model: proximity + category is the call
  if (!otherMediaId || !hasGemini()) return true;
  const other = await store.getMedia(otherMediaId);
  if (!other) return true;
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: photo.mime, data: photo.data.toString('base64') } },
            { inlineData: { mimeType: other.mime, data: other.data.toString('base64') } },
            {
              text: 'Two residents photographed a city problem within a few metres of each other. Taken from different angles or times of day, do these show the SAME physical problem (same pothole, same broken slab, same light pole)? Answer as JSON.',
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object', properties: { same: { type: 'boolean' }, reason: { type: 'string' } }, required: ['same'] },
        temperature: 0,
      },
    });
    return JSON.parse(res.text ?? '{}').same !== false;
  } catch {
    return true;
  }
}
