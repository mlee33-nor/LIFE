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

test('days_since_last_log uses the Phoenix date, not UTC', () => {
  // 04:30 UTC on the 26th is still the 25th in Phoenix.
  const realNow = Date.now;
  Date.now = () => new Date('2026-09-26T04:30:00Z').getTime();
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [Date.now()])); }
  };
  try {
    assert.equal(summary([day('2026-09-25', { stomach_pain: 1 })]).days_since_last_log, 0);
  } finally {
    global.Date = RealDate;
    Date.now = realNow;
  }
});

test('optimalBlueprint extracts targets and contrasts between peak and flare days', async () => {
  const { optimalBlueprint } = await import('../src/analytics.js');
  const days = [];
  for (let i = 0; i < 20; i++) {
    const isPeak = i < 10;
    days.push(day(addDays('2026-09-01', i), {
      stomach_pain: isPeak ? 1 : 6,
      acne: isPeak ? 1 : 5,
      sleep_hours: isPeak ? 8.5 : 6.0,
      water: isPeak ? 8 : 4,
      habits_done: isPeak ? 6 : 2,
      walk_minutes: isPeak ? 30 : 0,
      sessions: isPeak
        ? [{ activity: 'hmwk', minutes: 45, start: `${addDays('2026-09-01', i)}T14:00:00-07:00`, end: `${addDays('2026-09-01', i)}T14:45:00-07:00` }]
        : [{ activity: 'hmwk', minutes: 120, start: `${addDays('2026-09-01', i)}T21:00:00-07:00`, end: `${addDays('2026-09-01', i)}T23:00:00-07:00` }],
    }));
  }
  const bp = optimalBlueprint(days);
  assert.equal(bp.has_data, true);
  assert.ok(bp.targets.sleep_hours.optimal >= 8.0);
  assert.ok(bp.targets.water_glasses.optimal >= 7);
  assert.ok(bp.contrasts.length >= 3);
  assert.equal(optimalBlueprint([]).has_data, false);
});

test('foodCompass groups safe baseline foods and confirmed triggers', async () => {
  const { foodCompass } = await import('../src/analytics.js');
  const days = [];
  for (let i = 0; i < 15; i++) {
    const dairy = i % 2 === 0;
    days.push(day(addDays('2026-09-01', i), {
      foods: dairy ? ['cheese'] : ['oatmeal'],
      stomach_pain: i > 0 && (i - 1) % 2 === 0 ? 7 : 0,
    }));
  }
  const fc = foodCompass(days);
  assert.ok(fc.safe_foods.some((f) => f.food === 'oatmeal'));
  assert.ok(fc.confirmed_triggers.some((t) => t.food === 'cheese'));
});

test('focusCurve computes peak window and stamina breakdown', async () => {
  const { focusCurve } = await import('../src/analytics.js');
  const days = [
    day('2026-09-01', {
      sessions: [
        { activity: 'hmwk', minutes: 50, start: '2026-09-01T10:00:00-07:00', end: '2026-09-01T10:50:00-07:00' },
        { activity: 'work', minutes: 90, start: '2026-09-01T11:00:00-07:00', end: '2026-09-01T12:30:00-07:00' },
      ],
    }),
  ];
  const fc = focusCurve(days);
  assert.ok(fc.peak_window.label);
  assert.equal(fc.stamina_breakdown.optimal_45_to_75m, 1);
  assert.equal(fc.stamina_breakdown.extended_over_75m, 1);
});

test('optimalBlueprint targets keep min <= optimal <= max and invent no floors', async () => {
  const { optimalBlueprint } = await import('../src/analytics.js');
  const days = [];
  for (let i = 0; i < 12; i++) {
    // Peak days drink ~5 glasses and sleep ~6 h: the old code produced water {min:6, optimal:5}.
    days.push(day(addDays('2026-09-01', i), {
      stomach_pain: i < 6 ? 0 : 6, water: i < 6 ? 4 + (i % 3) : 1, sleep_hours: i < 6 ? 6 : 5, habits_done: i < 6 ? 2 : 1,
    }));
  }
  const bp = optimalBlueprint(days);
  for (const key of ['sleep_hours', 'water_glasses', 'habits_count']) {
    const t = bp.targets[key];
    assert.ok(t.min <= t.optimal && t.optimal <= t.max, `${key}: ${JSON.stringify(t)}`);
  }
  assert.equal(bp.targets.water_glasses.max, 6);
  assert.ok(bp.targets.water_glasses.min <= 5);
  assert.equal(bp.targets.sleep_hours.optimal, 6);
  assert.equal(bp.targets.walking_minutes, null); // no walking logged
  for (const c of bp.contrasts) for (const v of Object.values(c)) assert.ok(!/ {2}/.test(String(v)), v);
  // Under 7 days: no targets at all.
  assert.equal(optimalBlueprint(days.slice(0, 6)).targets, null);
});

test('foodCompass: a food followed by an unscored pain report is never safe', async () => {
  const { foodCompass } = await import('../src/analytics.js');
  const days = [];
  for (let i = 0; i < 8; i++) {
    const date = addDays('2026-09-01', i);
    days.push(day(date, {
      foods: ['toast', ...(i === 3 ? ['shrimp'] : []), ...(i === 5 ? ['shrimp'] : [])],
      meals: [{ at: `${date}T12:00:00-07:00`, text: i === 3 || i === 5 ? 'toast and shrimp' : 'toast' }],
      // Unscored reports only: no numeric stomach_pain anywhere.
      pain_reports: i === 3 ? [{ at: `${date}T14:00:00-07:00`, pain: null, text: 'stomach hurts' }] : [],
      stomach_pain: null,
    }));
  }
  const fc = foodCompass(days);
  assert.ok(!fc.safe_foods.some((f) => f.food === 'shrimp'));
  assert.ok(!fc.safe_foods.some((f) => f.food === 'toast')); // toast also preceded that episode
  assert.ok(fc.watchlist.some((w) => w.food === 'shrimp' && w.pain_episodes_after >= 1));
});

test('foodCompass does not call a food safe without follow-up data', async () => {
  const { foodCompass } = await import('../src/analytics.js');
  // Eaten twice, next days never logged -> unknown, not safe.
  const fc = foodCompass([day('2026-09-01', { foods: ['kiwi'] }), day('2026-09-05', { foods: ['kiwi'] })]);
  assert.deepEqual(fc.safe_foods, []);
});

test('focusCurve returns no peak window or advice without sessions', async () => {
  const { focusCurve } = await import('../src/analytics.js');
  const fc = focusCurve([day('2026-09-01', { sessions: [] })]);
  assert.equal(fc.peak_window, null);
  assert.equal(fc.advisory, null);
  assert.equal(fc.sessions_counted, 0);
});
