import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveSession, type AudioIO } from './session';
import type { Phase } from './protocol';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function harness() {
  const sent: any[] = [], phases: Phase[] = [], errors: string[] = [], calls: string[] = [];
  const socket = { readyState: 1, bufferedAmount: 0, onopen: null as any, onmessage: null as any,
    onclose: null as any, onerror: null as any,
    send: (text: string) => sent.push(JSON.parse(text)), close: () => calls.push('socket-close') };
  let sendAudio: ((data: string, rate: number) => void) | undefined;
  const audio: AudioIO = {
    start: async send => { sendAudio = send; calls.push('start'); },
    play: () => { calls.push('play'); }, interrupt: () => { calls.push('interrupt'); },
    stopCapture: async () => { calls.push('stop-capture'); }, dispose: async () => { calls.push('dispose'); },
  };
  const session = new LiveSession('https://example.com', { latitude: 45, longitude: -73 }, {
    phase: phase => phases.push(phase), speaking: () => {}, transcript: () => {}, error: error => errors.push(error),
  }, () => audio, () => socket as unknown as WebSocket);
  void session.ready.catch(() => {});
  const receive = (data: object) => socket.onmessage({ data: JSON.stringify(data) });
  return { session, socket, receive, sent, phases, errors, calls, sendAudio: () => sendAudio! };
}

test('streams only during live phase and stops on confirmed save', async () => {
  const h = harness(); h.socket.onopen();
  assert.deepEqual(h.sent[0], { type: 'start', latitude: 45, longitude: -73 });
  h.receive({ type: 'ready' }); await h.session.ready;
  h.sendAudio()('AAAA', 16000); h.session.frame('jpeg');
  assert.deepEqual(h.sent.map(message => message.type), ['start', 'audio', 'video']);
  h.receive({ type: 'audio', data: 'AAAA', sampleRate: 24000 });
  h.receive({ type: 'interrupted' });
  assert.ok(h.calls.includes('interrupt'));
  h.receive({ type: 'submitting' }); await tick();
  h.sendAudio()('AAAA', 16000); h.session.frame('jpeg');
  assert.equal(h.sent.length, 3); assert.ok(h.calls.includes('stop-capture'));
  h.receive({ type: 'success' }); await tick();
  assert.equal(h.phases.at(-1), 'success'); assert.ok(h.calls.includes('dispose'));
  h.socket.onclose(); assert.equal(h.errors.length, 0);
});

test('disconnect during POST reports unknown status and never retries', async () => {
  const h = harness(); h.receive({ type: 'ready' }); await h.session.ready;
  h.receive({ type: 'submitting' }); await tick(); h.socket.onclose(); await tick();
  assert.match(h.errors[0], /Submission status unknown/);
  assert.equal(h.phases.at(-1), 'error'); assert.equal(h.sent.length, 0);
  assert.ok(h.calls.includes('dispose'));
});

test('cancel releases media once and ignores late server events', async () => {
  const h = harness(); h.receive({ type: 'ready' }); await h.session.ready;
  await h.session.close(); await h.session.close();
  h.receive({ type: 'success' });
  assert.equal(h.calls.filter(value => value === 'dispose').length, 1);
  assert.deepEqual(h.sent, [{ type: 'cancel' }]);
  assert.ok(!h.phases.includes('success'));
});

test('photo request pauses audio, photo is sent exactly once, and late frames are ignored', async () => {
  const h = harness(); h.receive({ type: 'ready' }); await h.session.ready;
  assert.equal(h.session.photo('jpeg'), false);
  h.receive({ type: 'capture_photo' }); await tick();
  assert.equal(h.phases.at(-1), 'capturing'); assert.ok(h.calls.includes('stop-capture'));
  h.receive({ type: 'capture_photo' }); await tick();
  h.sendAudio()('AAAA', 16000); h.session.frame('preview');
  assert.equal(h.sent.length, 0);
  assert.equal(h.session.photo('jpeg'), true);
  assert.equal(h.session.photo('duplicate'), false);
  assert.deepEqual(h.sent, [{ type: 'photo', data: 'jpeg' }]);
  assert.equal(h.phases.at(-1), 'submitting');
  h.socket.onclose(); await tick(); assert.match(h.errors[0], /Submission status unknown/);
});

test('cancelling during photo cue prevents late photo submission', async () => {
  const h = harness(); h.receive({ type: 'ready' }); await h.session.ready;
  h.receive({ type: 'capture_photo' }); await tick();
  await h.session.close(); assert.equal(h.session.photo('late-jpeg'), false);
  assert.deepEqual(h.sent, [{ type: 'cancel' }]);
});

test('photo send failure cleans up and reports an uncertain submission', async () => {
  const h = harness(); h.receive({ type: 'ready' }); await h.session.ready;
  h.receive({ type: 'capture_photo' }); await tick();
  h.socket.send = () => { throw new Error('Network lost'); };
  assert.equal(h.session.photo('jpeg'), false);
  await tick();
  assert.match(h.errors[0], /Submission status unknown/);
  assert.ok(h.calls.includes('dispose'));
});
