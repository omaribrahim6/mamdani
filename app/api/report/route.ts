import { intake } from '@/lib/intake';

export const maxDuration = 60;

// POST multipart: photo (jpeg), video (optional webm/mp4), lat, lng, hint (optional text)
export async function POST(req: Request) {
  const form = await req.formData();
  const photo = form.get('photo');
  if (!(photo instanceof File)) return Response.json({ error: 'Add a photo of the problem.' }, { status: 400 });
  const video = form.get('video');
  const lat = Number(form.get('lat'));
  const lng = Number(form.get('lng'));
  if (!isFinite(lat) || !isFinite(lng)) return Response.json({ error: 'Location is missing.' }, { status: 400 });

  try {
    const { analysis, result } = await intake({
      photo: { data: Buffer.from(await photo.arrayBuffer()), mime: photo.type || 'image/jpeg' },
      video: video instanceof File && video.size > 0 ? { data: Buffer.from(await video.arrayBuffer()), mime: video.type || 'video/webm' } : null,
      lat,
      lng,
      hint: String(form.get('hint') ?? '') || undefined,
    });
    return Response.json({ analysis, result });
  } catch (e) {
    console.error('intake failed', e);
    return Response.json({ error: 'The analysis service didn’t respond. Try again in a moment.' }, { status: 502 });
  }
}
