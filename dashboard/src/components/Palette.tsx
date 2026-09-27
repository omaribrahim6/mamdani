import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowRight, Camera, CornerDownLeft, FileText, MessageSquare, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useCity } from '../lib/city';
import { category, STATUS_SHORT, street } from '../lib/format';
import { go, type Page } from '../lib/router';
import { CategoryIcon } from './ui';
import './palette.css';

// Ctrl K: jump to any work order by number, street or words; describe a problem and the photo
// search (Gemini embeddings in pgvector) finds evidence that looks like it; go anywhere; or hand
// the question to Mamdani.

type Item =
  | { kind: 'issue'; id: number; via?: 'photo' | 'text'; score?: number }
  | { kind: 'page'; page: Page; label: string }
  | { kind: 'ask'; text: string };

const PAGES: Array<{ page: Page; label: string }> = [
  { page: 'command', label: 'Command overview' },
  { page: 'map', label: 'Live map' },
  { page: 'queue', label: 'Work queue' },
  { page: 'analytics', label: 'Analytics' },
  { page: 'brief', label: 'Today’s brief' },
];

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const city = useCity();
  const [q, setQ] = useState('');
  const [semantic, setSemantic] = useState<Array<{ id: number; score: number; via: 'photo' | 'text' }>>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSemantic([]);
    setCursor(0);
    setTimeout(() => input.current?.focus(), 30);
    if (box.current) gsap.fromTo(box.current, { y: -12, scale: 0.98, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.35, ease: 'power3.out' });
  }, [open]);

  // describe-it search, debounced
  useEffect(() => {
    const text = q.trim();
    if (text.length < 4 || /^#?\d+$/.test(text)) {
      setSemantic([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api
        .search(text)
        .then((r) => setSemantic(r.results.filter((x) => x.via === 'photo')))
        .catch(() => setSemantic([]))
        .finally(() => setSearching(false));
    }, 380);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const text = q.trim().toLowerCase().replace(/^#/, '');
    const list: Item[] = [];
    if (!text) {
      city.issues.slice(0, 5).forEach((i) => list.push({ kind: 'issue', id: i.id }));
      PAGES.forEach((p) => list.push({ kind: 'page', ...p }));
      return list;
    }
    const direct = city.issues.filter((i) => `${i.id} ${i.title} ${i.address} ${category(i.category).label} ${i.department}`.toLowerCase().includes(text)).slice(0, 6);
    direct.forEach((i) => list.push({ kind: 'issue', id: i.id, via: 'text' }));
    semantic.filter((s) => !direct.some((d) => d.id === s.id)).forEach((s) => list.push({ kind: 'issue', id: s.id, via: 'photo', score: s.score }));
    PAGES.filter((p) => p.label.toLowerCase().includes(text)).forEach((p) => list.push({ kind: 'page', ...p }));
    list.push({ kind: 'ask', text: q.trim() });
    return list;
  }, [q, city.issues, semantic]);

  useEffect(() => setCursor(0), [items.length]);

  const run = (it: Item) => {
    onClose();
    if (it.kind === 'issue') city.open(it.id);
    if (it.kind === 'page') go(it.page);
    if (it.kind === 'ask') city.askMamdani(it.text);
  };

  if (!open) return null;
  return (
    <div className="pal-scrim" onMouseDown={onClose}>
      <div className="pal" ref={box} onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-input">
          <Search size={18} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Work order number, street, or describe what it looks like…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') (e.preventDefault(), setCursor((c) => Math.min(items.length - 1, c + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setCursor((c) => Math.max(0, c - 1)));
              if (e.key === 'Enter' && items[cursor]) run(items[cursor]);
            }}
          />
          {searching && <span className="pal-spin" />}
        </div>
        <div className="pal-list">
          {items.map((it, k) => {
            const on = k === cursor;
            if (it.kind === 'issue') {
              const i = city.byId.get(it.id);
              if (!i) return null;
              return (
                <button key={`i${it.id}`} className={`pal-item ${on ? 'on' : ''}`} onMouseEnter={() => setCursor(k)} onClick={() => run(it)}>
                  <CategoryIcon id={i.category} size={15} />
                  <div className="pal-main">
                    <b>{i.title}</b>
                    <span>
                      #{i.id} · {street(i.address)} · {STATUS_SHORT[i.status]}
                    </span>
                  </div>
                  {it.via === 'photo' && (
                    <span className="pal-badge" title="Found by what the evidence photo shows (Gemini embeddings, pgvector)">
                      <Camera size={12} /> photo match {Math.round((it.score ?? 0) * 100)}%
                    </span>
                  )}
                  {on && <CornerDownLeft size={14} className="pal-enter" />}
                </button>
              );
            }
            if (it.kind === 'page')
              return (
                <button key={`p${it.page}`} className={`pal-item ${on ? 'on' : ''}`} onMouseEnter={() => setCursor(k)} onClick={() => run(it)}>
                  <span className="pal-ico">
                    <FileText size={15} />
                  </span>
                  <div className="pal-main">
                    <b>{it.label}</b>
                  </div>
                  <ArrowRight size={14} className="pal-enter" />
                </button>
              );
            return (
              <button key="ask" className={`pal-item ask ${on ? 'on' : ''}`} onMouseEnter={() => setCursor(k)} onClick={() => run(it)}>
                <img src="/mamdani-face.png" alt="" className="pal-face" />
                <div className="pal-main">
                  <b>Ask Mamdani</b>
                  <span>“{it.text}”</span>
                </div>
                <MessageSquare size={14} className="pal-enter" />
              </button>
            );
          })}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Ctrl J</kbd> Mamdani
          </span>
          <span className="pal-hint">Descriptions search the evidence photos</span>
        </div>
      </div>
    </div>
  );
}
