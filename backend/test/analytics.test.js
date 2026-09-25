import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, foodTriggers, lifestyleCorrelations, summary, timeseries } from '../src/analytics.js';

function day(date, fields = {}) {
  return {
    date, foods: [], habits: {}, hmwk_by_subject: {}, missed_habits: [], xp: 0, headache: null,
    stomach_pain: null, acne: null, water: null, meals_logged: 0, habits_done: 0,
    work_minutes: 0, hmwk_minutes: 0, workout_minutes: 0, walk_minutes: 0,
    ...fields,
  };
}

// Dairy on even days causes pain the next day.
function dairyDays(n = 20) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const dairy = i % 2 === 0;
    out.push(day(addDays('2026-09-01', i), {
      foods: dairy ? ['cheese', 'rice'] : ['rice'],
      stomach_pain: i > 0 && (i - 1) % 2 === 0 ? 7 : 1,
    }));
  }
  return out;
}

test('foodTriggers ranks the planted trigger first', () => {
  const { stomach_pain } = foodTriggers(dairyDays());
  assert.equal(stomach_pain.foods[0].food, 'cheese');
  assert.equal(stomach_pain.foods[0].lag_days, 1);
  assert.equal(stomach_pain.foods[0].difference, 6);
  // rice is eaten every day, so it has no "otherwise" baseline.
  assert.ok(!stomach_pain.foods.some((f) => f.food === 'rice'));
});

test('foodTriggers respects minDays', () => {
  const { stomach_pain } = foodTriggers(dairyDays(4), { minDays: 3 });
  assert.equal(stomach_pain.foods.length, 0);
});

test('summary compares against the previous period and finds streaks', () => {
  const days = [];
  for (let i = 0; i < 14; i++) {
    days.push(day(addDays('2026-09-01', i), { stomach_pain: i < 7 ? 6 : 1, habits: i % 2 ? { water: {} } : {} }));
  }
  const s = summary(days, { days: 7 });
  assert.deepEqual(s.period, { from: '2026-09-08', to: '2026-09-14', days: 7 });
  assert.equal(s.averages.stomach_pain, 1);
  assert.equal(s.change_vs_previous.stomach_pain, -5);
  assert.equal(s.flare_days.stomach_pain, 0);
  assert.equal(s.current_streak_without_flare.stomach_pain, 7);
  assert.equal(s.habit_completion.water.days_done, 4);
});

test('summary handles no data', () => {
  assert.equal(summary([]).message, 'No data logged yet');
});

test('timeseries fills gaps with nulls', () => {
  const t = timeseries([day('2026-09-01', { stomach_pain: 2 }), day('2026-09-03', { stomach_pain: 4 })], {
    metrics: ['stomach_pain'], smooth: 2,
  });
  assert.deepEqual(t.points.map((p) => p.stomach_pain), [2, null, 4]);
  assert.deepEqual(t.points.map((p) => p.stomach_pain_avg2), [2, 2, 4]);
});

test('lifestyleCorrelations detects a strong relationship', () => {
  const days = [];
  for (let i = 0; i < 10; i++) days.push(day(addDays('2026-09-01', i), { hmwk_minutes: i * 10, stomach_pain: i }));
  const row = lifestyleCorrelations(days).find((r) => r.factor === 'hmwk_minutes' && r.symptom === 'stomach_pain' && r.lag_days === 0);
  assert.equal(row.r, 1);
  assert.equal(row.strength, 'strong positive');
});
