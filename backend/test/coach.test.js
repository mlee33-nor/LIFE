import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caffeine, countdown, isCaffeinated, nudges } from '../src/coach.js';
import { interpret } from '../src/interpret.js';
import { mapSheetRows, parseCsv } from '../src/sheet.js';

const ev = (id, tracker, at, data) => ({ id: String(id), tracker, at: new Date(at), data });

test('caffeine detection', () => {
  for (const s of ['Dutch Bros Golden Eagle', 'Iced coffee', 'Coke', 'Red Bull', 'Monster Energy', 'matcha latte']) assert.ok(isCaffeinated(s), s);
  for (const s of ['Decaf coffee', 'Sprite', 'Herbal tea', 'Fries', 'Root beer', 'Caffeine-free Coke']) assert.ok(!isCaffeinated(s), s);
});

test('caffeine: servings, pain within 3h, hours before bed, sleep only compared with enough nights', () => {
  const { daily } = interpret([
    ev(1, 'food', '2026-09-24T16:00:00-07:00', { kind: 'meal', text: 'Dutch Bros Golden Eagle, fries' }),
    ev(2, 'food', '2026-09-24T16:20:00-07:00', { kind: 'pain_report', pain: null, text: 'after Golden Eagle' }),
    ev(3, 'life', '2026-09-25T01:00:00-07:00', { kind: 'habit', habit: 'bedtime', day: '2026-09-24' }),
    ev(4, 'life', '2026-09-25T08:00:00-07:00', { kind: 'wake' }),
    ev(5, 'food', '2026-09-25T12:00:00-07:00', { kind: 'meal', text: 'Salad' }),
  ]);
  const c = caffeine(daily);
  assert.equal(c.totals.servings, 1);
  assert.equal(c.totals.followed_by_pain, 1);
  assert.equal(c.days[0].last, '4:00 PM');
  assert.equal(c.days[0].bedtime, '01:00');
  assert.equal(c.days[0].hours_before_bed, 9);
  assert.equal(c.days[0].sleep_hours, 7);
  assert.equal(c.sleep.avg_sleep_after_late, null); // not enough nights to compare
  assert.ok(c.sleep.needs_more_nights > 0);
});

test('exam rows become a countdown with the study pace', () => {
  const header = 'row_id,date,time_local,timezone,tracker,category,event,label,value,unit,outcome,status,start_at,end_at,minutes_reported,minutes_confirmed,xp_awarded';
  const rows = parseCsv([header,
    'x1,2026-09-28,9:00,,Life,exam,exam,MAT 213 Midterm,10/12/2026,,,scheduled,,,,,0',
    'g,2026-09-28,9:00,,Life,goal,daily_target,Math practice,120,minutes per day,,active,,,120,,0',
    'h1,2026-09-30,12:00,,Life,homework,duration,Calculus,,,,reported,,,70,70,0',
    'h2,2026-10-01,12:00,,Life,homework,duration,Math,,,,reported,,,70,70,0',
  ].join('\n'));
  const r = interpret(mapSheetRows(rows).map((e, i) => ({ id: String(i), tracker: e.tracker, at: new Date(e.at), data: e.data })).sort((a, b) => a.at - b.at));
  assert.deepEqual(r.exams.map((e) => [e.label, e.subject, e.date]), [['MAT 213 Midterm', 'math', '2026-10-12']]);
  const c = countdown(r.daily, r.exams, { today: '2026-10-01' });
  assert.deepEqual([c.exams[0].days_left, c.exams[0].studied_last_7_days, c.exams[0].avg_per_day_last_7, c.exams[0].daily_target, c.exams[0].on_pace], [11, 140, 20, 120, false]);
  assert.equal(countdown(r.daily, r.exams, { today: '2026-10-13' }).exams.length, 0); // past exams drop off
});

test('nudges: behind on goal, long timer, stale session, pain with no food, pending pay', () => {
  const day = '2026-10-01';
  const daily = [{
    date: day, goals: [{ subject: 'math', target_minutes: 120, done_minutes: 30, complete: false }],
    wake_time: '07:57', habits: {}, todos: [{ text: 'Essay', status: 'open', priority: 'high' }],
    pain_reports: [{ at: `${day}T15:00:00-07:00`, pain: null, text: 'cramps' }], meals: [],
    doordash: { shifts: [{ row_id: 'dd', start: `${day}T11:45:00-07:00`, pay: null }] },
  }];
  const n = nudges(daily, {
    now: new Date(`${day}T18:00:00-07:00`),
    activeSessions: [{ id: 'a', subject: 'math', activity: 'hmwk', started_at: `${day}T14:00:00-07:00` }],
    staleSessions: [{ row_id: 's', subject: 'math', activity: 'hmwk', started_at: '2026-09-30T19:37:00-07:00' }],
  });
  const ids = n.nudges.map((x) => x.id);
  assert.ok(ids.includes('goal-math'));
  assert.match(n.nudges.find((x) => x.id === 'goal-math').text, /30 of 120 min and it's 6:00 PM\. 90 min left/);
  assert.ok(ids.some((i) => i.startsWith('long-')));
  assert.ok(ids.includes('todos'));
  assert.ok(ids.some((i) => i.startsWith('pain-')));
  assert.ok(ids.some((i) => i.startsWith('dash-')));
  assert.equal(n.nudges.find((x) => x.id === 'stale-s').for, 'motion');
  assert.ok(!n.text.includes('never ended')); // housekeeping isn't texted to Myles
});

test('nudges: nothing to say on a good morning', () => {
  const day = '2026-10-01';
  const n = nudges([{ date: day, goals: [{ subject: 'math', target_minutes: 120, done_minutes: 0, complete: false }], wake_time: '07:00', habits: {}, todos: [], pain_reports: [], meals: [] }],
    { now: new Date(`${day}T09:30:00-07:00`) });
  assert.deepEqual(n.nudges, []);
  assert.equal(n.text, null);
});
