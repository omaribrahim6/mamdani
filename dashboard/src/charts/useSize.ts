import { useEffect, useRef, useState } from 'react';

/** Width/height of an element, kept current. Charts draw in real pixels so marks stay crisp. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, set] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => set({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
