import type { NextRequest } from 'next/server';
import { workPlan } from '@/lib/command/assist';

export const maxDuration = 60;

// GET /api/issues/1842/plan → Gemini's work plan: crew, cost range, materials, resident update
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/issues/[id]/plan'>) {
  const { id } = await ctx.params;
  try {
    const plan = await workPlan(Number(id));
    if (!plan) return Response.json({ error: 'No plan for that work order.' }, { status: 404 });
    return Response.json(plan);
  } catch (e) {
    console.error('plan failed', e);
    return Response.json({ error: 'Planning failed.' }, { status: 502 });
  }
}
