import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSheetRows, parseCsv, preferDirectEntries } from '../src/sheet.js';
import { interpret, localDate } from '../src/interpret.js';

const HEADER = 'row_id,date,time_local,timezone,tracker,category,event,label,value,unit,outcome,status,start_at,end_at,minutes_reported,minutes_confirmed,xp_awarded,meal_id,onset_minutes_approx,source_message_ids,photo_reference,notes';
const csv = (...lines) => parseCsv([HEADER, ...lines].join('\r\n'));
const toEvents = (mapped) => mapped.map((e, i) => ({ id: String(i), tracker: e.tracker, at: new Date(e.at), data: e.data }));

test('life rows: wake, sessions from end rows, xp, habits, misses', () => {
  const rows = csv(
    'l-wake,2026-09-01,7:05,America/Phoenix,Life,wake,wake,,,,,first_wake_text,,,,,25,,,,,',
    'l-s1,2026-09-01,13:39,America/Phoenix,Life,homework,start,History,,,,reported_closed,2026-09-01 13:39,2026-09-01 14:05,26,26,10,,,,,',
    'l-e1,2026-09-01,14:05,America/Phoenix,Life,homework,end,History,,,,reported_end,2026-09-01 13:39,2026-09-01 14:05,26,26,0,,,,,',
    'l-b1,2026-09-01,10:50,America/Phoenix,Life,bonus,bonus,room_cleaned,,,,reported,,,,,10,,,,,',
    'l-m1,2026-09-01,11:26,America/Phoenix,Life,miss,miss,walk,,,,reported,,,,,-10,,,,,',
    'l-sy,2026-09-01,14:05,America/Phoenix,Life,symptom,symptom,headache,,,,reported,,,,,0,,,,,',
  );
  const { daily } = interpret(toEvents(mapSheetRows(rows)));
  const d = daily[0];
  assert.equal(d.wake_time, '07:05');
  assert.equal(d.hmwk_minutes, 26);
  assert.deepEqual(d.hmwk_by_subject, { history: 26 });
  assert.equal(d.xp, 25 + 10 + 10 - 10);
  assert.ok(d.habits.room_clean);
  assert.deepEqual(d.missed_habits, ['walk']);
  assert.equal(d.headache, null); // reported but unscored
  assert.equal(d.headache_reports.length, 1);
});

test('food rows group by meal_id; pain day never reads as pain-free', () => {
  const rows = csv(
    'f1,2026-09-01,2026-09-01 18:12:26 America/Phoenix,America/Phoenix,Food + stomach,food,reported,Sandwich,,,no pain reported,,,,,,,meal-a,,,,',
    'f2,2026-09-01,2026-09-01 18:12:26 America/Phoenix,America/Phoenix,Food + stomach,food,reported,Chips,handful,,no pain reported,,,,,,,meal-a,,,,',
    'd1,2026-09-01,2026-09-01 18:12:26 America/Phoenix,America/Phoenix,Food + stomach,drink,reported,Iced coffee,,,pain reported,,,,,,,meal-b,20,,,',
    'f3,2026-09-02,2026-09-02 12:47:00 America/Phoenix,America/Phoenix,Food + stomach,food,reported,Salad,,,no pain reported,,,,,,,meal-c,,,,',
  );
  const mapped = mapSheetRows(rows);
  const meals = mapped.filter((e) => e.data.kind === 'meal');
  assert.equal(meals.length, 3);
  assert.equal(meals[0].data.text, 'Sandwich, Chips (handful)');
  const { daily } = interpret(toEvents(mapped));
  assert.equal(daily[0].stomach_pain, null); // unscored pain, so no fake 0
  assert.equal(daily[0].pain_reports.length, 1);
  assert.match(daily[0].pain_reports[0].text, /Iced coffee.*20 min/);
  assert.equal(daily[1].stomach_pain, 0); // explicit no-pain day
});

test('skin rows: routines, water oz, sleep, spots; skips derived/pending rows', () => {
  const rows = csv(
    's-am,2026-09-01,,America/Phoenix,Skin,skin_log,reported,AM routine,FALSE,,,user_reported,,,,,,,,,,',
    's-pm,2026-09-01,,America/Phoenix,Skin,skin_log,reported,PM routine,TRUE,,,user_reported,,,,,,,,,,',
    's-w,2026-09-01,,America/Phoenix,Skin,skin_log,reported,Water,40,oz,,user_reported,,,,,,,,,,',
    's-sl,2026-09-01,,America/Phoenix,Skin,skin_log,reported,Night sleep,6,hours,,user_reported,,,,,,,,,,',
    's-sp,2026-09-01,,America/Phoenix,Skin,skin_log,reported,Visible inflamed spots,16,estimated count,,agent_photo_estimate,,,,,,,,,,',
    's-z,2026-09-01,,America/Phoenix,Skin,skin_log,reported,Visible spots: chin,0,estimated count,,agent_photo_estimate,,,,,,,,,,',
    's-sc,2026-09-01,,America/Phoenix,Skin,skin_log,reported,Routine score,20,out of 100,,dashboard_derived,,,,,,,,,,',
    's-p,2026-09-02,,America/Phoenix,Skin,skin_log,reported,PM routine,,,,not_reported,,,,,,,,,,',
  );
  const mapped = mapSheetRows(rows);
  assert.equal(mapped.length, 5);
  const { daily } = interpret(toEvents(mapped));
  const d = daily[0];
  assert.deepEqual(d.missed_habits, ['am_skincare']);
  assert.ok(d.habits.pm_skincare);
  assert.equal(d.water, 5);
  assert.equal(d.sleep_hours, 6);
  assert.equal(d.acne_spots, 16);
});

test('every mapped event has a unique sheet_row_id', () => {
  const rows = csv(
    'l-s1,2026-09-01,18:00,America/Phoenix,Life,work,start,AI work,,,,reported_closed,,,60,60,40,,,,,',
    'l-e1,2026-09-01,19:00,America/Phoenix,Life,work,end,,,,,reported_end,,,60,60,0,,,,,',
  );
  const ids = mapSheetRows(rows).map((e) => e.data.sheet_row_id);
  assert.deepEqual(ids, ['l-s1#xp', 'l-e1']);
  assert.equal(new Set(ids).size, ids.length);
});

test('entries sent directly win over sheet entries for the same day and tracker', () => {
  const sheet = (tracker, at) => ({ tracker, at: new Date(at), data: { source: 'sheet', kind: 'note' } });
  const events = [
    sheet('food', '2026-09-01T12:00:00-07:00'),
    sheet('life', '2026-09-01T12:00:00-07:00'),
    sheet('food', '2026-09-02T12:00:00-07:00'),
    { tracker: 'food', at: new Date('2026-09-01T13:00:00-07:00'), data: { kind: 'meal', text: 'x' } },
  ];
  const kept = preferDirectEntries(events, localDate);
  assert.equal(kept.length, 3); // sheet food on 09-01 dropped; sheet life 09-01 and food 09-02 kept
  assert.ok(!kept.some((e) => e.data.source === 'sheet' && e.tracker === 'food' && localDate(e.at) === '2026-09-01'));
});

test('duration rows count as sessions; mood keeps its wording', () => {
  const rows = csv(
    'l-d,2026-09-01,16:10,America/Phoenix,Life,homework,duration,History,10m reported,,,reported_duration_time_unknown,,,10,10,0,,,,,',
    'l-mo,2026-09-01,16:12,America/Phoenix,Life,emotion,emotion,mood,stressed; overwhelmed,,,reported,,,,,0,,,,,',
  );
  const mapped = mapSheetRows(rows);
  assert.equal(mapped[1].data.kind, 'mood');
  assert.equal(mapped[1].data.text, 'stressed; overwhelmed');
  assert.equal(interpret(toEvents(mapped)).daily[0].hmwk_minutes, 10);
});
