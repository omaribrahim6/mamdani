// Mamdani's voice. POST { text } → audio/mpeg from ElevenLabs. The key never leaves the server.
// 204 when no key is configured: the client falls back to the browser's speech synthesis.

const cache = new Map<string, ArrayBuffer>();

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return new Response(null, { status: 204 });
  const { text } = (await req.json()) as { text?: string };
  const line = (text ?? '').slice(0, 220);
  if (!line) return new Response(null, { status: 204 });

  const hit = cache.get(line);
  if (hit) return new Response(hit, { headers: { 'Content-Type': 'audio/mpeg' } });

  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: line,
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    console.error('elevenlabs', r.status, await r.text());
    return new Response(null, { status: 204 });
  }
  const audio = await r.arrayBuffer();
  cache.set(line, audio);
  return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } });
}
