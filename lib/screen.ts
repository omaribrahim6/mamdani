import jpeg from 'jpeg-js';
import { hasAI, json, MODELS } from './ai';

// Before a photo becomes city evidence it goes through a fast model (Flash-Lite):
//   • appropriateness — nothing explicit, violent, hateful or harassing is stored or shown to staff,
//     and it has to be a picture of a public place (not a selfie, a screenshot, a meme)
//   • privacy — faces and licence plates are found and blurred before the photo is saved
// Runs alongside the main analysis, so it adds no waiting.

export interface Screen {
  appropriate: boolean;
  /** why it was turned away, in words for the resident */
  reason: string;
  kind: 'street_scene' | 'selfie_or_portrait' | 'screenshot_or_document' | 'indoor_private' | 'explicit' | 'violent' | 'hateful' | 'other';
  /** [ymin, xmin, ymax, xmax] 0-1000 */
  blur: Array<[number, number, number, number]>;
}

const SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['street_scene', 'selfie_or_portrait', 'screenshot_or_document', 'indoor_private', 'explicit', 'violent', 'hateful', 'other'],
      description: 'What this photo is. street_scene = any public place, outdoors OR indoors (libraries, transit stations, rec centres, city buildings, parks).',
    },
    appropriate: { type: 'boolean', description: 'false ONLY if explicit, violent/gory, hateful or harassing. Indoor photos, desks and close-ups of litter or damage are appropriate.' },
    reason: { type: 'string', description: 'If not appropriate: one short, kind sentence to the resident. Else empty.' },
    faces: { type: 'array', items: { type: 'array', items: { type: 'integer' } }, description: 'Every visible human face as [ymin,xmin,ymax,xmax] 0-1000' },
    plates: { type: 'array', items: { type: 'array', items: { type: 'integer' } }, description: 'Every readable vehicle licence plate as [ymin,xmin,ymax,xmax] 0-1000' },
  },
  required: ['kind', 'appropriate', 'reason', 'faces', 'plates'],
};

const PROMPT = `A resident is reporting a problem to their city with this photo. Screen it before it is stored.
Classify what it is, decide if it's appropriate to keep as city evidence, and locate every human face and readable licence plate so they can be blurred.
Graffiti, litter, damage and messy scenes are fine: they are what people report. Indoor public places count too:
garbage on a table in a public library, a broken fixture in a transit station or rec centre. Whether it's the city's
job is decided later, not here. Only refuse genuinely explicit, violent, hateful or harassing images, selfies or portraits
that are about a person rather than a place, and screenshots or photos of documents.`;

export async function screenPhoto(photo: { data: Buffer; mime: string }): Promise<Screen> {
  if (!hasAI()) return { appropriate: true, reason: '', kind: 'street_scene', blur: [] };
  try {
    const r = await json<{ kind: Screen['kind']; appropriate: boolean; reason: string; faces: number[][]; plates: number[][] }>(
      MODELS.lite(),
      [{ inlineData: { mimeType: photo.mime, data: photo.data.toString('base64') } }, { text: PROMPT }],
      SCHEMA,
      0,
    );
    const boxes = [...(r.faces ?? []), ...(r.plates ?? [])].filter((b) => Array.isArray(b) && b.length === 4) as Screen['blur'];
    const blocked = ['explicit', 'violent', 'hateful', 'selfie_or_portrait', 'screenshot_or_document'].includes(r.kind);
    return {
      appropriate: r.appropriate !== false && !blocked,
      reason: r.reason || 'That photo can’t be used as a city report. Point the camera at the problem itself.',
      kind: r.kind,
      blur: boxes,
    };
  } catch (e) {
    // the screen failing never blocks a report; the main analysis still judges the photo
    console.error('screen failed', e);
    return { appropriate: true, reason: '', kind: 'other', blur: [] };
  }
}

/** Pixelate regions of a JPEG (faces, plates). Non-JPEGs and empty lists pass through untouched. */
export function blurRegions(photo: { data: Buffer; mime: string }, boxes: Screen['blur']): { data: Buffer; mime: string } {
  if (!boxes.length || !/jpe?g/.test(photo.mime)) return photo;
  const img = jpeg.decode(photo.data, { useTArray: true, maxMemoryUsageInMB: 512 });
  const { width: w, height: h, data } = img;
  for (const [y0, x0, y1, x1] of boxes) {
    // grow each box a little so edges of a face aren't left sharp
    const pad = 0.12;
    const bx0 = Math.max(0, Math.floor(((x0 - (x1 - x0) * pad) / 1000) * w));
    const bx1 = Math.min(w, Math.ceil(((x1 + (x1 - x0) * pad) / 1000) * w));
    const by0 = Math.max(0, Math.floor(((y0 - (y1 - y0) * pad) / 1000) * h));
    const by1 = Math.min(h, Math.ceil(((y1 + (y1 - y0) * pad) / 1000) * h));
    const cell = Math.max(6, Math.round(Math.min(bx1 - bx0, by1 - by0) / 7));
    for (let cy = by0; cy < by1; cy += cell)
      for (let cx = bx0; cx < bx1; cx += cell) {
        const ey = Math.min(by1, cy + cell);
        const ex = Math.min(bx1, cx + cell);
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = cy; y < ey; y++)
          for (let x = cx; x < ex; x++) {
            const o = (y * w + x) * 4;
            sum[0] += data[o];
            sum[1] += data[o + 1];
            sum[2] += data[o + 2];
            n++;
          }
        for (let y = cy; y < ey; y++)
          for (let x = cx; x < ex; x++) {
            const o = (y * w + x) * 4;
            data[o] = sum[0] / n;
            data[o + 1] = sum[1] / n;
            data[o + 2] = sum[2] / n;
          }
      }
  }
  return { data: Buffer.from(jpeg.encode({ data, width: w, height: h }, 85).data), mime: 'image/jpeg' };
}
