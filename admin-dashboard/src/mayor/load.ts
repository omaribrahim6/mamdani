import { registerMayorModel, hasMayorModels } from './models';

// The generated Mamdani (Tripo → rigged → baked to .mrig by the Next app's scripts/bake-mamdani.ts).
// Loaded once; until it arrives (or if it fails) createMayor() falls back to the procedural sculpt.
let pending: Promise<void> | null = null;

export function loadMascot(): Promise<void> {
  if (hasMayorModels()) return Promise.resolve();
  pending ??= fetch('/models/mamdani-suit.mrig')
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => registerMayorModel('suit', buf))
    .catch(() => { /* procedural stand-in */ });
  return pending;
}
