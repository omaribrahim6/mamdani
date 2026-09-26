// Tripo 3D API helper for Mamdani's character models.
//   npx tsx scripts/tripo.ts balance
//   npx tsx scripts/tripo.ts generate <image.png|jpg> <name>   image → textured 3D model (waits, downloads)
//   npx tsx scripts/tripo.ts rig <task_id> <name>              auto-rig (biped, Mixamo bone names)
//   npx tsx scripts/tripo.ts task <task_id>                    show a task
// Key: TRIPO_API_KEY (or `tripo=`) in .env.local. Downloads land in .data/tripo/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* env from the shell */
}
const KEY = process.env.TRIPO_API_KEY || process.env.tripo;
if (!KEY) throw new Error('Set TRIPO_API_KEY in .env.local');
const BASE = 'https://openapi.tripo3d.ai/v3';
const OUT = '.data/tripo';
const auth = { Authorization: `Bearer ${KEY}` };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(BASE + path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
  const j = (await r.json()) as { code: number; data?: T; message?: string; suggestion?: string };
  if (j.code !== 0) throw new Error(`${path}: ${j.code} ${j.message ?? ''} ${j.suggestion ?? ''}`);
  return j.data as T;
}

async function upload(file: string) {
  const fd = new FormData();
  const type = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  fd.append('file', new Blob([readFileSync(file)], { type }), basename(file));
  return (await call<{ file_token: string }>('/files', { method: 'POST', body: fd })).file_token;
}

interface Task {
  task_id: string;
  status: string;
  progress?: number;
  output?: { model_url?: string; rendered_image_url?: string };
  credits_consumed?: number;
}

async function wait(taskId: string): Promise<Task> {
  for (;;) {
    const t = await call<Task>(`/tasks/${taskId}`);
    process.stdout.write(`\r${taskId} ${t.status} ${t.progress ?? 0}%   `);
    if (['success', 'failed', 'cancelled'].includes(t.status)) {
      process.stdout.write('\n');
      return t;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function save(url: string | undefined, file: string) {
  if (!url) return;
  const r = await fetch(url);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(`saved ${file}`);
}

async function finish(t: Task, name: string) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.task.json`, JSON.stringify(t, null, 2));
  if (t.status !== 'success') throw new Error(`task ${t.task_id} ${t.status}`);
  await save(t.output?.model_url, `${OUT}/${name}.glb`);
  await save(t.output?.rendered_image_url, `${OUT}/${name}.preview.${t.output?.rendered_image_url?.includes('.png') ? 'png' : 'webp'}`);
  console.log(`credits used: ${t.credits_consumed ?? '?'}`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'balance') {
  console.log(await call('/account/balance'));
} else if (cmd === 'task') {
  console.log(JSON.stringify(await call(`/tasks/${a}`), null, 2));
} else if (cmd === 'generate') {
  const token = await upload(a);
  const { task_id } = await call<{ task_id: string }>('/generation/image-to-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: token,
      model: 'v3.1-20260211',
      texture: true,
      pbr: false, // colours get baked to the mesh for the phone; PBR maps would be thrown away
      texture_quality: 'standard',
      texture_alignment: 'original_image',
      face_limit: 30000, // phone-friendly, still plenty for a chibi character
    }),
  });
  console.log(`task ${task_id}`);
  await finish(await wait(task_id), b);
} else if (cmd === 'rig') {
  const check = await call<{ task_id: string }>('/animations/rig-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: a }),
  });
  console.log('rig check', JSON.stringify((await wait(check.task_id)).output));
  const { task_id } = await call<{ task_id: string }>('/animations/rig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: a, model: 'v1.0-20240301', rig_type: 'biped', spec: 'mixamo', out_format: 'glb' }),
  });
  console.log(`task ${task_id}`);
  await finish(await wait(task_id), b);
} else {
  console.log('usage: balance | generate <image> <name> | rig <task_id> <name> | task <id>');
}
