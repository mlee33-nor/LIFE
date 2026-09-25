import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkApiKey, parseIso, validateLog, ValidationError } from '../src/write.js';

test('validateLog accepts the contract shape', () => {
  const v = validateLog({ tracker: 'food', data: { kind: 'meal', text: 'eggs' } });
  assert.equal(v.tracker, 'food');
  assert.equal(v.at, null);
  assert.deepEqual(v.data, { kind: 'meal', text: 'eggs' });
});

test('validateLog rejects bad tracker, missing data and bad at', () => {
  assert.throws(() => validateLog({ tracker: 'mood', data: {} }), ValidationError);
  assert.throws(() => validateLog({ tracker: 'life' }), /data is required/);
  assert.throws(() => validateLog({ tracker: 'life', data: {}, at: 'yesterday' }), /ISO-8601/);
  assert.throws(() => validateLog([]), ValidationError);
});

test('parseIso: offset kept, naive times read as Phoenix, date-only until is exclusive next day', () => {
  assert.equal(parseIso('2026-09-25T15:20:00-07:00', 'at').sql, '$::timestamptz');
  assert.match(parseIso('2026-09-25T15:20', 'at').sql, /AT TIME ZONE 'America\/Phoenix'/);
  const until = parseIso('2026-09-25', 'until', { endOfDay: true });
  assert.equal(until.exclusive, true);
  assert.match(until.sql, /\+ 1/);
});

test('checkApiKey accepts bearer header or ?key=, rejects others', () => {
  const req = (h) => ({ headers: h });
  assert.equal(checkApiKey(req({ authorization: 'Bearer abc' }), 'abc'), true);
  assert.equal(checkApiKey(req({ authorization: 'Bearer abd' }), 'abc'), false);
  assert.equal(checkApiKey(req({}), 'abc', new URL('http://x/?key=abc')), true);
  assert.equal(checkApiKey(req({ authorization: 'Bearer abc' }), undefined), false);
});
