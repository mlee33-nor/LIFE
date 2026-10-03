import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoPin } from '../src/photo-pin.js';

const req = (pinHeader, ip = '1.2.3.4') => ({ headers: { 'x-forwarded-for': ip, ...(pinHeader ? { 'x-photo-pin': pinHeader } : {}) } });
const url = (q = '') => new URL(`http://x/api/photos/abc${q}`);
const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status; } };

test('no PIN configured: photos are open', () => {
  const p = createPhotoPin(undefined);
  assert.equal(p.enabled, false);
  assert.equal(status(() => p.check(req(), url())), 200);
});

test('PIN via header or ?pin=; missing or wrong is 401', () => {
  const p = createPhotoPin('4821');
  assert.equal(status(() => p.check(req('4821'), url())), 200);
  assert.equal(status(() => p.check(req(), url('?pin=4821'))), 200);
  assert.equal(status(() => p.check(req(), url())), 401);
  assert.equal(status(() => p.check(req('1111'), url())), 401);
});

test('5 wrong guesses lock that IP out (429), other IPs unaffected', () => {
  const p = createPhotoPin('4821');
  for (let i = 0; i < 4; i++) assert.equal(status(() => p.check(req(`000${i}`), url())), 401);
  assert.equal(status(() => p.check(req('0009'), url())), 401); // 5th miss sets the lock
  assert.equal(status(() => p.check(req('4821'), url())), 429); // even the right PIN waits
  assert.equal(status(() => p.check(req('4821', '9.9.9.9'), url())), 200);
});
