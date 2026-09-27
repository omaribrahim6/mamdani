import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActivityPoint, CityStats, Issue, Status } from '@shared/types';
import { api, type Brief } from './api';
import { category, STATUS_SHORT, street } from './format';
import { fx } from '../fx/overlay';

// Everything the dashboard knows, kept live: issues poll every few seconds (only what changed),
// stats and activity less often. Also the dashboard's shared intents — which issue is open, what
// the map should show, a question waiting for Mamdani — so any panel can drive any other.

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'info' | 'new' | 'good' | 'bad';
  issueId?: number;
}

export interface Focus {
  key: number;
  ids: number[];
  label: string;
  mode: 'highlight' | 'route';
}

interface City {
  issues: Issue[];
  byId: Map<number, Issue>;
  stats: CityStats | null;
  activity: ActivityPoint[];
  loaded: boolean;
  offline: boolean;
  storeKind: 'tiger' | 'memory' | null;
  lastSync: number;
  fresh: Set<number>;
  selectedId: number | null;
  open: (id: number | null) => void;
  focus: Focus | null;
  show: (ids: number[], label: string, mode?: Focus['mode']) => void;
  clearFocus: () => void;
  setStatus: (ids: number[], status: Status, note?: string) => Promise<void>;
  brief: Brief | null;
  briefState: 'idle' | 'loading' | 'error';
  loadBrief: (refresh?: boolean) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  prompt: { key: number; text: string } | null;
  askMamdani: (text: string) => void;
}

const Ctx = createContext<City | null>(null);

export function useCity() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCity outside CityProvider');
  return c;
}

let seq = 1;

export function CityProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map<number, Issue>>(new Map());
  const [stats, setStats] = useState<CityStats | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [storeKind, setStoreKind] = useState<City['storeKind']>(null);
  const [lastSync, setLastSync] = useState(0);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focus, setFocusState] = useState<Focus | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefState, setBriefState] = useState<City['briefState']>('idle');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prompt, setPrompt] = useState<City['prompt']>(null);
  const since = useRef(0);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = seq++;
    setToasts((l) => [...l.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 6500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((l) => l.filter((x) => x.id !== id)), []);

  // issues: full list once, then only what changed
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const first = !since.current;
        const r = await api.issues(since.current || undefined);
        if (!alive) return;
        setStoreKind(r.store);
        setOffline(false);
        setLastSync(Date.now());
        if (first) {
          setMap(new Map(r.issues.map((i) => [i.id, i])));
          setLoaded(true);
        } else if (r.issues.length) {
          setMap((prev) => {
            const next = new Map(prev);
            for (const i of r.issues) {
              const old = prev.get(i.id);
              if (!old) {
                toast({ tone: 'new', title: `New report · ${category(i.category).label}`, body: `${i.title} — ${street(i.address)}`, issueId: i.id });
                setFresh((f) => new Set(f).add(i.id));
              } else if (i.reports > old.reports) {
                toast({ tone: 'info', title: `Another resident confirmed #${i.id}`, body: `${i.reports} reports · ${street(i.address)}`, issueId: i.id });
              }
              next.set(i.id, i);
            }
            return next;
          });
        }
        since.current = r.now;
      } catch {
        if (alive) setOffline(true);
      }
      if (alive) timer = window.setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [toast]);

  // stats and activity: slower
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.stats().then((s) => alive && setStats(s)).catch(() => {});
      api.activity(7).then((a) => alive && setActivity(a.points)).catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // a new issue refreshes the activity right away, so the charts pulse with it
  useEffect(() => {
    if (fresh.size) api.activity(7).then((a) => setActivity(a.points)).catch(() => {});
  }, [fresh]);

  const loadBrief = useCallback((refresh = false) => {
    setBriefState('loading');
    api
      .brief(refresh)
      .then((b) => {
        setBrief(b);
        setBriefState('idle');
      })
      .catch(() => setBriefState('error'));
  }, []);

  useEffect(() => loadBrief(), [loadBrief]);

  const setStatus = useCallback(
    async (ids: number[], status: Status, note = '') => {
      // a fixed work order gets a sweep across wherever it's showing (queue row, drawer)
      if (status === 'resolved') for (const id of ids) document.querySelectorAll<HTMLElement>(`[data-issue="${id}"]`).forEach((el) => fx()?.sweep(el.getBoundingClientRect(), '#12995a'));
      // optimistic: the table moves now, the record catches up
      setMap((prev) => {
        const next = new Map(prev);
        for (const id of ids) {
          const i = prev.get(id);
          if (i) next.set(id, { ...i, status });
        }
        return next;
      });
      try {
        const updated = await Promise.all(ids.map((id) => api.setStatus(id, status, note || `${STATUS_SHORT[status]} — from Mamdani Command`)));
        setMap((prev) => {
          const next = new Map(prev);
          for (const i of updated) next.set(i.id, i);
          return next;
        });
        toast({
          tone: 'good',
          title: ids.length === 1 ? `#${ids[0]} → ${STATUS_SHORT[status]}` : `${ids.length} work orders → ${STATUS_SHORT[status]}`,
          body: 'Saved to the city record. Residents see it in their app.',
        });
      } catch {
        toast({ tone: 'bad', title: 'That change didn’t save', body: 'The record is unchanged. Try again in a moment.' });
        api.issues().then((r) => setMap(new Map(r.issues.map((i) => [i.id, i]))));
      }
    },
    [toast],
  );

  const issues = useMemo(() => [...map.values()].sort((a, b) => b.priority - a.priority), [map]);

  const value: City = {
    issues,
    byId: map,
    stats,
    activity,
    loaded,
    offline,
    storeKind,
    lastSync,
    fresh,
    selectedId,
    open: setSelectedId,
    focus,
    show: useCallback((ids, label, mode = 'highlight') => setFocusState({ key: seq++, ids, label, mode }), []),
    clearFocus: useCallback(() => setFocusState(null), []),
    setStatus,
    brief,
    briefState,
    loadBrief,
    toasts,
    toast,
    dismiss,
    prompt,
    askMamdani: useCallback((text: string) => setPrompt({ key: seq++, text }), []),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
