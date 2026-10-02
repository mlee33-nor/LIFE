// Regression tests for how Hermes actually writes the sheet (QA 2026-10-01).
// Synthetic rows only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHabit, mapSheetRows, mergeSheetTabs, normDate, parseCsv, preferDirectEntries, subjectOf } from '../src/sheet.js';
import { interpret, localDate } from '../src/interpret.js';

const HEADER = 'row_id,date,time_local,timezone,tracker,category,event,label,value,unit,outcome,status,start_at,end_at,minutes_reported,minutes_confirmed,xp_awarded,meal_id,onset_minutes_approx,source_message_ids,photo_reference,notes,photo_url,credit_date,reported_at_local';
const csv = (...lines) => parseCsv([HEADER, ...lines].join('\n'));
const run = (rows, opts) => {
  const issues = [];
  const events = mapSheetRows(rows, issues).map((e, i) => ({ id: String(i), tracker: e.tracker, at: new Date(e.at), data: e.data })).sort((a, b) => a.at - b.at);
  return { ...interpret(events, opts), issues, events };
};
const dayOf = (r, date) => r.daily.find((d) => d.date === date);

test('wake-ups logged as sleep/wake or routine/wake are wake-ups, not bedtimes', () => {
  const r = run(csv(
    'b1,2026-09-28,1:30,,Life,sleep,bed,Went to sleep,,,,user_reported,2026-09-28 1:30,2026-09-28 8:15,405,405,0,,,,,,,,',
    'w1,2026-09-28,8:15,,Life,sleep,wake,Awake,,,,user_reported,,2026-09-28 8:15,405,405,0,,,,,,,,',
    'w2,2026-09-29,7:57,,Life,routine,wake,Wake,,,,reported_closed,2026-09-29T07:57:00-07:00,,0,0,0,,,,,,,,',
  ));
  const d1 = dayOf(r, '2026-09-28');
  assert.equal(d1.wake_time, '08:15');
  assert.equal(d1.bedtime, '01:30');
  assert.equal(d1.sleep_hours, 6.75);
  assert.equal(dayOf(r, '2026-09-29').wake_time, '07:57');
  assert.ok(!dayOf(r, '2026-09-29').habits.bedtime);
});

test('a forgotten start does not swallow a later session; its end counts on its own day', () => {
  const r = run(csv(
    's-old,2026-09-30,19:37,,Life,homework,start,Math,,,,open,2026-09-30T19:37:02-07:00,,,,0,,,,,,,,',
    'e-new,2026-10-01,11:15,,Life,homework,end,Math,,,,reported_end,2026-10-01 11:00,2026-10-01 11:15,15,15,0,,,,,,,,',
  ), { now: new Date('2026-10-01T20:00:00-07:00') });
  assert.equal(dayOf(r, '2026-09-30').hmwk_minutes, 0);
  assert.equal(dayOf(r, '2026-10-01').hmwk_minutes, 15);
  assert.equal(r.activeSessions.length, 0);
  assert.deepEqual(r.staleSessions.map((s) => s.row_id), ['s-old']);
});

test('an end with no minutes never invents a multi-day session', () => {
  const r = run(csv(
    's,2026-09-28,9:00,,Life,work,start,Job,,,,open,2026-09-28 9:00,,,,0,,,,,,,,',
    'e,2026-10-01,10:00,,Life,work,end,Job,,,,reported_end,,2026-10-01 10:00,,,0,,,,,,,,',
  ));
  assert.ok(r.daily.every((d) => d.work_minutes === 0));
});

test('paused homework keeps its minutes; credit_date moves a row to the credited day', () => {
  const r = run(csv(
    'p,2026-10-01,18:20,,Life,homework,pause,Math,,,,reported_paused,2026-10-01T17:23:52-07:00,2026-10-01T18:20:08-07:00,57,57,30,,,,,,,2026-10-01,',
    'c,2026-09-28,0:20,,Life,homework,end,Math,,,,reported_closed,2026-09-27 23:50,2026-09-28 0:20,30,30,0,,,,,,,2026-09-27,2026-09-28 0:20',
  ));
  assert.equal(dayOf(r, '2026-10-01').hmwk_minutes, 57);
  assert.equal(dayOf(r, '2026-09-27').hmwk_minutes, 30);
  assert.equal(dayOf(r, '2026-09-28')?.hmwk_minutes ?? 0, 0);
});

test('a start with confirmed minutes but no end still counts those minutes', () => {
  const r = run(csv('s,2026-09-24,19:00,,Life,homework,start,,,,,partially_confirmed_15m,2026-09-24 19:00,2026-09-24 20:00,60,15,10,,,,,,,,'));
  assert.equal(r.daily[0].hmwk_minutes, 15);
  assert.equal(r.activeSessions.length + r.staleSessions.length, 0);
});

test('habit names collapse to one name each', () => {
  assert.equal(canonicalHabit('PM face wash / night routine finished', 'skin_pm'), 'pm_skincare');
  assert.equal(canonicalHabit('PM face routine', 'skin_pm'), 'pm_skincare');
  assert.equal(canonicalHabit('Teeth brushed', 'night_habit'), 'brush_teeth');
  assert.equal(canonicalHabit('Brush teeth', 'ritual'), 'brush_teeth');
  assert.equal(canonicalHabit('teeth', 'ritual'), 'brush_teeth');
  assert.equal(canonicalHabit('Morning face wash', 'face'), 'wash_face');
  assert.equal(canonicalHabit('skin_am', 'care'), 'am_skincare');
  assert.equal(canonicalHabit('AM skin routine', 'skin_am'), 'am_skincare');
  assert.equal(canonicalHabit('room_cleaned', 'bonus'), 'room_clean');
  assert.equal(canonicalHabit('Change', 'ritual'), 'get_dressed');
  assert.equal(canonicalHabit('food', 'care'), 'meal');
  assert.equal(canonicalHabit('breakfast', 'ritual'), 'breakfast');
});

test('subjects merge case and filler words; a Math goal counts Calculus too', () => {
  assert.equal(subjectOf('General HMWK'), 'general');
  assert.equal(subjectOf('Math practice / review'), 'math');
  assert.equal(subjectOf(''), 'general');
  const r = run(csv(
    'g,2026-09-28,8:52,,Life,goal,daily_target,Math practice / review,120,minutes per day,,user_requested_active,,,120,,0,,,,,,,,',
    'a,2026-09-28,12:00,,Life,homework,duration,Calculus,,,,reported,,,90,90,0,,,,,,,,',
    'b,2026-09-29,12:00,,Life,homework,duration,Math,,,,reported,,,130,130,0,,,,,,,,',
  ));
  assert.deepEqual(dayOf(r, '2026-09-28').goals.map((g) => [g.subject, g.done_minutes, g.target_minutes, g.complete]), [['math', 90, 120, false]]);
  const carried = dayOf(r, '2026-09-29').goals[0];
  assert.deepEqual([carried.subject, carried.done_minutes, carried.complete, carried.carried], ['math', 130, true, true]);
});

test('US-style dates are read; unreadable rows are reported, not silently dropped', () => {
  assert.equal(normDate('9/30/2026'), '2026-09-30');
  assert.equal(normDate('2026/9/3'), '2026-09-03');
  const r = run(csv(
    'u,9/30/2026,10:00,,Life,bonus,bonus,shower,,,,reported,,,,,10,,,,,,,,',
    'x,yesterday,10:00,,Life,bonus,bonus,shower,,,,reported,,,,,10,,,,,,,,',
    'u,2026-09-30,11:00,,Life,bonus,bonus,shower,,,,reported,,,,,10,,,,,,,,',
    'k,2026-09-30,11:00,,Mystery,bonus,bonus,shower,,,,reported,,,,,10,,,,,,,,',
  ));
  assert.equal(dayOf(r, '2026-09-30').xp, 10);
  assert.deepEqual(r.issues.map((i) => i.row_id), ['x', 'u', 'k']);
});

test('the same meal_id on different days stays two meals', () => {
  const r = run(csv(
    'f1,2026-09-25,12:00,,Food + stomach,food,reported,Burrito,,,no pain reported,,,,,,,lunch,,,,,,,',
    'f2,2026-09-26,12:00,,Food + stomach,food,reported,Pizza,,,no pain reported,,,,,,,lunch,,,,,,,',
  ));
  assert.deepEqual(r.daily.map((d) => d.foods), [['burrito'], ['pizza']]);
});

test('after-midnight rows credited to the evening before get the real clock date', () => {
  const r = run(csv('life-20260926T0010-care-1,2026-09-25,0:10,,Life,care,skin_pm,PM routine,,,,reported_after_midnight,,,,,20,,,,,,,,'));
  assert.equal(r.events[0].at.toISOString(), '2026-09-26T07:10:00.000Z');
  assert.equal(r.daily[0].date, '2026-09-25');
});

test('emotion, recovery shield, notes and MB go to their own places', () => {
  const r = run(csv(
    'm,2026-09-25,16:12,,Life,emotion,emotion,mood,stressed; overwhelmed,,,reported,,,,,0,,,,,,,,',
    'f,2026-09-25,11:00,,Life,freeze,freeze,Recovery day,,,,reported_recovery_shield,,,,,0,,,,,,,,',
    'n,2026-09-25,11:00,,Life,note,reported,Nausea,,,,reported,,,,,,,,,,Feeling nauseous,,,',
    'mb,2026-09-25,14:21,,Life,mb,mb,MB,10m reported,,miss,ambiguous,,,,,0,,,,,,,,',
  ));
  const d = r.daily[0];
  assert.deepEqual(d.moods[0].feelings, ['stressed', 'overwhelmed']);
  assert.equal(d.shield, true);
  assert.equal(d.life_notes[0].text, 'Nausea — Feeling nauseous');
  assert.deepEqual(d.missed_habits, []);
});

test('numbers sent as strings still count', () => {
  const at = new Date('2026-09-25T12:00:00-07:00');
  const { daily } = interpret([
    { id: '1', tracker: 'life', at, data: { kind: 'xp', amount: '10' } },
    { id: '2', tracker: 'food', at, data: { kind: 'pain_report', pain: '6' } },
    { id: '3', tracker: 'skin', at, data: { kind: 'note', severity: '5' } },
  ]);
  assert.deepEqual([daily[0].xp, daily[0].stomach_pain, daily[0].acne], [10, 6, 5]);
});

test('a to-do finished on a later day is done, not carried over', () => {
  const { daily } = interpret([
    { id: '1', tracker: 'life', at: new Date('2026-09-29T09:00:00-07:00'), data: { kind: 'todo', todo_id: 't1', text: 'Essay' } },
    { id: '2', tracker: 'life', at: new Date('2026-09-30T20:00:00-07:00'), data: { kind: 'todo', todo_id: 't1', status: 'done' } },
  ]);
  assert.equal(daily.find((d) => d.date === '2026-09-29').todos[0].status, 'done');
  assert.equal(daily.find((d) => d.date === '2026-09-30')?.todos.length ?? 0, 0);
});

test('side tabs: DoorDash details, a missing Skin row, a mangled spot count, Food pain score', () => {
  const all = csv(
    'dd-1,2026-09-27,2:42 PM,,DoorDash,dash,dash,Dash #1,9.15,USD net,closed,verified,2026-09-27 14:42,2026-09-27 15:57,75,75,0,,,,,,,,',
    'sk-spots,2026-09-25,0:07,,Skin,skin_log,reported,Visible inflamed spots,0:00,estimated count,,agent_photo_estimate,,,,,,,,,,,,2026-09-25,2026-09-26 0:07',
    'food-1,2026-09-24,18:12,,Food + stomach,drink,reported,Iced coffee,,,pain reported,,,,,,,m1,20,,,,,,',
  );
  const dash = parseCsv('row_id,date,start,end,minutes,pay,offers,miles,gas_cost,gas_source,net_profit,net_per_hour,net_per_mile,note\ndd-1,2026-09-27,2:42 PM,3:57 PM,75,13,2,18,3.85,estimated,9.15,7.32,0.51,BK\ndd-2,2026-10-01,0.4895833333,0.5486111111,85,,,,,estimated,,,,pending\nrow_id,date,amount,category,note,,,,,,,,,\ndd-exp-1,2026-09-27,6.67,supplies,Energy drink,,,,,,,,,');
  const skin = parseCsv('row_id,date,time_local,timezone,label,value,unit,confirmation_status,source_message_ids,qualifier,xp,photo_reference,rule_id,photo_url,credit_date,reported_at_local,correction_source\nsk-spots,2026-09-25,0:07,,Visible inflamed spots,16,estimated count,agent_photo_estimate,,,,,,,,,\nsk-am,2026-09-29,,,AM cleanser,TRUE,,user_reported,,,,,,,,,');
  const food = parseCsv('row_id,date,reported_at_local,eaten_at_local,eaten_time_status,meal_id,event_type,label,original_wording,details,quantity,symptom_outcome,symptom_confirmation,onset_minutes_approx,severity_0_10\nfood-1,2026-09-24,,,,m1,drink,Iced coffee,,,,pain reported,,20,4');
  const r = run(mergeSheetTabs(all, [dash, skin, food]));
  const dd = dayOf(r, '2026-09-27').doordash;
  assert.deepEqual([dd.pay, dd.miles, dd.net_profit, dd.expenses, dd.net_after_expenses], [13, 18, 9.15, 6.67, 2.48]);
  const oct1 = dayOf(r, '2026-10-01').doordash.shifts[0];
  assert.deepEqual([oct1.start, oct1.minutes, oct1.pay], ['2026-10-01T11:45:00-07:00', 85, null]);
  assert.equal(dayOf(r, '2026-09-25').acne_spots, 16);
  assert.ok(dayOf(r, '2026-09-29').habits.am_skincare);
  assert.equal(dayOf(r, '2026-09-24').stomach_pain, 4);
});

test('a direct entry never hides different sheet entries of the same kind', () => {
  const day = '2026-09-01T12:00:00-07:00';
  const sheet = (tracker, data) => ({ tracker, at: new Date(day), data: { ...data, source: 'sheet' } });
  const direct = (tracker, data) => ({ tracker, at: new Date(day), data });
  const kept = preferDirectEntries([
    sheet('food', { kind: 'meal', items: ['eggs'] }),
    sheet('life', { kind: 'xp', amount: 20, reason: 'hmwk' }),
    sheet('life', { kind: 'xp', amount: 30, reason: 'walk' }),
    sheet('life', { kind: 'habit', habit: 'water', value: 3 }),
    direct('food', { kind: 'meal', items: ['pizza'] }),
    direct('life', { kind: 'xp', amount: 5, reason: 'water' }),
    direct('life', { kind: 'habit', habit: 'water', value: 1 }),
    direct('life', { kind: 'xp', amount: 20, reason: 'HMWK' }), // same as the sheet's: replaces it
  ], localDate);
  const { daily } = interpret(kept.map((e, i) => ({ id: String(i), ...e })));
  assert.deepEqual([daily[0].foods.sort(), daily[0].xp, daily[0].water], [['egg', 'pizza'], 55, 4]);
});
