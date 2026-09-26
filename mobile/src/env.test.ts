import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendUrl } from './env';

test('backend origin accepts LAN and HTTPS addresses and strips trailing slash', () => {
  assert.equal(backendUrl(' http://192.168.1.20:8000/ '), 'http://192.168.1.20:8000');
  assert.equal(backendUrl('https://api.example.com'), 'https://api.example.com');
  assert.equal(backendUrl('https://api.example.com/backend/'), 'https://api.example.com/backend');
});
test('backend origin rejects missing, invalid and unsafe configuration', () => {
  for (const value of [undefined, '', ' ', 'localhost:8000', 'ftp://host', 'https://user:secret@host', 'https://host?key=secret', 'https://host#fragment']) {
    assert.throws(() => backendUrl(value), /EXPO_PUBLIC_BACKEND_URL/);
  }
});
