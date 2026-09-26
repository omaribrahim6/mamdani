import { embedImage, hasAI, json, MODELS } from './ai';
import { analyze } from './analyze';
import { category } from './categories';
import { streetAddress } from './geo';
import { blurRegions, screenPhoto } from './screen';
import { store } from './store';
import type { Analysis, SubmitResult } from './types';

// One submission → one structured report, merged into an existing issue when it's the same problem.
//
// Duplicate detection, cheapest signal first:
//   1. same category + still open, within a radius that depends on the asset
//      (a dead streetlight is a point; a blocked bike lane is a stretch)
//   2. photo similarity: gemini-embedding-2 fingerprints compared in Tiger (pgvector)
//      — clearly the same → merge, clearly different → skip
//   3. only the in-between cases: Flash-Lite looks at both photos side by side

const RADIUS: Partial<Record<Analysis['category'], number>> = { bike_lane: 80, drainage: 50, waste: 40, streetlight: 30 };
const SAME = 0.93; // photo fingerprints this close are the same scene
const DIFFERENT = 0.62; // this far apart, not worth asking

export interface IntakeChecks {
  /** faces / plates blurred before the photo was stored */
  blurred: number;
  /** how a duplicate was recognised, if it was */
  matchedBy: 'photo' | 'model' | 'location' | null;
  similarity: number | null;
}

/** The web capture flow: screen, analyze and commit in one go. */
export async function intake(input: {
  photo: { data: Buffer; mime: string };
  video: { data: Buffer; mime: string } | null;
  lat: number;
  lng: number;
  hint?: string;
}): Promise<{ analysis: Analysis; result: SubmitResult | null }> {
  const [analysis, address, screen, embedding] = await Promise.all([
    analyze(input),
    streetAddress(input.lat, input.lng),
    screenPhoto(input.photo),
    embedImage(input.photo).catch(() => null),
  ]);
  if (!analysis.isCivicIssue || !screen.appropriate) return { analysis: { ...analysis, isCivicIssue: false }, result: null };
  const { result } = await commitReport({ ...input, photo: blurRegions(input.photo, screen.blur), analysis, address, embedding });
  return { analysis, result };
}

/** The write: store the evidence photo, then merge into a matching open issue or open a new one. */
export async function commitReport(input: {
  analysis: Analysis;
  photo: { data: Buffer; mime: string };
  lat: number;
  lng: number;
  address?: string;
  transcript?: string;
  embedding?: number[] | null;
  blurred?: number;
}): Promise<{ result: SubmitResult; checks: IntakeChecks }> {
  const { analysis, embedding } = input;
  const address = input.address ?? (await streetAddress(input.lat, input.lng));
  const mediaId = await store.putMedia(input.photo.data, input.photo.mime);
  const transcript = input.transcript || analysis.transcript;
  const report = { createdAt: Date.now(), lat: input.lat, lng: input.lng, address, mediaId, transcript, analysis };
  const checks: IntakeChecks = { blurred: input.blurred ?? 0, matchedBy: null, similarity: null };

  const near = await store.openNear(input.lat, input.lng, RADIUS[analysis.category] ?? 35, analysis.category, embedding);
  // most similar photo first; without fingerprints, nearest first
  near.sort((a, b) => (b.similarity ?? -2) - (a.similarity ?? -2) || a.distance - b.distance);
  for (const c of near.slice(0, 4)) {
    let same: boolean;
    if (c.similarity != null && c.similarity >= SAME) {
      same = true;
      checks.matchedBy = 'photo';
    } else if (c.similarity != null && c.similarity < DIFFERENT) {
      continue;
    } else {
      same = await sameProblem(input.photo, c.mediaId);
      checks.matchedBy = c.mediaId && hasAI() ? 'model' : 'location';
    }
    if (same) {
      checks.similarity = c.similarity;
      const { issue, report: saved } = await store.confirmIssue(c.id, report);
      return { result: { issue, report: saved, duplicate: true }, checks };
    }
    checks.matchedBy = null;
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
    embedding,
  );
  return { result: { issue, report: saved, duplicate: false }, checks };
}

/** Flash-Lite, two photos side by side: the same physical problem? */
async function sameProblem(photo: { data: Buffer; mime: string }, otherMediaId: string | null): Promise<boolean> {
  // no photo to compare (older/seeded issue) or no model: proximity + category is the call
  if (!otherMediaId || !hasAI()) return true;
  const other = await store.getMedia(otherMediaId);
  if (!other) return true;
  try {
    const r = await json<{ same: boolean }>(
      MODELS.lite(),
      [
        { inlineData: { mimeType: photo.mime, data: photo.data.toString('base64') } },
        { inlineData: { mimeType: other.mime, data: other.data.toString('base64') } },
        {
          text: 'Two residents photographed a city problem within a few metres of each other. Taken from different angles or times of day, do these show the SAME physical problem (same pothole, same broken slab, same light pole)?',
        },
      ],
      { type: 'object', properties: { same: { type: 'boolean' }, reason: { type: 'string' } }, required: ['same'] },
      0,
    );
    return r.same !== false;
  } catch {
    return true;
  }
}
