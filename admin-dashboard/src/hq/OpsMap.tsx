import { Crosshair, Swords, Trophy, Map as MapIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ApiIssue } from '../data/api';
import { ticketId } from '../data/view';
import { CityTwin } from '../gl/cityTwin';
import { useStages } from '../gl/GLProvider';
import { GAME, gameStatus } from './game';

interface Props { issues: ApiIssue[]; selectedId: number | null; onPick: (id: number | null) => void; filtered: boolean }

// The interactive operations map: the Ottawa digital twin, with every beam coloured by its
// game status (red boss battle, yellow quest, green loot).
export function OpsMap({ issues, selectedId, onPick, filtered }: Props) {
  const { back } = useStages();
  const host = useRef<HTMLDivElement>(null);
  const twin = useRef<CityTwin | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ issue: ApiIssue; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!back || !host.current) return;
    const tw = new CityTwin(host.current, (ids) => pick.current(ids[0] ?? null));
    tw.colorFor = (i) => GAME[gameStatus(i)].color;
    let last = '';
    tw.onFocus = (p) => { const k = p ? `${Math.round(p.x)},${Math.round(p.y)}` : ''; if (k !== last) { last = k; setFocus(p); } };
    tw.onHover = (issue, p) => setHover(issue && p ? { issue, ...p } : null);
    twin.current = tw;
    const off = back.add(tw);
    return () => { off(); twin.current = null; };
  }, [back]);
  useEffect(() => { twin.current?.setIssues(issues); }, [issues, back]);
  useEffect(() => { twin.current?.setSelected(selectedId); }, [selectedId, back]);

  const counts = { boss: 0, quest: 0, loot: 0 };
  for (const i of issues) counts[gameStatus(i)]++;
  const selected = issues.find((i) => i.id === selectedId);

  return (
    <section className="hq-panel relative flex min-h-0 flex-col overflow-hidden rounded-2xl" aria-label="Interactive operations map">
      <div className="flex items-center justify-between border-b border-slateblue-600/40 px-4 py-2.5">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-brand-glow"><MapIcon size={15} /> Operations Map <span className="font-sans text-[11px] font-normal normal-case text-slateblue-400">downtown Ottawa · live</span></h2>
        <div className="flex gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 rounded-full bg-boss/15 px-2.5 py-1 text-red-300 ring-1 ring-boss/40"><Swords size={12} /> {counts.boss} Boss Battles</span>
          <span className="flex items-center gap-1.5 rounded-full bg-quest/15 px-2.5 py-1 text-yellow-200 ring-1 ring-quest/40"><Crosshair size={12} /> {counts.quest} Quests</span>
          <span className="flex items-center gap-1.5 rounded-full bg-loot/15 px-2.5 py-1 text-green-300 ring-1 ring-loot/40"><Trophy size={12} /> {counts.loot} Loot</span>
        </div>
      </div>
      <div ref={host} className="relative min-h-0 flex-1 cursor-grab touch-none">
        {!back && <div className="absolute inset-0 grid place-items-center text-sm text-slateblue-400">The 3D map needs WebGL.</div>}
        {filtered && <span className="absolute left-3 top-3 rounded-lg bg-brand/20 px-2.5 py-1 text-[11px] font-semibold text-brand-glow ring-1 ring-brand/40">Showing search results</span>}
        {selected && focus && (
          <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+14px)]" style={{ left: focus.x, top: focus.y }}>
            <div className="rounded-lg border-l-4 bg-midnight-950/95 px-3 py-2 text-xs shadow-xl" style={{ borderColor: GAME[gameStatus(selected)].color }}>
              <p className="font-mono text-[10px] text-slateblue-400">{ticketId(selected)} · {GAME[gameStatus(selected)].label}</p>
              <p className="max-w-56 truncate font-semibold text-white">{selected.title}</p>
            </div>
          </div>
        )}
        {hover && hover.issue.id !== selectedId && (
          <div className="pointer-events-none absolute max-w-64 rounded-lg bg-midnight-950/95 px-3 py-2 text-xs ring-1 ring-slateblue-600" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <p className="font-mono text-[10px]" style={{ color: GAME[gameStatus(hover.issue)].color }}>{GAME[gameStatus(hover.issue)].label}</p>
            <p className="font-semibold text-white">{hover.issue.title}</p>
            <p className="text-slateblue-400">{hover.issue.address} · {hover.issue.reports} residents</p>
          </div>
        )}
        <p className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-slateblue-400">© OpenStreetMap contributors</p>
        <p className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-slateblue-400">drag to orbit · scroll to zoom · click a beam</p>
      </div>
    </section>
  );
}
