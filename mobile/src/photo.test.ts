import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraQueue, CaptureCancelled, captureReportPhoto, resizeForPhoto } from './photo';

test('capture gives a one-second cue and retries once', async () => {
  const waits: number[] = [];
  let attempts = 0;
  const result = await captureReportPhoto(() => true, async () => {
    if (++attempts === 1) throw new Error('Camera busy');
    return { data: 'jpeg', thumbnail: 'preview' };
  }, async ms => { waits.push(ms); });
  assert.equal(result.data, 'jpeg'); assert.equal(attempts, 2);
  assert.deepEqual(waits, [1000, 500]);
});

test('camera queue prevents overlapping preview and report captures', async () => {
  const queue = new CameraQueue(), order: string[] = [];
  let release!: () => void;
  const first = queue.run(async () => { order.push('preview-start'); await new Promise<void>(resolve => { release = resolve; }); order.push('preview-end'); });
  const second = queue.run(async () => { order.push('photo'); });
  await Promise.resolve(); assert.deepEqual(order, ['preview-start']);
  release(); await Promise.all([first, second]);
  assert.deepEqual(order, ['preview-start', 'preview-end', 'photo']);
});

test('cancellation during cue prevents capture, and after capture prevents submission', async () => {
  let alive = true, attempts = 0;
  await assert.rejects(captureReportPhoto(() => alive, async () => {
    attempts++; return { data: 'jpeg', thumbnail: '' };
  }, async () => { alive = false; }), CaptureCancelled);
  assert.equal(attempts, 0);
  alive = true;
  await assert.rejects(captureReportPhoto(() => alive, async () => {
    alive = false; return { data: 'jpeg', thumbnail: '' };
  }, async () => {}), CaptureCancelled);
});

test('both orientations keep the longest edge bounded without upscaling', () => {
  assert.deepEqual(resizeForPhoto(4000, 3000), { width: 1600 });
  assert.deepEqual(resizeForPhoto(3000, 4000), { height: 1600 });
  assert.deepEqual(resizeForPhoto(500, 400), { width: 500 });
});
