import { store } from '@/lib/store';

// GET /api/issues            → every issue, highest priority first
// GET /api/issues?since=<ms> → only issues changed after that time (the Command Center polls this)
export async function GET(req: Request) {
  const since = Number(new URL(req.url).searchParams.get('since'));
  const now = Date.now();
  const issues = since ? await store.changedSince(since) : await store.listIssues();
  return Response.json({ issues, now, store: store.kind });
}
