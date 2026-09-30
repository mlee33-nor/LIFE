import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../src/analytics.js';
import { weeklyReview } from '../src/review.js';

// Synthetic day records shaped like interpret()'s output.
function day(date, fields = {}) {
  return {
    date, event_count: 1, xp: 0, xp_events: [], stomach_pain: null, pain_reports: [],
    acne: null, acne_spots: null, headache: null, headache_reports: [], sleep_hours: null,
    foods: [], goals: [], todos: [], hmwk_minutes: 0, hmwk_by_subject: {},
    skin: { photo_list: [], photos: 0, locations: [] },
    ...fields,
  };
}

const END = '2026-09-27'; // a Sunday; this week = Sep 21-27, last week = Sep 14-20
const thisWeek = (i) => addDays('2026-09-21', i);
const lastWeek = (i) => addDays('2026-09-14', i);

test('week ranges end on the given day', () => {
  const r = weeklyReview([], { end: END });
  assert.deepEqual(r.this_week, { from: '2026-09-21', to: END });
  assert.deepEqual(r.last_week, { from: '2026-09-14', to: '2026-09-20' });
});

test('week-over-week totals, change and best day', () => {
  const daily = [
    ...[0, 1, 2, 3].map((i) => day(lastWeek(i), { xp: 50, xp_events: [{ amount: 50 }], hmwk_minutes: 30, hmwk_by_subject: { math: 30 } })),
    day(thisWeek(0), { xp: 40, xp_events: [{ amount: 40 }], hmwk_minutes: 60, hmwk_by_subject: { math: 45, english: 15 } }),
    day(thisWeek(3), { xp: 200, xp_events: [{ amount: 200 }], hmwk_minutes: 50, hmwk_by_subject: { english: 50 },
      goals: [{ label: 'math 30', subject: 'math', target_minutes: 30, done_minutes: 0, complete: false },
        { label: 'english 30', subject: 'english', target_minutes: 30, done_minutes: 50, complete: true }] }),
    day(thisWeek(5), { xp: 10, xp_events: [{ amount: 10 }], hmwk_minutes: 47, hmwk_by_subject: { math: 47 } }),
  ];
  const r = weeklyReview(daily, { end: END });
  assert.deepEqual(r.days_logged, { this_week: 3, last_week: 4 });
  assert.equal(r.xp.this_week, 250);
  assert.equal(r.xp.last_week, 200);
  assert.equal(r.xp.change, 50);
  assert.deepEqual(r.xp.best_day, { date: thisWeek(3), xp: 200 });
  assert.equal(r.xp.enough_data, true);
  assert.equal(r.homework.this_week_minutes, 157);
  assert.equal(r.homework.last_week_minutes, 120);
  assert.equal(r.homework.change_minutes, 37);
  assert.deepEqual(r.homework.by_subject, { math: 92, english: 65 });
  assert.deepEqual(r.homework.goals, { hit: 1, set: 2 });
  assert.ok(r.highlights.includes('37 min more homework than last week'));
  assert.ok(r.highlights.includes('Best XP day: Thu (200)'));
  assert.ok(r.highlights.includes('Hit 1 of 2 study goals'));
});

test('days outside both weeks are ignored', () => {
  const r = weeklyReview([day('2026-09-01', { xp: 999 }), day('2026-09-28', { xp: 999 })], { end: END });
  assert.equal(r.days_logged.this_week, 0);
  assert.equal(r.xp.this_week, null);
});

test('missing data gives nulls and enough_data false, not zeros', () => {
  const r = weeklyReview([day(thisWeek(6))], { end: END });
  assert.equal(r.xp.last_week, null);
  assert.equal(r.xp.change, null);
  assert.equal(r.xp.best_day, null);
  assert.equal(r.xp.enough_data, false);
  assert.equal(r.homework.last_week_minutes, null);
  assert.equal(r.homework.change_minutes, null);
  assert.equal(r.acne.first, null);
  assert.equal(r.acne.latest, null);
  assert.equal(r.acne.change, null);
  assert.equal(r.acne.enough_data, false);
  assert.equal(r.stomach.average_pain, null);
  assert.equal(r.stomach.safe_foods, null);
  assert.equal(r.stomach.enough_data, false);
  assert.equal(r.sleep.average_hours, null);
  assert.equal(r.sleep.nights, 0);
  assert.equal(r.sleep.change_hours, null);
  assert.equal(r.sleep.enough_data, false);
  assert.equal(r.todos.total, 0);
  assert.equal(r.todos.enough_data, false);
});

test('an unlogged week is null even if the other week has data', () => {
  const daily = [0, 1, 2].map((i) => day(thisWeek(i), { hmwk_minutes: 20 }));
  const r = weeklyReview(daily, { end: END });
  assert.equal(r.homework.this_week_minutes, 60);
  assert.equal(r.homework.last_week_minutes, null);
  assert.equal(r.homework.change_minutes, null);
  assert.ok(!r.highlights.some((h) => h.includes('homework')));
});

test('comparison needs enough days in both weeks', () => {
  const daily = [
    day(lastWeek(0), { hmwk_minutes: 10 }),
    ...[0, 1, 2].map((i) => day(thisWeek(i), { hmwk_minutes: 20 })),
  ];
  const r = weeklyReview(daily, { end: END });
  assert.equal(r.homework.last_week_minutes, 10);
  assert.equal(r.homework.change_minutes, null);
  assert.equal(r.homework.enough_data, false);
});

test('acne compares the earliest and latest days with a spot count', () => {
  const daily = [
    day(thisWeek(0)),
    day(thisWeek(1), { acne_spots: 6, skin: { photo_list: [{ angle: 'front', url: '/x' }] } }),
    day(thisWeek(4), { acne_spots: 5 }),
    day(thisWeek(5), { acne_spots: 4, skin: { photo_list: [{ angle: 'left', url: '/y' }] } }),
  ];
  const r = weeklyReview(daily, { end: END });
  assert.deepEqual(r.acne.first, { date: thisWeek(1), spots: 6 });
  assert.deepEqual(r.acne.latest, { date: thisWeek(5), spots: 4 });
  assert.equal(r.acne.change, -2);
  assert.equal(r.acne.days, 3);
  assert.equal(r.acne.photo_days, 2);
  assert.ok(r.highlights.includes('Spot count 6 → 4 (Tue to Sat)'));
});

test('pain reports list the foods from that day and the day before', () => {
  const daily = [
    day(lastWeek(6), { foods: ['pizza'] }), // Sunday before the week starts
    day(thisWeek(0), { foods: ['rice', 'chicken'], pain_reports: [{ at: '2026-09-21T20:00:00-07:00', pain: null, text: 'cramps' }] }),
    day(thisWeek(1), { foods: ['dutch bros golden eagle', 'toast'] }),
    day(thisWeek(2), { foods: ['rice'], pain_reports: [{ at: '2026-09-23T09:00:00-07:00', pain: 6, text: null }] }),
    day(thisWeek(3), { foods: ['oatmeal', 'banana'] }),
    day(thisWeek(4), { foods: ['oatmeal'] }),
    day(thisWeek(5), { foods: ['banana', 'yogurt'] }),
    day(thisWeek(6), { foods: ['yogurt'] }),
  ];
  const r = weeklyReview(daily, { end: END });
  assert.equal(r.stomach.reports, 2);
  assert.equal(r.stomach.scored_reports, 1);
  assert.equal(r.stomach.average_pain, 6);
  const [mon, wed] = r.stomach.pain_reports;
  assert.deepEqual(mon.foods_same_day, ['rice', 'chicken']);
  assert.deepEqual(mon.foods_day_before, ['pizza']); // reaches into last week
  assert.equal(mon.pain, null);
  assert.deepEqual(wed.foods_same_day, ['rice']);
  assert.deepEqual(wed.foods_day_before, ['dutch bros golden eagle', 'toast']);
  assert.deepEqual(wed.foods_before, ['rice', 'dutch bros golden eagle', 'toast']);
  // Safe list: eaten with no pain that day or the next, and the next day logged.
  // Tue's foods are followed by Wed's pain; yogurt on Sun has no next day yet.
  assert.deepEqual(r.stomach.safe_foods, [
    { food: 'oatmeal', days: 2 },
    { food: 'banana', days: 2 },
    { food: 'yogurt', days: 1 },
  ].sort((a, b) => b.days - a.days || a.food.localeCompare(b.food)));
  assert.ok(r.highlights.includes('2 stomach pain reports'));
  assert.equal(r.stomach.last_week_reports, 0);
  assert.equal(r.stomach.change_reports, null); // last week has 1 logged day: not comparable
});

test('safe food list needs at least 3 days of food data', () => {
  const daily = [day(thisWeek(0), { foods: ['rice'] }), day(thisWeek(1), { foods: ['rice'] })];
  const r = weeklyReview(daily, { end: END });
  assert.equal(r.stomach.safe_foods, null);
  assert.ok(!r.highlights.some((h) => h.includes('stomach')));
});

test('sleep averages known nights only; headaches count days', () => {
  const daily = [
    day(thisWeek(0), { sleep_hours: 7 }),
    day(thisWeek(1), { sleep_hours: 8, headache_reports: [{ severity: null }] }),
    day(thisWeek(2)),
    day(thisWeek(3), { sleep_hours: 6.5, headache: 4, headache_reports: [{ severity: 4 }, { severity: 2 }] }),
  ];
  const r = weeklyReview(daily, { end: END });
  assert.equal(r.sleep.nights, 3);
  assert.equal(r.sleep.average_hours, 7.2);
  assert.equal(r.sleep.enough_data, true);
  assert.equal(r.headaches.days, 2);
  assert.ok(r.highlights.includes('Headache logged on 2 days'));
  assert.ok(r.highlights.includes('Averaged 7.2 h sleep over 3 nights'));
});

test('to-dos count done over total, skipping skipped', () => {
  const daily = [
    day(thisWeek(0), { todos: [{ status: 'done', done: true }, { status: 'open', done: false }] }),
    day(thisWeek(2), { todos: [{ status: 'skipped', done: false }, { status: 'done', done: true }] }),
  ];
  const r = weeklyReview(daily, { end: END });
  assert.deepEqual([r.todos.done, r.todos.total, r.todos.days], [2, 3, 2]);
  assert.ok(r.highlights.includes('Finished 2 of 3 to-dos'));
});

test('highlights are empty when nothing is logged', () => {
  assert.deepEqual(weeklyReview([], { end: END }).highlights, []);
});

test('"no pain reported" entries are not counted as pain episodes', async () => {
  const { weeklyReview } = await import('../src/review.js');
  const mk = (date, reports) => ({ date, event_count: 1, foods: ['rice'], pain_reports: reports, xp: 0, todos: [], goals: [], hmwk_by_subject: {}, skin: {} });
  const r = weeklyReview([
    mk('2026-09-21', [{ at: '2026-09-21T12:00:00-07:00', pain: 0, text: 'no pain reported' }]),
    mk('2026-09-22', [{ at: '2026-09-22T12:00:00-07:00', pain: null, text: 'after coffee' }]),
    mk('2026-09-23', [{ at: '2026-09-23T12:00:00-07:00', pain: 5, text: 'cramps' }]),
  ], { end: '2026-09-27' });
  assert.equal(r.stomach.reports, 2);
  assert.equal(r.stomach.average_pain, 5);
  assert.deepEqual(r.stomach.pain_reports.map((p) => p.text), ['after coffee', 'cramps']);
});
