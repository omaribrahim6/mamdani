import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCity, setStatus, type ApiIssue, type ApiStats, type Status } from './api';

export interface MergeEvent { id: number; at: number }

// Polls the city every 8 s. Local status changes are kept on top of whatever the server says,
// so a preview without write access still behaves like the real console.
export function useCity() {
  const [issues, setIssues] = useState<ApiIssue[]>([]);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [live, setLive] = useState(false);
  const [merges, setMerges] = useState<MergeEvent[]>([]);
  const overrides = useRef(new Map<number, Partial<ApiIssue>>());
  const lastCounts = useRef(new Map<number, number>());

  const apply = useCallback((list: ApiIssue[]) => list.map((i) => ({ ...i, ...(overrides.current.get(i.id) ?? {}) })), []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const c = await loadCity();
      if (stop) return;
      const merged: MergeEvent[] = [];
      for (const i of c.issues) {
        const prev = lastCounts.current.get(i.id);
        if (prev !== undefined && i.reports > prev) merged.push({ id: i.id, at: Date.now() });
        lastCounts.current.set(i.id, i.reports);
      }
      if (merged.length) setMerges((m) => [...m.slice(-8), ...merged]);
      setIssues(apply(c.issues));
      setStats(c.stats);
      setLive(c.live);
    };
    void tick();
    const t = setInterval(tick, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [apply]);

  const changeStatus = useCallback(async (id: number, status: Status, note: string) => {
    const now = Date.now();
    const patch: Partial<ApiIssue> = { status, updatedAt: now, resolvedAt: status === 'resolved' ? now : null };
    overrides.current.set(id, { ...(overrides.current.get(id) ?? {}), ...patch });
    setIssues((list) => list.map((i) => (i.id === id ? { ...i, ...patch, events: [...i.events, { at: now, kind: 'status', note }] } : i)));
    try {
      const saved = await setStatus(id, status, note);
      if (saved) setIssues((list) => list.map((i) => (i.id === id ? saved : i)));
    } catch {
      /* keep the optimistic change; the next poll reconciles */
    }
  }, []);

  /** demo aid: pretend another resident just confirmed this issue */
  const simulateConfirm = useCallback((id: number) => {
    setIssues((list) => list.map((i) => (i.id === id ? { ...i, reports: i.reports + 1, lastReportedAt: Date.now() } : i)));
    setMerges((m) => [...m.slice(-8), { id, at: Date.now() }]);
  }, []);

  return { issues, stats, live, merges, changeStatus, simulateConfirm };
}
