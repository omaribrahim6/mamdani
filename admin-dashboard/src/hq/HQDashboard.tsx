import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useMemo, useState } from 'react';
import type { ApiIssue } from '../data/api';
import { useCity } from '../data/useCity';
import { useStages } from '../gl/GLProvider';
import { BriefingPanel } from './BriefingPanel';
import { healthScore, needsTriage, queryIssues } from './game';
import { OpsMap } from './OpsMap';
import { QuestQueue, XP_FOR, type QuestAction } from './QuestQueue';
import { TopBar } from './TopBar';
import { useXP } from './useXP';
import './hq.css';

// City Command HQ: the gamified operations view. Live data from the city record (/api/issues,
// /api/stats on the deployed Next app); operator XP and triage choices are local to this browser
// unless writes are enabled (VITE_ALLOW_WRITES=1).
export function HQDashboard() {
  const { user, logout } = useAuth0();
  const { fx } = useStages();
  const { issues, stats, live, changeStatus } = useCity();
  const { xp, award, pops } = useXP();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [boosted, setBoosted] = useState<Set<number>>(new Set());
  const [addr, setAddr] = useState<Record<number, string>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => { document.documentElement.classList.add('hq'); return () => document.documentElement.classList.remove('hq'); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  // local triage decisions layered over the record
  const city = useMemo<ApiIssue[]>(() => issues.map((i) => ({
    ...i,
    address: addr[i.id] ?? i.address,
    priority: boosted.has(i.id) ? Math.max(i.priority, 75) : i.priority,
  })), [issues, addr, boosted]);

  const results = useMemo(() => queryIssues(query, city), [query, city]);
  const onMap = results ?? city;
  const quests = useMemo(() => city
    .filter((i) => !confirmed.has(i.id) && needsTriage(i, addr))
    .filter((i) => !results || results.some((r) => r.id === i.id))
    .sort((a, b) => b.priority - a.priority), [city, confirmed, addr, results]);

  const onAction = (issue: ApiIssue, action: QuestAction, from: HTMLElement, value?: string) => {
    const target = document.getElementById('hq-xp');
    const b = from.getBoundingClientRect();
    if (fx && target) fx.burst({ x: b.left + b.width / 2, y: b.top + b.height / 2 }, target, action === 'escalate' ? '#EF4444' : action === 'dismiss' ? '#94a3b8' : '#3B82F6');
    award(XP_FOR[action]);
    if (action === 'confirm') setConfirmed((s) => new Set(s).add(issue.id));
    if (action === 'address' && value) setAddr((a) => ({ ...a, [issue.id]: value }));
    if (action === 'escalate') { setBoosted((s) => new Set(s).add(issue.id)); setConfirmed((s) => new Set(s).add(issue.id)); }
    if (action === 'dismiss') void changeStatus(issue.id, 'resolved', 'Closed: false positive (Field Quest)');
  };

  const name = user?.name ?? 'Operator';
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-midnight-950/60 font-sans text-slate-100">
      <TopBar health={healthScore(city)} xp={xp} pops={pops} query={query} onQuery={setQuery} resultCount={results ? results.length : null} live={live}
        userName={name} onSignOut={() => logout({ logoutParams: { returnTo: window.location.origin } })} />
      <main className="grid min-h-0 grid-cols-[minmax(290px,340px)_minmax(0,1fr)_minmax(320px,380px)] gap-3 p-3">
        <BriefingPanel issues={city} stats={stats} now={now} userName={name} />
        <OpsMap issues={onMap} selectedId={selectedId} onPick={setSelectedId} filtered={!!results} />
        <QuestQueue quests={quests} now={now} selectedId={selectedId} addr={addr} onSelect={setSelectedId} onAction={onAction} />
      </main>
    </div>
  );
}
