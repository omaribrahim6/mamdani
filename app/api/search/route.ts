import { embedText } from '@/lib/ai';
import { query } from '@/lib/command/record';
import { store } from '@/lib/store';

// GET /api/search?q=water+across+the+crosswalk
// Semantic search over evidence photos (Gemini embeddings in pgvector), topped up with keyword
// matches on the written record so issues without a photo are still found.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (!q) return Response.json({ results: [] });
  const [semantic, keyword] = await Promise.all([
    embedText(q)
      .then((v) => (v ? store.similar(v, 8) : []))
      .catch(() => []),
    query({ text: q, limit: 8 }),
  ]);
  const results = new Map<number, { id: number; score: number; via: 'photo' | 'text' }>();
  for (const m of semantic) if (m.similarity > 0.12) results.set(m.issue.id, { id: m.issue.id, score: m.similarity, via: 'photo' });
  for (const id of keyword.ids) if (!results.has(id)) results.set(id, { id, score: 0, via: 'text' });
  return Response.json({ results: [...results.values()] });
}
