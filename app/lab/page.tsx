'use client';

import { useRef, useState } from 'react';
import { Mayor, type MayorHandle } from '@/components/mayor/Mayor';
import type { Outfit } from '@/lib/categories';
import type { Mood } from '@/lib/types';

// Character lab: preview every outfit and reaction without taking a photo.
export default function Lab() {
  const m = useRef<MayorHandle>(null);
  const [outfit, setOutfit] = useState<Outfit>('construction');
  const [mood, setMood] = useState<Mood>('dismayed');
  const run = () => m.current?.perform(outfit, { target: { x: 0.6, y: 0.7 }, mood });
  return (
    <main style={{ height: '100dvh', display: 'grid', gridTemplateRows: '1fr auto', background: '#5b6166' }}>
      <div style={{ position: 'relative', background: 'linear-gradient(#8d9399, #4a4f54)' }}>
        <Mayor ref={m} />
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', background: 'var(--paper)' }}>
        {(['construction', 'electrician', 'sanitation', 'inspector', 'traffic'] as Outfit[]).map((o) => (
          <button key={o} className={`btn ${o === outfit ? 'btn-primary' : ''}`} onClick={() => setOutfit(o)}>
            {o}
          </button>
        ))}
        {(['dismayed', 'determined', 'impressed', 'confused'] as Mood[]).map((o) => (
          <button key={o} className={`btn ${o === mood ? 'btn-primary' : ''}`} onClick={() => setMood(o)}>
            {o}
          </button>
        ))}
        <button className="btn btn-primary" onClick={run}>
          Perform
        </button>
      </div>
    </main>
  );
}
