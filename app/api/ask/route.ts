import { ask, type AgentEvent, type AskContext, type ChatTurn } from '@/lib/command/agent';

export const maxDuration = 120;

// POST /api/ask {messages, context} → text/event-stream of AgentEvents (dashboard chat)
export async function POST(req: Request) {
  const body = (await req.json()) as { messages?: ChatTurn[]; context?: AskContext };
  const messages = (body.messages ?? []).filter((m) => m.text?.trim());
  if (!messages.length) return Response.json({ error: 'Ask something.' }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: AgentEvent) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await ask(messages, body.context ?? {}, emit);
      } catch (e) {
        console.error('ask failed', e);
        emit({ type: 'error', message: 'Mamdani lost his train of thought. Try again?' });
        emit({ type: 'done' });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' } });
}
