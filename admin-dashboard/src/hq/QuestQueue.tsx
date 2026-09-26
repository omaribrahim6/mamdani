import { Brain, Check, ImageOff, MapPinOff, ShieldAlert, Swords, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { mediaUrl, type ApiIssue } from '../data/api';
import { category } from '../data/categories';
import { ago, ticketId } from '../data/view';
import { GAME, gameStatus, missingAddress, MOCK } from './game';

export type QuestAction = 'confirm' | 'address' | 'escalate' | 'dismiss';
export const XP_FOR: Record<QuestAction, number> = { confirm: 50, address: 30, escalate: 10, dismiss: 20 };

interface Props {
  quests: ApiIssue[];
  now: number;
  selectedId: number | null;
  addr: Record<number, string>;
  onSelect: (id: number) => void;
  onAction: (issue: ApiIssue, action: QuestAction, from: HTMLElement, value?: string) => void;
}

// "Field Quests": tickets the AI wasn't sure about (confidence < 50 %) or that never got a
// street address. Clearing one earns XP.
export function QuestQueue({ quests, now, selectedId, addr, onSelect, onAction }: Props) {
  return (
    <aside className="hq-panel flex min-h-0 flex-col rounded-2xl" aria-label="Field Quests triage queue">
      <div className="border-b border-slateblue-600/40 px-4 py-3">
        <h2 className="flex items-center justify-between font-display text-sm font-bold uppercase tracking-wide text-brand-glow">Field Quests <span className="rounded-full bg-brand/15 px-2 py-0.5 font-mono text-[11px] text-brand-glow ring-1 ring-brand/40">{quests.length}</span></h2>
        <p className="mt-0.5 text-[11px] text-slateblue-400">Low AI confidence (&lt; 50%) or missing address. Clear them for XP.</p>
      </div>
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {quests.map((q) => <QuestCard key={q.id} q={q} now={now} selected={q.id === selectedId} fixedAddr={addr[q.id]} onSelect={onSelect} onAction={onAction} />)}
        {quests.length === 0 && (
          <li className="rounded-xl bg-loot/10 p-6 text-center text-sm text-green-200 ring-1 ring-loot/30">
            <Check className="mx-auto mb-2" /> Queue cleared. Every quest is triaged.
          </li>
        )}
      </ul>
      <p className="border-t border-slateblue-600/40 px-4 py-2 text-[10px] text-slateblue-400">AI confidence shows demo values until the API sends Gemini's score.</p>
    </aside>
  );
}

function QuestCard({ q, now, selected, fixedAddr, onSelect, onAction }: { q: ApiIssue; now: number; selected: boolean; fixedAddr?: string; onSelect: (id: number) => void; onAction: Props['onAction'] }) {
  const [editing, setEditing] = useState(false);
  const [street, setStreet] = useState('');
  const [imgOk, setImgOk] = useState(true);
  const conf = MOCK.aiConfidence(q);
  const noAddr = missingAddress(q) && !fixedAddr;
  const gs = gameStatus(q);
  const cat = category(q.category);
  const photo = mediaUrl(q.mediaId);

  return (
    <li
      className={`rounded-xl bg-midnight-900/80 p-3 ring-1 transition ${selected ? 'hq-glow ring-brand' : 'ring-slateblue-600/40 hover:ring-slateblue-400/60'}`}
      onClick={() => onSelect(q.id)}
    >
      <div className="flex gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-midnight-950 ring-1 ring-slateblue-600/50">
          {photo && imgOk ? <img src={photo} alt="" className="h-full w-full object-cover" onError={() => setImgOk(false)} /> : <ImageOff size={18} className="m-auto mt-5 text-slateblue-400" />}
          <span className="absolute bottom-0 left-0 right-0 h-1" style={{ background: cat.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ color: GAME[gs].color, background: `${GAME[gs].color}22` }}>{gs === 'boss' ? <Swords size={10} className="mr-0.5 inline" /> : null}{GAME[gs].short}</span>
            <span className="font-mono text-[10px] text-slateblue-400">{ticketId(q)}</span>
            <span className="ml-auto font-mono text-[10px] text-slateblue-400">P{q.priority}</span>
          </div>
          <p className="mt-1 truncate text-[13px] font-semibold text-white">{q.title}</p>
          <p className="truncate text-[11px] text-slateblue-400">{fixedAddr ?? (noAddr ? 'No street address' : q.address)} · {ago(q.lastReportedAt, now)}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px]">
        {conf < 0.5 && (
          <span className="flex items-center gap-1 rounded-full bg-quest/15 px-2 py-0.5 text-yellow-200 ring-1 ring-quest/40"><Brain size={11} /> AI {Math.round(conf * 100)}% sure it's {cat.label.toLowerCase()}</span>
        )}
        {noAddr && <span className="flex items-center gap-1 rounded-full bg-boss/15 px-2 py-0.5 text-red-200 ring-1 ring-boss/40"><MapPinOff size={11} /> Address missing</span>}
        {q.accessibility.barrier && <span className="flex items-center gap-1 rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-fuchsia-200 ring-1 ring-fuchsia-500/40"><ShieldAlert size={11} /> Barrier</span>}
      </div>

      {editing ? (
        <form className="mt-2.5 flex gap-1.5" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (street.trim()) { onAction(q, 'address', e.currentTarget, street.trim()); setEditing(false); } }}>
          <input autoFocus value={street} onChange={(e) => setStreet(e.target.value)} placeholder="e.g. 250 Bank St, Centretown" className="flex-1 rounded-lg border border-slateblue-600 bg-midnight-950 px-2 py-1.5 text-xs text-white placeholder:text-slateblue-400 focus:border-brand focus:outline-none" aria-label="Street address" />
          <button type="submit" className="rounded-lg bg-brand px-2.5 text-xs font-semibold text-white hover:bg-brand-glow">Save +{XP_FOR.address}</button>
        </form>
      ) : (
        <div className="mt-2.5 grid grid-cols-2 gap-1.5" onClick={(e) => e.stopPropagation()}>
          {conf < 0.5 && <QuickBtn tone="brand" icon={<Check size={12} />} label="Confirm AI call" xp={XP_FOR.confirm} onClick={(el) => onAction(q, 'confirm', el)} />}
          {noAddr && <QuickBtn tone="brand" icon={<MapPinOff size={12} />} label="Add address" xp={XP_FOR.address} onClick={() => setEditing(true)} />}
          {gs !== 'boss' && <QuickBtn tone="boss" icon={<Swords size={12} />} label="Escalate to boss" xp={XP_FOR.escalate} onClick={(el) => onAction(q, 'escalate', el)} />}
          <QuickBtn tone="muted" icon={<Trash2 size={12} />} label="False positive" xp={XP_FOR.dismiss} onClick={(el) => onAction(q, 'dismiss', el)} />
        </div>
      )}
    </li>
  );
}

function QuickBtn({ tone, icon, label, xp, onClick }: { tone: 'brand' | 'boss' | 'muted'; icon: React.ReactNode; label: string; xp: number; onClick: (el: HTMLElement) => void }) {
  const cls = tone === 'brand' ? 'bg-brand/90 text-white hover:bg-brand' : tone === 'boss' ? 'bg-boss/15 text-red-200 ring-1 ring-boss/40 hover:bg-boss/25' : 'bg-slateblue-700 text-slate-300 hover:bg-slateblue-600';
  return (
    <button type="button" onClick={(e) => onClick(e.currentTarget)} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${cls}`}>
      {icon}{label}<span className="font-mono opacity-80">+{xp}</span>
    </button>
  );
}
