import { Heart, LogOut, Search, Sparkles, X, Zap } from 'lucide-react';
import { healthLabel, level } from './game';

interface Props {
  health: number;
  xp: number;
  pops: Array<{ id: number; amount: number }>;
  query: string;
  onQuery: (q: string) => void;
  resultCount: number | null;
  live: boolean;
  userName: string;
  onSignOut: () => void;
}

export function TopBar({ health, xp, pops, query, onQuery, resultCount, live, userName, onSignOut }: Props) {
  const lv = level(xp);
  const tone = health >= 70 ? 'from-emerald-400 to-cyan-400' : health >= 50 ? 'from-amber-400 to-yellow-300' : 'from-rose-500 to-orange-400';
  return (
    <header className="flex items-center gap-5 border-b border-slateblue-600/40 bg-midnight-900/85 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand/15 text-brand ring-1 ring-brand/40"><Zap size={18} /></div>
        <div className="leading-tight">
          <p className="font-display text-[17px] font-black tracking-tight text-white">City Command HQ</p>
          <p className="text-[11px] text-slateblue-400">Ottawa · powered by Mamdani</p>
        </div>
      </div>

      <div className="w-64" aria-label={`City Health Score ${health} percent, ${healthLabel(health)}`}>
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 font-semibold text-slate-200"><Heart size={12} className="text-rose-400" /> City Health Score</span>
          <span className="font-mono text-white">{health}% <span className="text-emerald-300">{healthLabel(health)}</span></span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-midnight-950 ring-1 ring-slateblue-600/50">
          <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-[width] duration-700`} style={{ width: `${health}%` }} />
        </div>
      </div>

      <label className="relative flex flex-1 items-center">
        <Search size={16} className="pointer-events-none absolute left-3 text-slateblue-400" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Query city data using AI… e.g. “boss battles on Bank St” or “open potholes”"
          className="w-full rounded-xl border border-slateblue-600/60 bg-midnight-950/80 py-2.5 pl-9 pr-24 text-sm text-slate-100 placeholder:text-slateblue-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          aria-label="Query city data"
        />
        <span className="pointer-events-none absolute right-3 flex items-center gap-1 text-[11px] text-brand-glow"><Sparkles size={12} />{resultCount === null ? 'AI search' : `${resultCount} found`}</span>
        {query && <button type="button" onClick={() => onQuery('')} className="absolute right-24 rounded p-1 text-slateblue-400 hover:text-white" aria-label="Clear search"><X size={14} /></button>}
      </label>

      <div className="relative flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="text-[11px] text-slateblue-400">Lv {lv.n} · {lv.title}</p>
          <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-midnight-950">
            <div className="hq-bar h-full rounded-full" style={{ width: `${(lv.into / lv.need) * 100}%` }} />
          </div>
        </div>
        <div id="hq-xp" className="rounded-lg bg-brand/15 px-2.5 py-1.5 font-mono text-sm font-semibold text-brand-glow ring-1 ring-brand/40">{xp} XP</div>
        {pops.map((p) => <span key={p.id} className="hq-xp-pop pointer-events-none absolute -top-1 right-3 font-mono text-sm font-bold text-emerald-300">+{p.amount}</span>)}
      </div>

      <div className="flex items-center gap-2 border-l border-slateblue-600/40 pl-4">
        <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400' : 'bg-slateblue-400'}`} title={live ? 'Live city record' : 'Offline snapshot'} />
        <span className="text-xs text-slate-300">{userName}</span>
        <button type="button" onClick={onSignOut} className="rounded-md p-1.5 text-slateblue-400 hover:bg-slateblue-700 hover:text-white" aria-label="Sign out"><LogOut size={15} /></button>
      </div>
    </header>
  );
}
