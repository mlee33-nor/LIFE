// "This week": the 7 days ending `end` compared with the 7 days before.
// Every number comes from logged days only: an unlogged day is unknown, not
// zero, and anything that can't be worked out is null rather than a guess.
// Each item says how many days it's based on and whether that's enough.

import { localDate } from './interpret.js';
import { addDays } from './analytics.js';

// Days of data (in each week) needed before a figure or comparison is shown
// as meaningful.
export const MIN_DAYS = 3;

const weekday = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const round1 = (n) => Math.round(n * 10) / 10;
const sum = (list, f) => list.reduce((acc, x) => acc + (f(x) ?? 0), 0);
const avg = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// A day counts as logged when it has any events. Records without an
// event_count (hand-built ones) are treated as logged since they exist.
const logged = (d) => Boolean(d) && (d.event_count ?? 1) > 0;

export function weeklyReview(daily = [], { end } = {}) {
  end = end ?? localDate(new Date());
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const range = (from) => Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const thisDates = range(addDays(end, -6));
  const lastDates = range(addDays(end, -13));
  const days = (dates) => dates.map((date) => byDate.get(date)).filter(logged);
  const thisWeek = days(thisDates);
  const lastWeek = days(lastDates);
  const comparable = thisWeek.length >= MIN_DAYS && lastWeek.length >= MIN_DAYS;
  const change = (a, b, ok) => (ok && isNum(a) && isNum(b) ? round1(a - b) : null);

  // --- XP ---------------------------------------------------------------
  const xpDays = (list) => list.filter((d) => (d.xp_events?.length ?? 0) > 0 || (isNum(d.xp) && d.xp !== 0));
  const xpTotal = (list) => (list.length ? sum(list, (d) => (isNum(d.xp) ? d.xp : 0)) : null);
  const bestXp = xpDays(thisWeek).reduce((best, d) => (!best || d.xp > best.xp ? { date: d.date, xp: d.xp } : best), null);
  const xp = {
    this_week: xpTotal(thisWeek),
    last_week: xpTotal(lastWeek),
    change: null,
    days: { this_week: xpDays(thisWeek).length, last_week: xpDays(lastWeek).length },
    best_day: bestXp && bestXp.xp > 0 ? bestXp : null,
    enough_data: comparable,
  };
  xp.change = change(xp.this_week, xp.last_week, comparable);

  // --- Homework ---------------------------------------------------------
  const hwDays = (list) => list.filter((d) => (d.hmwk_minutes ?? 0) > 0);
  const hwTotal = (list) => (list.length ? sum(list, (d) => d.hmwk_minutes) : null);
  const bySubject = {};
  for (const d of thisWeek) {
    for (const [subject, minutes] of Object.entries(d.hmwk_by_subject ?? {})) {
      bySubject[subject] = (bySubject[subject] ?? 0) + minutes;
    }
  }
  const goals = thisWeek.flatMap((d) => d.goals ?? []);
  const homework = {
    this_week_minutes: hwTotal(thisWeek),
    last_week_minutes: hwTotal(lastWeek),
    change_minutes: null,
    by_subject: Object.fromEntries(Object.entries(bySubject).sort((a, b) => b[1] - a[1])),
    days: { this_week: hwDays(thisWeek).length, last_week: hwDays(lastWeek).length },
    goals: { hit: goals.filter((g) => g.complete).length, set: goals.length },
    enough_data: comparable,
  };
  homework.change_minutes = change(homework.this_week_minutes, homework.last_week_minutes, comparable);

  // --- To-dos -------------------------------------------------------------
  const todoList = thisWeek.flatMap((d) => d.todos ?? []).filter((t) => t.status !== 'skipped');
  const todos = {
    done: todoList.filter((t) => t.status === 'done' || t.done === true).length,
    total: todoList.length,
    days: thisWeek.filter((d) => (d.todos?.length ?? 0) > 0).length,
    enough_data: todoList.length > 0,
  };

  // --- Acne ---------------------------------------------------------------
  const spotDays = thisWeek.filter((d) => isNum(d.acne_spots));
  const first = spotDays[0] ?? null;
  const last = spotDays.at(-1) ?? null;
  const acne = {
    first: first ? { date: first.date, spots: first.acne_spots } : null,
    latest: spotDays.length >= 2 ? { date: last.date, spots: last.acne_spots } : null,
    change: spotDays.length >= 2 ? last.acne_spots - first.acne_spots : null,
    days: spotDays.length,
    photo_days: thisWeek.filter((d) => (d.skin?.photo_list?.length ?? d.skin?.photos ?? 0) > 0).length,
    enough_data: spotDays.length >= 2,
  };

  // --- Stomach ------------------------------------------------------------
  const foodsOn = (date) => byDate.get(date)?.foods ?? [];
  const reports = thisWeek.flatMap((d) => (d.pain_reports ?? []).map((r) => {
    const sameDay = foodsOn(d.date);
    const dayBefore = foodsOn(addDays(d.date, -1));
    return {
      date: d.date,
      at: r.at ?? null,
      pain: isNum(r.pain) ? r.pain : null,
      text: r.text ?? null,
      foods_same_day: sameDay,
      foods_day_before: dayBefore,
      foods_before: [...new Set([...sameDay, ...dayBefore])],
    };
  }));
  const scores = reports.map((r) => r.pain).filter(isNum);
  const foodDays = thisWeek.filter((d) => (d.foods?.length ?? 0) > 0);
  const painDates = new Set(daily.filter((d) => (d.pain_reports?.length ?? 0) > 0).map((d) => d.date));
  let safeFoods = null;
  if (foodDays.length >= MIN_DAYS) {
    // A food is "no pain after" when, every time it was eaten, there was no
    // pain report that day or the next - and the next day was logged, so the
    // quiet isn't just a gap in the log.
    const clean = new Map(); // food -> days eaten with a clean follow-up
    const flagged = new Set();
    for (const d of foodDays) {
      const next = addDays(d.date, 1);
      for (const food of d.foods) {
        if (painDates.has(d.date) || painDates.has(next)) flagged.add(food);
        else if (logged(byDate.get(next))) clean.set(food, (clean.get(food) ?? 0) + 1);
      }
    }
    safeFoods = [...clean]
      .filter(([food]) => !flagged.has(food))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([food, times]) => ({ food, days: times }));
  }
  const stomach = {
    reports: reports.length,
    last_week_reports: lastWeek.reduce((n, d) => n + (d.pain_reports?.length ?? 0), 0),
    change_reports: null,
    scored_reports: scores.length,
    average_pain: avg(scores),
    food_days: foodDays.length,
    pain_reports: reports,
    safe_foods: safeFoods,
    enough_data: foodDays.length >= MIN_DAYS,
  };
  stomach.change_reports = change(stomach.reports, stomach.last_week_reports, comparable);

  // --- Headaches ----------------------------------------------------------
  const headacheDays = (list) => list.filter((d) => (d.headache_reports?.length ?? 0) > 0 || isNum(d.headache)).length;
  const headaches = {
    days: headacheDays(thisWeek),
    last_week_days: headacheDays(lastWeek),
    days_logged: thisWeek.length,
    enough_data: thisWeek.length >= MIN_DAYS,
  };

  // --- Sleep --------------------------------------------------------------
  const nights = (list) => list.map((d) => d.sleep_hours).filter(isNum);
  const sleepThis = nights(thisWeek);
  const sleepLast = nights(lastWeek);
  const sleep = {
    average_hours: avg(sleepThis),
    last_week_average_hours: avg(sleepLast),
    change_hours: change(avg(sleepThis), avg(sleepLast), sleepThis.length >= MIN_DAYS && sleepLast.length >= MIN_DAYS),
    nights: sleepThis.length,
    last_week_nights: sleepLast.length,
    enough_data: sleepThis.length >= MIN_DAYS,
  };

  const review = {
    end,
    this_week: { from: thisDates[0], to: end },
    last_week: { from: lastDates[0], to: lastDates[6] },
    min_days: MIN_DAYS,
    days_logged: { this_week: thisWeek.length, last_week: lastWeek.length },
    xp,
    homework,
    todos,
    acne,
    stomach,
    headaches,
    sleep,
  };
  review.highlights = highlights(review);
  return review;
}

// Short plain statements built only from figures that exist.
export function highlights(r) {
  const out = [];
  if (r.days_logged.this_week > 0) out.push(`Logged ${r.days_logged.this_week} of 7 days`);

  const hw = r.homework.change_minutes;
  if (isNum(hw) && hw !== 0) out.push(`${Math.abs(hw)} min ${hw > 0 ? 'more' : 'less'} homework than last week`);
  else if (hw === 0) out.push('Same homework time as last week');

  if (r.homework.goals.set > 0) out.push(`Hit ${r.homework.goals.hit} of ${plural(r.homework.goals.set, 'study goal')}`);

  if (r.xp.best_day) out.push(`Best XP day: ${weekday(r.xp.best_day.date)} (${r.xp.best_day.xp})`);
  const xp = r.xp.change;
  if (isNum(xp) && xp !== 0) out.push(`${Math.abs(xp)} ${xp > 0 ? 'more' : 'less'} XP than last week`);

  if (r.todos.total > 0) out.push(`Finished ${r.todos.done} of ${plural(r.todos.total, 'to-do')}`);

  if (r.acne.enough_data) {
    out.push(`Spot count ${r.acne.first.spots} → ${r.acne.latest.spots} (${weekday(r.acne.first.date)} to ${weekday(r.acne.latest.date)})`);
  }

  if (r.stomach.reports > 0) out.push(plural(r.stomach.reports, 'stomach pain report'));
  else if (r.stomach.enough_data) out.push('No stomach pain reports logged');

  if (r.headaches.days > 0) out.push(`Headache logged on ${plural(r.headaches.days, 'day')}`);

  if (r.sleep.enough_data) out.push(`Averaged ${r.sleep.average_hours} h sleep over ${r.sleep.nights} nights`);
  return out;
}
