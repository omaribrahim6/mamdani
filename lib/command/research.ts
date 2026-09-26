import { genai, MODELS } from '../ai';

// Outside knowledge, grounded: Gemini with Google Search answers questions the city's record
// can't (weather, standards, typical repair costs, by-laws) and hands back its sources.

export interface Source {
  title: string;
  uri: string;
}

export async function research(question: string): Promise<{ answer: string; sources: Source[] }> {
  const ai = genai();
  if (!ai) return { answer: 'Web research is unavailable: no Gemini credentials are configured.', sources: [] };
  const res = await ai.models.generateContent({
    model: MODELS.decide(),
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `You research facts for City of Ottawa infrastructure staff. Answer concisely (under 120 words), with concrete numbers and dates where they exist. Prefer official sources (ottawa.ca, ontario.ca, Environment Canada). Today is ${new Date().toDateString()}.\n\nQuestion: ${question}`,
          },
        ],
      },
    ],
    config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
  });
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ title: c.web?.title || c.web?.domain || new URL(uri).hostname, uri });
  }
  return { answer: res.text ?? '', sources: sources.slice(0, 6) };
}
