import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePCM, decodePCM } from './pcm';
import { websocketURL, disconnectedMessage } from './protocol';

test('PCM uses signed little endian, clips peaks and round-trips speech samples', () => {
  const values = decodePCM(encodePCM(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2])));
  assert.deepEqual(Array.from(values).slice(0, 4), [-1, -1, -0.5, 0]);
  assert.ok(Math.abs(values[4] - 0.5) < 1 / 32768);
  assert.equal(values[5], 32767 / 32768);
  assert.equal(values[6], values[5]);
  assert.throws(() => decodePCM('AA=='));
});
test('server URL preserves deployment prefixes and selects secure WebSocket', () => {
  assert.equal(websocketURL('https://example.com/service/'), 'wss://example.com/service/api/v1/live');
  assert.equal(websocketURL('http://192.168.1.2:8000'), 'ws://192.168.1.2:8000/api/v1/live');
  assert.throws(() => websocketURL('file:///tmp/backend'));
  assert.match(disconnectedMessage('submitting'), /may have been saved/);
});
