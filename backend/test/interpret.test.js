import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodKeywords, interpret, localIso } from '../src/interpret.js';

const ev = (id, tracker, at, data) => ({ id: String(id), tracker, at: new Date(at), data });

test('foodKeywords strips filler words and plurals', () => {
  assert.deepEqual(foodKeywords('Chicken burrito w/ cheese and fries'), ['chicken', 'burrito', 'cheese', 'fry']);
  assert.deepEqual(foodKeywords('2 eggs, potatoes, sandwiches'), ['egg', 'potato', 'sandwich']);
  assert.deepEqual(foodKeywords(null), []);
});

test('localIso renders Phoenix time with offset', () => {
  assert.equal(localIso(new Date('2026-09-25T22:20:00Z')), '2026-09-25T15:20:00-07:00');
});

test('events are bucketed by Phoenix date, not UTC date', () => {
  // 03:00 UTC on the 26th is 20:00 on the 25th in Phoenix.
  const { daily } = interpret([ev(1, 'food', '2026-09-26T03:00:00Z', { kind: 'pain_report', pain: 5 })]);
  assert.equal(daily[0].date, '2026-09-25');
  assert.equal(daily[0].stomach_pain, 5);
});

test('session start/end pairs into minutes by activity and subject', () => {
  const { daily, activeSessions } = interpret([
    ev(1, 'life', '2026-09-25T16:00:00-07:00', { kind: 'session', action: 'start', activity: 'hmwk', subject: 'history' }),
    ev(2, 'life', '2026-09-25T16:10:00-07:00', { kind: 'session', action: 'start', activity: 'hmwk', subject: 'math' }),
    ev(3, 'life', '2026-09-25T16:45:00-07:00', { kind: 'session', action: 'end', activity: 'hmwk', subject: 'history' }),
    ev(4, 'life', '2026-09-25T18:00:00-07:00', { kind: 'session', action: 'end', activity: 'workout', subject: null, minutes: 30 }),
  ]);
  assert.equal(daily[0].hmwk_minutes, 45);
  assert.deepEqual(daily[0].hmwk_by_subject, { history: 45 });
  assert.equal(daily[0].workout_minutes, 30);
  assert.equal(activeSessions.length, 1);
  assert.equal(activeSessions[0].subject, 'math');
});

test('explicit minutes on an end event win over the computed duration', () => {
  const { daily } = interpret([
    ev(1, 'life', '2026-09-25T16:00:00-07:00', { kind: 'session', action: 'start', activity: 'work' }),
    ev(2, 'life', '2026-09-25T17:00:00-07:00', { kind: 'session', action: 'end', activity: 'work', minutes: 20 }),
  ]);
  assert.equal(daily[0].work_minutes, 20);
});

test('habits, meals, pain and skin severity roll up per day', () => {
  const { daily } = interpret([
    ev(1, 'life', '2026-09-25T09:00:00-07:00', { kind: 'habit', habit: 'water', value: 2 }),
    ev(2, 'life', '2026-09-25T10:00:00-07:00', { kind: 'habit', habit: 'water', value: 1 }),
    ev(3, 'life', '2026-09-25T07:00:00-07:00', { kind: 'habit', habit: 'sunscreen', value: null }),
    ev(4, 'food', '2026-09-25T12:00:00-07:00', { kind: 'meal', text: 'pizza', pain: null }),
    ev(5, 'food', '2026-09-25T14:00:00-07:00', { kind: 'pain_report', text: 'cramps', pain: 3 }),
    ev(6, 'food', '2026-09-25T20:00:00-07:00', { kind: 'pain_report', text: 'worse', pain: 6 }),
    ev(7, 'skin', '2026-09-25T22:00:00-07:00', { kind: 'routine', text: 'cleanser', severity: 4 }),
    ev(8, 'skin', '2026-09-25T22:01:00-07:00', { kind: 'photo', photo_ref: 'x' }),
    ev(9, 'life', '2026-09-25T22:02:00-07:00', { some: 'unknown shape' }),
  ]);
  const d = daily[0];
  assert.equal(d.water, 3);
  assert.equal(d.habits_done, 2);
  assert.deepEqual(d.foods, ['pizza']);
  assert.equal(d.stomach_pain, 6);
  assert.equal(d.pain_reports.length, 2);
  assert.equal(d.acne, 4);
  assert.deepEqual([d.skin.routines, d.skin.photos], [1, 1]);
  assert.equal(d.event_count, 9);
});

test('acne stays null when skin events have no severity', () => {
  const { daily } = interpret([ev(1, 'skin', '2026-09-25T22:00:00-07:00', { kind: 'note', text: 'small breakout' })]);
  assert.equal(daily[0].acne, null);
});

test('wake time and sleep hours come from bedtime -> wake', () => {
  const { daily } = interpret([
    ev(1, 'life', '2026-09-24T23:30:00-07:00', { kind: 'habit', habit: 'bedtime', value: null }),
    ev(2, 'life', '2026-09-25T07:15:00-07:00', { kind: 'wake' }),
    ev(3, 'life', '2026-09-25T09:00:00-07:00', { kind: 'wake' }), // later wake (after a nap) is ignored
  ]);
  const d = daily.find((x) => x.date === '2026-09-25');
  assert.equal(d.wake_time, '07:15');
  assert.equal(d.wake_hour, 7.25);
  assert.equal(d.sleep_hours, 7.75);
});

test('wake without a recent bedtime has no sleep hours', () => {
  const { daily } = interpret([ev(1, 'life', '2026-09-25T07:00:00-07:00', { kind: 'wake' })]);
  assert.equal(daily[0].sleep_hours, null);
});

test('headaches, misses, xp and rest roll up per day', () => {
  const { daily } = interpret([
    ev(1, 'life', '2026-09-25T10:00:00-07:00', { kind: 'headache', severity: 3, text: 'dull' }),
    ev(2, 'life', '2026-09-25T15:00:00-07:00', { kind: 'headache', severity: 6, text: 'worse' }),
    ev(3, 'life', '2026-09-25T21:00:00-07:00', { kind: 'miss', habit: 'sunscreen', text: null }),
    ev(4, 'life', '2026-09-25T21:01:00-07:00', { kind: 'miss', habit: 'sunscreen', text: null }),
    ev(5, 'life', '2026-09-25T12:00:00-07:00', { kind: 'xp', amount: 10, reason: 'hmwk' }),
    ev(6, 'life', '2026-09-25T13:00:00-07:00', { kind: 'xp', amount: 5, reason: 'water' }),
    ev(7, 'life', '2026-09-25T14:00:00-07:00', { kind: 'session', action: 'end', activity: 'rest', subject: null, minutes: 20 }),
  ]);
  const d = daily[0];
  assert.equal(d.headache, 6);
  assert.equal(d.headache_reports.length, 2);
  assert.deepEqual(d.missed_habits, ['sunscreen']);
  assert.equal(d.misses, 1);
  assert.equal(d.xp, 15);
  assert.equal(d.rest_minutes, 20);
});
