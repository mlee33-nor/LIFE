// Coaching features built on the daily records from interpret.js:
//   nudges()     what's off track right now, for MOTION to text
//   countdown()  days until each upcoming exam, with the study pace
//   caffeine()   caffeine timing vs sleep and stomach pain
// Pure functions, no I/O. Facts from the logs only; nothing is invented.

import { localDate, localIso } from './interpret.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clock = (iso) => (/T(\d{2}):(\d{2})/.exec(String(iso ?? '')) ?? []).slice(1).map(Number);
const minutesOf = (iso) => { const [h, m] = clock(iso); return isNum(h) ? h * 60 + m : null; };
const clockLabel = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  return `${h % 12 || 12}:${String(mins % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const minsLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${Math.round(m % 60)}m` : ''}` : `${Math.round(m)}m`);
const title = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const shift = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// ---- Caffeine ---------------------------------------------------------------

// Drinks/foods that usually contain caffeine. "Dutch Bros" drinks are mostly
// coffee; decaf and caffeine-free items are excluded.
export const CAFFEINE = /\b(coffee|espresso|latte|cappuccino|americano|mocha|macchiato|cold brew|frappuccino|dutch bros|starbucks|golden eagle|coke|cola|pepsi|dr\.? ?pepper|mountain dew|mtn dew|energy drink|red bull|monster|celsius|bang|rockstar|reign|ghost energy|alani|c4|rebel|tea|matcha|chai|yerba)\b/i;
const NOT_CAFFEINE = /\b(decaf|caffeine[- ]free|herbal tea|root beer|sprite|fanta|7 ?up)\b/i;
// Bracketed notes ("burrito (Coke unclear)") don't count.
export const isCaffeinated = (label) => {
  const name = String(label ?? '').replace(/\([^)]*\)/g, ' ');
  return CAFFEINE.test(name) && !NOT_CAFFEINE.test(name);
};

// Items in a meal's text: "Dutch Bros Golden Eagle (large), fries" -> two items.
const mealItems = (text) => String(text ?? '').split(/\s*,\s*(?![^()]*\))/).map((s) => s.trim()).filter(Boolean);

// The bedtime ending `date`'s day, from the next day's record: "01:30" on the
// next day means 1:30 AM after midnight, "23:10" means that evening.
function bedtimeAfter(byDate, date) {
  const next = byDate.get(shift(date, 1));
  if (!next?.bedtime) return null;
  const [h, m] = next.bedtime.split(':').map(Number);
  return h < 12 ? 24 * 60 + h * 60 + m : h * 60 + m;
}

export function caffeine(daily, { hours = 3, lateHour = 15 } = {}) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const days = [];
  let servings = 0;
  let followedByPain = 0;
  for (const d of daily) {
    const items = [];
    for (const meal of d.meals ?? []) {
      for (const label of mealItems(meal.text)) if (isCaffeinated(label)) items.push({ at: meal.at ?? null, label });
    }
    const pains = (d.pain_reports ?? []).filter((p) => !isNum(p.pain) || p.pain > 0);
    for (const item of items) {
      servings++;
      const t = Date.parse(item.at);
      item.pain_after = pains.some((p) => { const pt = Date.parse(p.at); return pt >= t && pt - t <= hours * 3600000; });
      if (item.pain_after) followedByPain++;
    }
    const times = items.map((i) => minutesOf(i.at)).filter(isNum);
    const last = times.length ? Math.max(...times) : null;
    const bed = bedtimeAfter(byDate, d.date);
    const next = byDate.get(shift(d.date, 1));
    days.push({
      date: d.date,
      count: items.length,
      items,
      first: times.length ? clockLabel(Math.min(...times)) : null,
      last: last !== null ? clockLabel(last) : null,
      last_minutes: last,
      bedtime: next?.bedtime ?? null,
      hours_before_bed: last !== null && bed !== null ? round1((bed - last) / 60) : null,
      sleep_hours: isNum(next?.sleep_hours) ? next.sleep_hours : null, // the night after
    });
  }
  const withSleep = days.filter((d) => d.sleep_hours !== null);
  const late = withSleep.filter((d) => d.last_minutes !== null && d.last_minutes >= lateHour * 60);
  const notLate = withSleep.filter((d) => !(d.last_minutes !== null && d.last_minutes >= lateHour * 60));
  const enough = late.length >= 3 && notLate.length >= 3;
  return {
    hours,
    late_hour: lateHour,
    days: days.filter((d) => d.count).map(({ last_minutes, ...d }) => d),
    totals: {
      servings,
      days_with_caffeine: days.filter((d) => d.count).length,
      days_logged: days.length,
      followed_by_pain: followedByPain,
      pain_rate: servings ? round1((followedByPain / servings) * 100) / 100 : null,
    },
    // Only compared once each side has 3+ nights; otherwise null.
    sleep: {
      nights_after_late_caffeine: late.length,
      nights_without: notLate.length,
      avg_sleep_after_late: enough ? round1(avg(late.map((d) => d.sleep_hours))) : null,
      avg_sleep_without: enough ? round1(avg(notLate.map((d) => d.sleep_hours))) : null,
      needs_more_nights: enough ? 0 : Math.max(0, 3 - late.length) + Math.max(0, 3 - notLate.length),
    },
  };
}

// ---- Exam countdown -----------------------------------------------------------

const SUBJECT_GROUPS = [['math', 'calculus', 'calc', 'precalc', 'algebra'], ['science', 'geology', 'biology', 'chemistry', 'physics']];
const subjectMinutes = (d, subject) => {
  if (!subject) return d.hmwk_minutes ?? 0;
  const group = SUBJECT_GROUPS.find((g) => g.includes(subject)) ?? [subject];
  return Object.entries(d.hmwk_by_subject ?? {}).filter(([s]) => group.some((g) => s === g || s.split(' ').includes(g))).reduce((a, [, m]) => a + m, 0);
};

// exams: [{ id, label, subject, date }] from interpret(). Upcoming ones only.
export function countdown(daily, exams = [], { today = localDate(new Date()) } = {}) {
  const lastWeek = daily.filter((d) => d.date > shift(today, -7) && d.date <= today);
  const todayRec = daily.find((d) => d.date === today);
  const upcoming = exams.filter((e) => e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return {
    today,
    exams: upcoming.map((e) => {
      const goal = (todayRec?.goals ?? []).find((g) => g.subject && e.subject && (SUBJECT_GROUPS.find((x) => x.includes(e.subject)) ?? [e.subject]).includes(g.subject));
      const studied7 = lastWeek.reduce((s, d) => s + subjectMinutes(d, e.subject), 0);
      const perDay = lastWeek.length ? Math.round(studied7 / 7) : null;
      const target = isNum(goal?.target_minutes) ? goal.target_minutes : null;
      const daysLeft = daysBetween(today, e.date);
      return {
        id: e.id, label: e.label, subject: e.subject, date: e.date, days_left: daysLeft,
        studied_last_7_days: studied7, avg_per_day_last_7: perDay,
        daily_target: target, on_pace: target !== null && perDay !== null ? perDay >= target : null,
        today_minutes: todayRec ? subjectMinutes(todayRec, e.subject) : 0,
        // Minutes still available at the target pace, today included.
        minutes_at_target_pace: target !== null ? target * Math.max(daysLeft, 0) : null,
      };
    }),
  };
}

// ---- Nudges ---------------------------------------------------------------------

// What's off track right now. Each nudge: { id, level: 'info'|'warn', text, for }.
// `for: 'myles'` is worth texting him; `for: 'motion'` is housekeeping for the agent.
export function nudges(daily, { now = new Date(), activeSessions = [], staleSessions = [], issues = [], exams = [] } = {}) {
  const today = localDate(now);
  const nowMin = minutesOf(localIso(now));
  const hour = nowMin / 60;
  const d = daily.find((x) => x.date === today);
  const out = [];
  const add = (id, level, text, audience = 'myles') => out.push({ id, level, text, for: audience });

  // Study goals: behind the pace needed to finish by 9 PM.
  for (const g of d?.goals ?? []) {
    if (!isNum(g.target_minutes) || g.target_minutes <= 0 || g.complete || !isNum(g.done_minutes)) continue;
    const name = g.subject ? title(g.subject) : g.label;
    const left = Math.round(g.target_minutes - g.done_minutes);
    const expected = g.target_minutes * Math.min(1, Math.max(0, (hour - 9) / 12));
    if (hour >= 21) add(`goal-${g.subject}`, 'warn', `${name} goal not met yet: ${Math.round(g.done_minutes)} of ${g.target_minutes} min (${left} to go).`);
    else if (hour >= 12 && g.done_minutes < expected * 0.8) {
      add(`goal-${g.subject}`, 'warn', `${name}: ${Math.round(g.done_minutes)} of ${g.target_minutes} min and it's ${clockLabel(nowMin)}. ${left} min left to hit today's goal.`);
    }
  }
  // Upcoming exams.
  for (const e of countdown(daily, exams, { today }).exams) {
    if (e.days_left <= 7) add(`exam-${e.id}`, e.days_left <= 2 ? 'warn' : 'info', `${e.label} ${e.days_left === 0 ? 'is today' : e.days_left === 1 ? 'is tomorrow' : `in ${e.days_left} days`}${e.avg_per_day_last_7 !== null ? ` (averaging ${e.avg_per_day_last_7} min/day of ${title(e.subject ?? 'study')} this week)` : ''}.`);
  }
  // A timer that's been running a long time.
  for (const s of activeSessions) {
    const mins = (now - new Date(s.started_at)) / 60000;
    if (mins >= 180) add(`long-${s.row_id ?? s.id}`, 'info', `${title(s.subject ?? s.label ?? s.activity)} timer has been running ${minsLabel(mins)}. Still going?`);
  }
  // Morning / night routine.
  if (d && hour >= 12 && !d.wake_time) add('wake', 'info', 'No wake-up logged today.');
  if (hour >= 22 && !d?.habits?.pm_skincare) add('pm-skincare', 'info', 'No PM skincare logged yet tonight.');
  // Priority to-dos late in the day.
  const urgent = (d?.todos ?? []).filter((t) => t.status === 'open' && t.priority === 'high');
  if (hour >= 17 && urgent.length) add('todos', 'warn', `${urgent.length} priority to-do${urgent.length > 1 ? 's' : ''} still open: ${urgent.map((t) => t.text).join('; ')}.`);
  // Pain reported today with no food logged in the 3 hours before.
  for (const p of (d?.pain_reports ?? []).filter((x) => !isNum(x.pain) || x.pain > 0)) {
    const pt = Date.parse(p.at);
    const ate = (d.meals ?? []).some((m) => { const mt = Date.parse(m.at); return mt <= pt && pt - mt <= 3 * 3600000; });
    if (!ate) add(`pain-${p.at}`, 'info', `Stomach pain at ${clockLabel(minutesOf(p.at))} but no food logged in the 3 hours before. What did you eat?`);
  }
  // Housekeeping for MOTION.
  for (const s of staleSessions) {
    add(`stale-${s.row_id ?? s.id}`, 'warn', `Session never ended: ${title(s.subject ?? s.label ?? s.activity)} started ${s.started_at.slice(5, 10).replace('-', '/')} ${clockLabel(minutesOf(s.started_at))}. Ask when it ended and add the end row.`, 'motion');
  }
  for (const shiftRec of d?.doordash?.shifts ?? []) {
    if (shiftRec.pay === null) add(`dash-${shiftRec.row_id}`, 'info', `DoorDash shift at ${clockLabel(minutesOf(shiftRec.start) ?? 0)}: pay and miles not reported yet.`);
  }
  if (issues.length) add('sync', 'warn', `${issues.length} sheet row${issues.length > 1 ? 's' : ''} couldn't be read (see /api/sync/issues).`, 'motion');

  const forMyles = out.filter((n) => n.for === 'myles');
  return {
    now: localIso(now),
    nudges: out,
    // Ready to text: only the ones meant for Myles.
    text: forMyles.length ? forMyles.map((n) => `• ${n.text}`).join('\n') : null,
  };
}

// ---- Bad habit (MB) -------------------------------------------------------------

// A habit being cut back: when it last happened, days free since, the longest
// free stretch, and counts this week vs last. Null if it has never been logged.
export function badHabit(daily, { today = localDate(new Date()), field = 'mb', label = 'MB' } = {}) {
  const hits = daily.filter((d) => d.date <= today && d[field] > 0).map((d) => ({ date: d.date, count: d[field] }));
  if (!hits.length) return null;
  const first = daily[0]?.date ?? hits[0].date;
  const last = hits.at(-1).date;
  // Free stretches: from the first logged day to each hit, between hits, and up to today.
  const points = [first, ...hits.map((h) => h.date), today];
  let best = 0;
  for (let i = 1; i < points.length; i++) best = Math.max(best, daysBetween(points[i - 1], points[i]) - (i === 1 && points[0] !== hits[0].date ? 0 : 1));
  const sum = (from, to) => hits.filter((h) => h.date > from && h.date <= to).reduce((a, h) => a + h.count, 0);
  return {
    habit: field, label,
    today: daily.find((d) => d.date === today)?.[field] ?? 0,
    last_date: last,
    days_free: daysBetween(last, today),
    best_days_free: Math.max(best, daysBetween(last, today)),
    this_week: sum(shift(today, -7), today),
    last_week: sum(shift(today, -14), shift(today, -7)),
    total: hits.reduce((a, h) => a + h.count, 0),
    dates: hits.map((h) => h.date),
  };
}
