import { useEffect, useMemo, useRef } from 'react';
import type { ApiIssue, ApiStats } from '../data/api';
import { useStages } from '../gl/GLProvider';
import { useLang } from '../i18n';
import { BriefingPortrait } from '../mayor/briefing';

// Two lines a supervisor would want first, written from the live record, with the mascot
// mouthing them whenever they change.
function brief(issues: ApiIssue[], stats: ApiStats | null, lang: 'en' | 'fr', now: number) {
  const open = issues.filter((i) => i.status !== 'resolved');
  const urgent = open.filter((i) => i.priority >= 70 || i.accessibility.impact === 'critical').length;
  const barriers = open.filter((i) => i.accessibility.barrier).length;
  const oldest = [...open].sort((a, b) => a.firstReportedAt - b.firstReportedAt)[0];
  const hrs = oldest ? Math.round((now - oldest.firstReportedAt) / 3600_000) : 0;
  const street = oldest?.address.split(',')[0] ?? '';
  const fixed = stats?.resolvedToday ?? 0;
  if (lang === 'fr')
    return [`${urgent} demandes urgentes · ${barriers} obstacles à l’accessibilité ouverts.`, oldest ? `Plus longue attente : ${hrs} h, ${street}. ${fixed} réglée(s) aujourd’hui.` : 'Aucune attente.'];
  return [`${urgent} urgent requests · ${barriers} open accessibility barriers.`, oldest ? `Longest wait: ${hrs} h at ${street}. ${fixed} fixed today.` : 'Nothing waiting.'];
}

export function BriefingCard({ issues, stats, now }: { issues: ApiIssue[]; stats: ApiStats | null; now: number }) {
  const { back } = useStages();
  const { lang, t } = useLang();
  const canvas = useRef<HTMLCanvasElement>(null);
  const portrait = useRef<BriefingPortrait | null>(null);
  const lines = useMemo(() => brief(issues, stats, lang, now), [issues, stats, lang, now]);
  const text = lines.join(' ');

  useEffect(() => {
    if (!back || !canvas.current) return;
    let p: BriefingPortrait;
    try { p = new BriefingPortrait(canvas.current); } catch { return; }
    portrait.current = p;
    const ro = new ResizeObserver(() => p.resize());
    ro.observe(canvas.current);
    return () => { ro.disconnect(); p.dispose(); portrait.current = null; };
  }, [back]);

  useEffect(() => { if (issues.length) portrait.current?.say(text); }, [text, issues.length]);

  return (
    <section className="briefing" aria-label={t('briefing')}>
      <div className="briefing-portrait">{back ? <canvas ref={canvas} aria-hidden="true" /> : null}</div>
      <div className="briefing-text" aria-live="polite">
        <h2>{t('briefing')}</h2>
        {lines.map((l) => <p key={l}>{l}</p>)}
      </div>
    </section>
  );
}
