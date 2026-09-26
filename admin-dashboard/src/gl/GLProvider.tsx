import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackStage } from './backStage';
import { FxStage } from './fxStage';

interface Stages { back: BackStage | null; fx: FxStage | null }
const Ctx = createContext<Stages>({ back: null, fx: null });
export const useStages = () => useContext(Ctx);

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Two canvases for the whole app: one behind the UI, one over it (pointer-events: none).
export function GLProvider({ children }: { children: ReactNode }) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const [stages, setStages] = useState<Stages>({ back: null, fx: null });

  useEffect(() => {
    if (!backRef.current || !fxRef.current || !webglAvailable()) return;
    let back: BackStage | null = null, fx: FxStage | null = null;
    try {
      back = new BackStage(backRef.current);
      fx = new FxStage(fxRef.current);
      setStages({ back, fx });
      document.documentElement.classList.add('has-webgl');
    } catch {
      /* no WebGL: the CSS fallbacks carry the UI */
    }
    return () => { back?.dispose(); fx?.dispose(); document.documentElement.classList.remove('has-webgl'); };
  }, []);

  return (
    <Ctx.Provider value={stages}>
      <canvas ref={backRef} className="gl-back" aria-hidden="true" />
      {children}
      <canvas ref={fxRef} className="gl-fx" aria-hidden="true" />
    </Ctx.Provider>
  );
}
