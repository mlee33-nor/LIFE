// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  level, streaks, recap, weeklyReport, painTimeline, doordashSummary, moodSummary,
} from '../src/extras.js';
import { addDays } from '../src/analytics.js';

function day(date, fields = {}) {
  return {
    date, event_count: 1, foods: [], meals: [], habits: {}, missed_habits: [], hmwk_by_subject: {},
    hmwk_minutes: 0, work_minutes: 0, xp: 0, xp_events: [], pain_reports: [], headache_reports: [],
    stomach_pain: null, headache: null, acne: null, acne_spots: null, sleep_hours: null, wake_time: null,
    goals: [], todos: [], sessions: [],
    ...fields,
  };
}
const at = (date, hhmm) => `${date}T${hhmm}:00-07:00`;
const habit = (count = 1) => ({ count, value: null });

// --- level ------------------------------------------------------------------

test('level follows 1 + floor(sqrt(xp/150))', () => {
  assert.deepEqual(level(0), { level: 1, xp: 0, level_start_xp: 0, next_level_xp: 150, progress: 0 });
  assert.equal(level(149).level, 1);
  assert.equal(level(150).level, 2);
  assert.equal(level(599).level, 2);
  assert.equal(level(600).level, 3);
  const l = level(1000); // level 3: 600..1350
  assert.equal(l.level, 3);
  assert.equal(l.level_start_xp, 600);
  assert.equal(l.next_level_xp, 1350);
  assert.equal(l.progress, round4(400 / 750));
  for (let lv = 1; lv <= 40; lv++) {
    assert.equal(level(150 * (lv - 1) ** 2).level, lv);
    assert.equal(level(150 * lv ** 2 - 1).level, lv);
  }
});
const round4 = (n) => Math.round(n * 1e4) / 1e4;

test('level is null-safe', () => {
  assert.equal(level(null).level, 1);
  assert.equal(level(undefined).xp, 0);
  assert.equal(level(-50).xp, 0);
  assert.equal(level('300').level, 2);
});

// --- streaks ----------------------------------------------------------------

test('habit streak counts consecutive logged days; today not done does not break it', () => {
  const daily = [
    day('2026-09-01', { habits: { water: habit() } }),
    day('2026-09-02', { habits: { water: habit() } }),
    day('2026-09-03', { habits: {} }), // miss
    day('2026-09-04', { habits: { water: habit() } }),
    day('2026-09-05', { habits: { water: habit(), brush_teeth: habit(2) } }),
    day('2026-09-06', { habits: { water: habit() } }),
    day('2026-09-07', { habits: {} }), // today, not done yet
  ];
  const s = streaks(daily, { today: '2026-09-07' });
  const water = s.habits.find((h) => h.habit === 'water');
  assert.deepEqual(water, { habit: 'water', current: 3, best: 3, done_today: false });
  const teeth = s.habits.find((h) => h.habit === 'brush_teeth');
  assert.deepEqual(teeth, { habit: 'brush_teeth', current: 0, best: 1, done_today: false });
  assert.equal(s.study_goal, null);
  assert.deepEqual(s.shields, []);
});

test('done today extends the streak', () => {
  const daily = ['2026-09-01', '2026-09-02', '2026-09-03'].map((d) => day(d, { habits: { pm_skincare: habit() } }));
  const s = streaks(daily, { today: '2026-09-03' });
  assert.deepEqual(s.habits[0], { habit: 'pm_skincare', current: 3, best: 3, done_today: true });
});

test('a shield day neither breaks nor extends a streak', () => {
  const daily = [
    day('2026-09-01', { habits: { walk: habit() } }),
    day('2026-09-02', { habits: { walk: habit() } }),
    day('2026-09-03', { shield: true }),
    day('2026-09-04', { habits: { walk: habit() } }),
  ];
  const s = streaks(daily, { today: '2026-09-04' });
  assert.deepEqual(s.habits[0], { habit: 'walk', current: 3, best: 3, done_today: true });
  assert.deepEqual(s.shields, ['2026-09-03']);
});

test('a date gap (no record) breaks a streak', () => {
  const daily = [
    day('2026-09-01', { habits: { walk: habit() } }),
    day('2026-09-02', { habits: { walk: habit() } }),
    day('2026-09-04', { habits: { walk: habit() } }),
  ];
  const s = streaks(daily, { today: '2026-09-04' });
  assert.equal(s.habits[0].current, 1);
  assert.equal(s.habits[0].best, 2);
});

test('missing today record counts through yesterday; future days ignored', () => {
  const daily = [
    day('2026-09-01', { habits: { water: 2 } }), // plain-number habit counts
    day('2026-09-02', { habits: { water: habit() } }),
    day('2026-09-09', { habits: { water: habit() } }),
  ];
  const s = streaks(daily, { today: '2026-09-03' });
  assert.deepEqual(s.habits[0], { habit: 'water', current: 2, best: 2, done_today: false });
});

test('study goal streak uses done_minutes >= target_minutes', () => {
  const goal = (done) => [{ label: 'Math', subject: 'math', target_minutes: 120, done_minutes: done }];
  const daily = [
    day('2026-09-01', { goals: goal(130) }),
    day('2026-09-02', { goals: goal(60) }),
    day('2026-09-03', { goals: goal(120) }),
    day('2026-09-04', { goals: goal(125) }),
    day('2026-09-05', { goals: goal(30), hmwk_by_subject: { math: 30 } }),
  ];
  const s = streaks(daily, { today: '2026-09-05' });
  assert.deepEqual(s.study_goal, {
    subject: 'math', label: 'Math', target_minutes: 120, today_minutes: 30, met_today: false, current: 2, best: 2,
  });
});

test('study goal falls back to hmwk_by_subject when done_minutes is missing', () => {
  const daily = [
    day('2026-09-01', { goals: [{ label: 'Math', subject: 'math', target_minutes: 60 }], hmwk_by_subject: { Math: 70 } }),
    day('2026-09-02', { goals: [{ label: 'Math', subject: 'math', target_minutes: 60 }], hmwk_by_subject: { math: 61 } }),
  ];
  const s = streaks(daily, { today: '2026-09-02' });
  assert.equal(s.study_goal.met_today, true);
  assert.equal(s.study_goal.today_minutes, 61);
  assert.equal(s.study_goal.current, 2);
});

test('streaks handles empty and junk input', () => {
  assert.deepEqual(streaks([], { today: '2026-09-01' }), { today: '2026-09-01', habits: [], study_goal: null, shields: [] });
  assert.deepEqual(streaks(null, { today: '2026-09-01' }).habits, []);
  assert.deepEqual(streaks([day('2026-09-01', { habits: null, goals: null })], { today: '2026-09-01' }).habits, []);
});

// --- painTimeline -------------------------------------------------------------

test('painTimeline finds foods in the window before each report, across midnight', () => {
  const daily = [
    day('2026-09-01', {
      meals: [{ at: at('2026-09-01', '22:30'), text: 'spicy chips' }],
      foods: ['spicy chip'],
    }),
    day('2026-09-02', {
      meals: [
        { at: at('2026-09-02', '08:00'), text: 'oatmeal' },
        { at: at('2026-09-02', '12:00'), text: 'pizza and soda' },
      ],
      foods: ['oatmeal', 'pizza', 'soda'],
      pain_reports: [
        { at: at('2026-09-02', '00:30'), pain: 5, text: 'cramps' },
        { at: at('2026-09-02', '13:30'), pain: null, text: 'stomach hurts' }, // unscored still counts
        { at: at('2026-09-02', '18:00'), pain: 0, text: 'no pain' }, // not an episode
      ],
    }),
  ];
  const t = painTimeline(daily, { hours: 3 });
  assert.equal(t.episodes.length, 2);
  const [night, lunch] = t.episodes;
  assert.equal(night.date, '2026-09-02');
  assert.equal(night.pain, 5);
  assert.deepEqual(night.foods_before, [{ at: at('2026-09-01', '22:30'), label: 'spicy chip', minutes_before: 120 }]);
  assert.equal(lunch.pain, null);
  assert.equal(lunch.text, 'stomach hurts');
  assert.deepEqual(lunch.foods_before.map((f) => [f.label, f.minutes_before]), [['pizza', 90], ['soda', 90]]);
  // oatmeal at 08:00 is 5.5 h before 13:30 -> outside the 3 h window.
  assert.ok(!lunch.foods_before.some((f) => f.label === 'oatmeal'));
});

test('painTimeline falls back to same-day foods when meals have no times', () => {
  const daily = [day('2026-09-03', {
    foods: ['ramen'],
    meals: [{ at: null, text: 'ramen' }],
    pain_reports: [{ at: at('2026-09-03', '15:00'), pain: 4, text: null }],
  })];
  const t = painTimeline(daily);
  assert.deepEqual(t.episodes[0].foods_before, [{ at: null, label: 'ramen', minutes_before: null }]);
});

test('painTimeline suspects: episodes vs times eaten, sorted, once-eaten clean foods dropped', () => {
  const daily = [];
  for (let i = 0; i < 4; i++) {
    const date = addDays('2026-09-10', i);
    const milk = i < 3;
    daily.push(day(date, {
      meals: [
        { at: at(date, '09:00'), text: milk ? 'cereal with milk' : 'toast' },
        { at: at(date, '13:00'), text: 'rice' },
      ],
      foods: milk ? ['cereal', 'milk', 'rice'] : ['toast', 'rice'],
      pain_reports: i < 2 ? [{ at: at(date, '10:00'), pain: 6, text: null }] : [],
    }));
  }
  const t = painTimeline(daily, { hours: 3 });
  assert.equal(t.episodes.length, 2);
  const byFood = Object.fromEntries(t.suspects.map((s) => [s.food, s]));
  assert.deepEqual(byFood.milk, { food: 'milk', episodes: 2, eaten: 3, rate: 0.67 });
  assert.deepEqual(byFood.cereal, { food: 'cereal', episodes: 2, eaten: 3, rate: 0.67 });
  assert.deepEqual(byFood.rice, { food: 'rice', episodes: 0, eaten: 4, rate: 0 });
  assert.equal(byFood.toast, undefined); // eaten once, no episode
  assert.equal(t.suspects.at(-1).food, 'rice');
});

test('painTimeline counts a day-level score without reports, and handles empty input', () => {
  const t = painTimeline([day('2026-09-01', { stomach_pain: 3, foods: ['bean'] })]);
  assert.equal(t.episodes.length, 1);
  assert.equal(t.episodes[0].pain, 3);
  assert.equal(t.episodes[0].foods_before[0].label, 'bean');
  assert.deepEqual(painTimeline([]).episodes, []);
  assert.deepEqual(painTimeline(undefined).suspects, []);
});

// --- doordash -----------------------------------------------------------------

test('doordashSummary groups shifts by Monday week with hourly rates', () => {
  const daily = [
    day('2026-09-06', { doordash: null }), // Sunday, nothing
    day('2026-09-07', { // Monday
      doordash: {
        shifts: [
          { row_id: 'r1', start: '17:00', end: '19:00', minutes: 120, pay: 40, offers: 6, miles: 30, gas_cost: 5, net_profit: 35, net_per_hour: 17.5, net_per_mile: 1.17, note: null },
          { row_id: 'r2', start: '20:00', end: '21:00', minutes: 60, pay: 20, offers: null, miles: null, gas_cost: null, net_profit: null, net_per_hour: null, net_per_mile: null, note: 'slow' },
        ],
        pay: 60, net_profit: 35, miles: 30, minutes: 180,
      },
    }),
    day('2026-09-13', { doordash: { shifts: [{ row_id: 'r3', minutes: 60, pay: 25, net_profit: 20, miles: 10 }] } }), // Sunday same week
    day('2026-09-14', { doordash: { shifts: [{ row_id: 'r4', minutes: 30, pay: '12.50' }] } }), // next Monday
  ];
  const s = doordashSummary(daily);
  assert.equal(s.shifts.length, 4);
  assert.equal(s.shifts[0].date, '2026-09-07');
  assert.equal(s.shifts[3].pay, 12.5);
  assert.equal(s.weeks.length, 2);
  assert.deepEqual(s.weeks[0], {
    week_start: '2026-09-07', days: 2, shifts: 3, pay: 85, net_profit: 55, minutes: 240, miles: 40, per_hour: 21.25, net_per_hour: 13.75,
  });
  assert.equal(s.weeks[1].week_start, '2026-09-14');
  assert.equal(s.weeks[1].net_profit, null);
  assert.equal(s.weeks[1].per_hour, 25);
  assert.equal(s.weeks[1].net_per_hour, null);
  assert.equal(s.totals.pay, 97.5);
  assert.equal(s.totals.shifts, 4);
  assert.equal(s.totals.minutes, 270);
});

test('doordashSummary is empty without data', () => {
  const s = doordashSummary([day('2026-09-01')]);
  assert.deepEqual(s.shifts, []);
  assert.deepEqual(s.weeks, []);
  assert.equal(s.totals.pay, null);
  assert.equal(s.totals.per_hour, null);
  assert.equal(doordashSummary(null).totals.shifts, 0);
});

// --- moods --------------------------------------------------------------------

test('moodSummary lists check-ins and ranks feelings', () => {
  const daily = [
    day('2026-09-01', { moods: [{ at: at('2026-09-01', '10:00'), feelings: ['Anxious', 'tired'], severity: 6, cause: 'test', notes: null }] }),
    day('2026-09-02', { moods: [{ at: at('2026-09-02', '10:00'), feelings: ['tired'], severity: null, cause: null, notes: 'meh' }, { feelings: ['calm', 'anxious'], severity: 2 }] }),
    day('2026-09-03', { moods: null }),
  ];
  const m = moodSummary(daily);
  assert.equal(m.checkins.length, 3);
  assert.equal(m.checkins[0].date, '2026-09-01');
  assert.deepEqual(m.top_feelings, [{ feeling: 'anxious', count: 2 }, { feeling: 'tired', count: 2 }, { feeling: 'calm', count: 1 }]);
  assert.equal(m.average_severity, 4);
  assert.deepEqual(moodSummary([]), { checkins: [], top_feelings: [], average_severity: null });
});

// --- recap --------------------------------------------------------------------

function fullDay() {
  const date = '2026-09-20';
  return [
    day('2026-09-19', { xp: 500, meals: [{ at: at('2026-09-19', '23:00'), text: 'ice cream' }], foods: ['ice cream'] }),
    day(date, {
      hmwk_minutes: 95,
      hmwk_by_subject: { math: 60, english: 35 },
      goals: [{ label: 'Math', subject: 'math', target_minutes: 120, done_minutes: 60 }],
      work_minutes: 0,
      doordash: { shifts: [{ minutes: 120, pay: 48, net_profit: 40 }], pay: 48, net_profit: 40, minutes: 120 },
      sleep_hours: 7.5, wake_time: '07:10', bedtime: '23:30',
      meals: [{ at: at(date, '12:00'), text: 'burger and fries' }],
      foods: ['burger', 'fries'],
      pain_reports: [
        { at: at(date, '00:45'), pain: 4, text: null },
        { at: at(date, '13:00'), pain: null, text: 'nausea' },
      ],
      acne_spots: 3,
      xp: 120, xp_events: [{ amount: 120 }],
      todos: [{ id: 'a', status: 'done', done: true }, { id: 'b', status: 'open', done: false }, { id: 'c', status: 'open', done: false }],
    }),
  ];
}

test('recap states only logged facts', () => {
  const r = recap(fullDay(), { date: '2026-09-20' });
  assert.equal(r.date, '2026-09-20');
  assert.ok(r.text.startsWith('Sun 9/20 recap:'));
  assert.ok(r.text.length <= 600, `too long: ${r.text.length}`);
  const t = r.text;
  assert.match(t, /Homework: 1h 35m \(Math 60, English 35 min\)\./);
  assert.match(t, /Math goal: 60\/120 min, not met\./);
  assert.match(t, /DoorDash: \$48 pay, \$40 net, \$20\/h net \(1 shift, 2h\)\./);
  assert.match(t, /Sleep: 7\.5 h, up at 7:10 AM, bed at 11:30 PM\./);
  assert.match(t, /Stomach pain: 2 episodes \(4\/10 at 12:45 AM after ice cream; unscored at 1:00 PM after burger, fries\)\./);
  assert.match(t, /Acne: 3 spots\./);
  assert.match(t, /XP: \+120 today, level 3 \(620 total\)\./);
  assert.match(t, /To-dos: 1 done, 2 open\./);
  assert.ok(!/Work:/.test(t)); // 0 work minutes -> no line
  assert.ok(!/Headache/.test(t));
  assert.ok(!/ {2}/.test(t));
  assert.equal(r.lines.length, 8);
});

test('recap skips missing data and handles unlogged days', () => {
  const r = recap([day('2026-09-20', { sleep_hours: 8 })], { date: '2026-09-20' });
  assert.deepEqual(r.lines, ['Sleep: 8 h.']);
  assert.equal(recap([], { date: '2026-09-21' }).text, 'Mon 9/21 recap: nothing logged.');
  assert.deepEqual(recap([day('2026-09-21')], { date: '2026-09-21' }).lines, []);
});

test('recap stays under 600 chars when there is a lot of data', () => {
  const big = fullDay();
  const d = big[1];
  d.hmwk_by_subject = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`subject number ${i}`, 10 + i]));
  d.goals = Array.from({ length: 10 }, (_, i) => ({ label: `Goal ${i}`, subject: `subject number ${i}`, target_minutes: 60 }));
  const r = recap(big, { date: '2026-09-20' });
  assert.ok(r.text.length <= 600);
});

// --- weekly report ------------------------------------------------------------

function twoWeeks() {
  const daily = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays('2026-09-08', i); // 9/8 .. 9/21
    const thisWeek = i >= 7;
    daily.push(day(date, {
      hmwk_minutes: thisWeek ? 60 + i : 30,
      hmwk_by_subject: { math: thisWeek ? 60 + i : 30 },
      goals: [{ label: 'Math', subject: 'math', target_minutes: 68, done_minutes: thisWeek ? 60 + i : 30 }],
      sleep_hours: thisWeek ? 8 : 7,
      xp: thisWeek ? 100 : 50,
      xp_events: [{ amount: 1 }],
      habits: { water: habit() },
      acne_spots: thisWeek ? 10 - (i - 7) : null,
      meals: [{ at: at(date, '12:00'), text: i % 2 ? 'taco' : 'salad' }],
      foods: [i % 2 ? 'taco' : 'salad'],
      pain_reports: i % 2 ? [{ at: at(date, '13:00'), pain: thisWeek ? null : 5, text: 'pain' }] : [],
      moods: thisWeek ? [{ feelings: ['tired'] }] : [],
      doordash: thisWeek && i % 3 === 0 ? { shifts: [{ minutes: 60, pay: 20, net_profit: 15 }] } : null,
    }));
  }
  return daily;
}

test('weeklyReport compares this week with last and stays under 1200 chars', () => {
  const r = weeklyReport(twoWeeks(), { end: '2026-09-21' });
  assert.equal(r.start, '2026-09-15');
  assert.equal(r.end, '2026-09-21');
  const s = r.sections;
  assert.deepEqual(s.days_logged, { this_week: 7, last_week: 7 });
  assert.equal(s.comparable, true);
  assert.equal(s.study.minutes, 7 * 60 + (7 + 8 + 9 + 10 + 11 + 12 + 13));
  assert.equal(s.study.last_week_minutes, 210);
  assert.equal(s.study.change_minutes, s.study.minutes - 210);
  assert.deepEqual(s.study.best_day, { date: '2026-09-21', minutes: 73 });
  assert.deepEqual(s.goals, { days_with_goal: 7, days_met: 6 }); // 9/15 had 67 < 68
  assert.equal(s.sleep.average_hours, 8);
  assert.equal(s.sleep.change_hours, 1);
  assert.equal(s.pain.episodes, 4); // odd i in 7..13 -> 7, 9, 11, 13 (all unscored)
  assert.equal(s.pain.unscored, 4);
  assert.equal(s.pain.last_week_episodes, 3);
  assert.equal(s.pain.change, 1);
  assert.deepEqual(s.pain.suspected_foods, [{ food: 'taco', episodes: 4 }]);
  assert.equal(s.acne.trend, 'improving');
  assert.equal(s.acne.change, -6);
  assert.equal(s.xp.gained, 700);
  assert.equal(s.xp.change, 350);
  assert.equal(s.xp.total, 1050);
  assert.equal(s.xp.level, 3);
  assert.equal(s.doordash.shifts, 2); // i = 9, 12
  assert.equal(s.doordash.pay, 40);
  assert.equal(s.doordash.per_hour, 20);
  assert.equal(s.doordash.last_week_pay, null);
  assert.deepEqual(s.moods.top_feelings, [{ feeling: 'tired', count: 7 }]);
  assert.equal(s.streaks.habits[0].habit, 'water');
  assert.equal(s.streaks.habits[0].current, 14);
  assert.ok(r.text.length <= 1200);
  assert.match(r.text, /^Week 9\/15-9\/21: 7\/7 days logged\./);
  assert.match(r.text, /Stomach pain: 4 episodes \(\+1 vs last week\); eaten before: taco \(4\)\./);
  assert.match(r.text, /DoorDash: \$40 pay, \$30 net, \$20\/h over 2 shifts\./);
  assert.ok(!/Not enough data/.test(r.text));
  assert.ok(!/ {2}/.test(r.text));
});

test('weeklyReport says not enough data instead of comparing', () => {
  const daily = twoWeeks().filter((d) => d.date >= '2026-09-19');
  const r = weeklyReport(daily, { end: '2026-09-21' });
  assert.equal(r.sections.comparable, false);
  assert.equal(r.sections.study.change_minutes, null);
  assert.equal(r.sections.xp.change, null);
  assert.equal(r.sections.study.last_week_minutes, null);
  assert.match(r.text, /Not enough data to compare with last week\./);
  assert.ok(!/vs last week/.test(r.text));

  const empty = weeklyReport([], { end: '2026-09-21' });
  assert.match(empty.text, /Not enough data/);
  assert.equal(empty.sections.study.minutes, null);
  assert.equal(empty.sections.doordash, null);
  assert.equal(empty.sections.sleep.average_hours, null);
});
