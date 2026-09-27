import { genai } from '@/lib/ai';

export const maxDuration = 60;

// POST /api/speak {text} → audio/wav in Mamdani's voice (Gemini TTS, the same Orus voice the
// phone's Gemini Live conversation uses). The dashboard plays it and moves his mouth to it.
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  const line = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
  const ai = genai();
  if (!line || !ai) return Response.json({ error: 'Nothing to say.' }, { status: 400 });
  try {
    const r = await ai.models.generateContent({
      model: process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-tts',
      contents: [{ role: 'user', parts: [{ text: `Say this warmly and briskly, like a cheerful city inspector who loves his job: ${line}` }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_LIVE_VOICE || 'Orus' } } },
      },
    });
    const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error('no audio');
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000);
    return new Response(new Uint8Array(wav(Buffer.from(part.inlineData.data, 'base64'), rate)), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error('speak failed', e);
    return Response.json({ error: 'Mamdani lost his voice.' }, { status: 502 });
  }
}

/** 16-bit mono PCM → a WAV file */
function wav(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
