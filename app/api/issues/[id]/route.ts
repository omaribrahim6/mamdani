import type { NextRequest } from 'next/server';
import { store } from '@/lib/store';
import type { Status } from '@/lib/types';

const STATUSES: Status[] = ['new', 'assigned', 'in_progress', 'resolved'];

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/issues/[id]'>) {
  const { id } = await ctx.params;
  const found = await store.getIssue(Number(id));
  if (!found) return Response.json({ error: 'No issue with that number.' }, { status: 404 });
  return Response.json(found);
}

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/issues/[id]'>) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { status?: Status; note?: string };
  if (!body.status || !STATUSES.includes(body.status)) return Response.json({ error: 'Unknown status.' }, { status: 400 });
  const issue = await store.setStatus(Number(id), body.status, body.note ?? '');
  if (!issue) return Response.json({ error: 'No issue with that number.' }, { status: 404 });
  return Response.json({ issue });
}
