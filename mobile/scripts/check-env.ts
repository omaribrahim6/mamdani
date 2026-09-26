import { load } from '@expo/env';
import { backendUrl } from '../src/env';

load(process.cwd());
async function main() {
try {
  const base = backendUrl(process.env.EXPO_PUBLIC_BACKEND_URL);
  const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok || result.status !== 'ok' || result.service !== 'municipal-reporting-api') {
    throw new Error('Unexpected backend health response');
  }
  console.log('[Expo startup] Backend URL and API connectivity checks passed.');
} catch {
  console.error('[Expo startup] EXPO_PUBLIC_BACKEND_URL is missing/invalid or the API is unreachable. Start the backend first; check mobile/.env and your LAN connection.');
  process.exitCode = 1;
}
}
void main();
