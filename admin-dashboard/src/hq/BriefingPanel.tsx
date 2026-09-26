import { Award, Crown, Lightbulb, Medal, Star, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiIssue, ApiStats } from '../data/api';
import { useStages } from '../gl/GLProvider';
import { BriefingPortrait } from '../mayor/briefing';
import { GAME, gameStatus, leaderboard } from './game';

const RANK_ICON = [Crown, Trophy, Medal, Award, Star, Star];
const RANK_TONE = ['text-yellow-300', 'text-slate-200', 'text-amber-600', 'text-brand-glow', 'text-slateblue-400', 'text-slateblue-400'];

function briefing(issues: ApiIssue[], stats: ApiStats | null, now: number) {
  const day = issues.filter((i) => now - i.lastReportedAt < 86_400_000);
  const boss = issues.filter((i) => gameStatus(i) === 'boss');
  const barriers = issues.filter((i) => i.status !== 'resolved' && i.accessibility.barrier).length;
  const top = [...boss].sort((a, b) => b.priority - a.priority)[0];
  const cats = new Map<string, number>();
  for (const i of day) cats.set(i.category, (cats.get(i.category) ?? 0) + 1);
  const busiest = [...cats.entries()].sort((a, b) => b[1] - a[1])[0];
  return [
    `${day.length} reports came in over the last 24 h${busiest ? `, mostly ${busiest[0].replace('_', ' ')}s (${busiest[1]})` : ''}.`,
    `${boss.length} Critical Boss Battles are live${top ? `; the toughest is “${top.title}” at ${top.address.split(',')[0]}` : ''}.`,
    `${stats?.resolvedToday ?? 0} looted today · ${barriers} accessibility barriers still open.`,
  ];
}

const TIPS = [
  'Tip: clear low-confidence quests first. Every one you confirm teaches the AI.',
  'Tip: a missing address is a quick +30 XP. Drop the street in and the crew can roll.',
  'Tip: Boss Battles glow red on the map. Click a beam and I’ll walk you there.',
  'Tip: search in plain words, like “accessibility barriers downtown”.',
];

export function BriefingPanel({ issues, stats, now, userName }: { issues: ApiIssue[]; stats: ApiStats | null; now: number; userName: string }) {
  const { back } = useStages();
  const canvas = useRef<HTMLCanvasElement>(null);
  const portrait = useRef<BriefingPortrait | null>(null);
  const lines = useMemo(() => briefing(issues, stats, now), [issues, stats, now]);
  const board = useMemo(() => leaderboard(issues), [issues]);
  const [tip, setTip] = useState(0);
  const hour = new Date(now).getHours();
  const greet = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const first = userName.split(' ')[0];

  useEffect(() => { const t = setInterval(() => setTip((x) => (x + 1) % TIPS.length), 9000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!back || !canvas.current) return;
    let p: BriefingPortrait;
    try { p = new BriefingPortrait(canvas.current); } catch { return; }
    portrait.current = p;
    const ro = new ResizeObserver(() => p.resize());
    ro.observe(canvas.current);
    return () => { ro.disconnect(); p.dispose(); portrait.current = null; };
  }, [back]);
  useEffect(() => { portrait.current?.say(TIPS[tip]); }, [tip]);

  return (
    <aside className="flex min-h-0 flex-col gap-3">
      <section className="hq-panel rounded-2xl p-4" aria-label="AI Daily Operations Briefing">
        <div className="flex gap-3">
          <div className="relative h-32 w-28 shrink-0 overflow-hidden rounded-xl bg-[radial-gradient(circle_at_50%_30%,#2b4d86,#0a1224_72%)] ring-1 ring-brand/30">
            {back && <canvas ref={canvas} className="h-full w-full" aria-hidden="true" />}
            <span className="absolute bottom-1 left-1 rounded bg-midnight-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-brand-glow">Mamdani</span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-[15px] font-bold text-white">{greet}, {first}! 👋</p>
            <div className="relative mt-2 rounded-xl rounded-tl-sm bg-brand/12 p-2.5 text-[12px] leading-relaxed text-slate-200 ring-1 ring-brand/30">
              <Lightbulb size={12} className="mb-0.5 mr-1 inline text-yellow-300" />{TIPS[tip]}
            </div>
          </div>
        </div>
        <h2 className="mt-4 flex items-center justify-between font-display text-sm font-bold uppercase tracking-wide text-brand-glow">AI Daily Operations Briefing <span className="font-sans text-[10px] font-normal normal-case text-slateblue-400">last 24 h</span></h2>
        <ul className="mt-2 space-y-1.5">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-200">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: [GAME.quest.color, GAME.boss.color, GAME.loot.color][i] }} />{l}
            </li>
          ))}
        </ul>
      </section>

      <section className="hq-panel flex min-h-0 flex-1 flex-col rounded-2xl p-4" aria-label="District leaderboard">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-brand-glow">District Leaderboard</h2>
        <p className="text-[11px] text-slateblue-400">XP from loot cleared and quests underway</p>
        <ol className="mt-3 space-y-2 overflow-y-auto">
          {board.map((d, i) => {
            const Icon = RANK_ICON[i];
            const max = board[0]?.xp || 1;
            return (
              <li key={d.name} className="rounded-xl bg-midnight-900/70 p-2.5 ring-1 ring-slateblue-600/40">
                <div className="flex items-center gap-2.5">
                  <span className={`grid h-7 w-7 place-items-center rounded-lg bg-midnight-950 ${RANK_TONE[i]}`}><Icon size={15} /></span>
                  <span className="flex-1 truncate text-[13px] font-semibold text-slate-100">{d.name}</span>
                  <span className="font-mono text-[12px] text-brand-glow">{d.xp} XP</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-midnight-950"><div className="hq-bar h-full rounded-full" style={{ width: `${(d.xp / max) * 100}%` }} /></div>
                  <span className="text-[10px] text-slateblue-400">{d.resolved} loot · {d.open} open</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </aside>
  );
}
