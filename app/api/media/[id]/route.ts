import type { NextRequest } from 'next/server';
import { store } from '@/lib/store';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/media/[id]'>) {
  const { id } = await ctx.params;
  const m = await store.getMedia(id);
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(m.data), { headers: { 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
}
