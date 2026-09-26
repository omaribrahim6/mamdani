import { useCallback, useState } from 'react';

// The operator's XP. Kept in this browser (a per-operator convenience, not city data).
export function useXP() {
  const [xp, setXp] = useState<number>(() => {
    try { return Number(localStorage.getItem('hq-xp')) || 0; } catch { return 0; }
  });
  const [pops, setPops] = useState<Array<{ id: number; amount: number }>>([]);
  const award = useCallback((amount: number) => {
    setXp((v) => {
      const n = v + amount;
      try { localStorage.setItem('hq-xp', String(n)); } catch { /* private mode */ }
      return n;
    });
    const id = Date.now() + Math.random();
    setPops((p) => [...p, { id, amount }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1300);
  }, []);
  return { xp, award, pops };
}
