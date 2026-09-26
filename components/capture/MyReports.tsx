'use client';

import { useEffect, useState } from 'react';
import { category } from '@/lib/categories';
import type { Issue, Status } from '@/lib/types';
import { loadMine, type MyReport } from './hooks';
import s from './capture.module.css';

const STEPS: Array<{ status: Status; label: string }> = [
  { status: 'new', label: 'Reported' },
  { status: 'assigned', label: 'Crew assigned' },
  { status: 'in_progress', label: 'Being fixed' },
  { status: 'resolved', label: 'Fixed' },
];

export function MyReports({ onClose }: { onClose: () => void }) {
  const [mine] = useState<MyReport[]>(() => loadMine());
  const [live, setLive] = useState<Record<number, Issue>>({});

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const found = await Promise.all(
        mine.map((m) =>
          fetch(`/api/issues/${m.issueId}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ),
      );
      if (stop) return;
      const next: Record<number, Issue> = {};
      found.forEach((f) => f && (next[f.issue.id] = f.issue));
      setLive(next);
    };
    void load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [mine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className={s.mine} role="dialog" aria-modal="true" aria-labelledby="mine-title">
      <header className={s.mineHead}>
        <h2 id="mine-title">Your reports</h2>
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </header>
      {mine.length === 0 ? (
        <p className={s.mineEmpty}>Nothing yet. Point your camera at something broken and say “Mamdani, fix this.”</p>
      ) : (
        <ol className={s.mineList}>
          {mine.map((m) => {
            const issue = live[m.issueId];
            const status = issue?.status ?? 'new';
            const reached = STEPS.findIndex((x) => x.status === status);
            const cat = category(m.category);
            return (
              <li key={m.issueId} className={s.mineItem}>
                <span className={s.mineCat} style={{ background: cat.color }} aria-hidden="true" />
                <div>
                  <p className={s.mineTitle}>{issue?.title ?? m.title}</p>
                  <p className={s.mineMeta}>
                    {m.address}. Work order {m.issueId}
                    {issue && issue.reports > 1 ? `, ${issue.reports} reports` : ''}
                  </p>
                  <ol className={s.steps} aria-label={`Status: ${STEPS[reached].label}`}>
                    {STEPS.map((st, i) => (
                      <li key={st.status} data-done={i <= reached} data-current={i === reached}>
                        {st.label}
                      </li>
                    ))}
                  </ol>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
