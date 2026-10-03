// Extra derived views over the per-day records from interpret(): XP level,
// habit/study streaks, a nightly recap, a weekly report, a pain/food
// timeline, DoorDash earnings and mood check-ins.
//
// Pure functions: no DB, no I/O. Every figure comes from the records; a field
// that's missing or null is unknown, never filled with a made-up number.

import { foodItem, foodKeywords, localDate } from './interpret.js';
import { addDays, isPainReport } from './analytics.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const toNum = (v) => (isNum(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const round = (n, dp = 2) => (isNum(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const sortedDays = (daily) => arr(daily).filter((d) => d && typeof d.date === 'string').slice().sort((a, b) => a.date.localeCompare(b.date));
const timeOf = (at) => {
  const t = typeof at === 'string' && at ? Date.parse(at) : NaN;
  return Number.isNaN(t) ? null : t;
};
// Sum that stays null when no value was present at all.
const sumOrNull = (values) => {
  const nums = values.filter(isNum);
  return nums.length ? round(nums.reduce((a, b) => a + b, 0)) : null;
};
const rate = (num, den) => (isNum(num) && isNum(den) && den > 0 ? round(num / den) : null);

const weekdayName = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const shortDate = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const fmtMin = (m) => {
  const v = Math.round(m);
  if (v < 60) return `${v} min`;
  return v % 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : `${v / 60}h`;
};
const fmtMoney = (n) => {
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${neg ? '-' : ''}$${s}`;
};
// "2026-09-25T15:20:00-07:00" -> "3:20 PM" (local time as written).
const fmtClock = (s) => {
  const m = typeof s === 'string' ? s.match(/(?:T|^)(\d{2}):(\d{2})/) : null;
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Habit done count: interpret.js stores { count, value }; plain numbers and
// booleans are accepted too.
function habitCount(d, habit) {
  const v = d?.habits?.[habit];
  if (isNum(v)) return v;
  if (v === true) return 1;
  if (v && typeof v === 'object') return isNum(v.count) ? v.count : 1;
  return 0;
}

function painReports(d) {
  return arr(d?.pain_reports).filter(isPainReport);
}

// Pain episodes for a day; a day-level score without reports (hand-built
// records) counts as one untimed episode.
function dayPainEpisodes(d) {
  const reports = painReports(d);
  if (reports.length) return reports.map((r) => ({ at: r.at ?? null, pain: isNum(r.pain) ? r.pain : null, text: r.text ?? null }));
  return isNum(d?.stomach_pain) && d.stomach_pain > 0 ? [{ at: null, pain: d.stomach_pain, text: null }] : [];
}

// ---------------------------------------------------------------------------
// 1. Level
// ---------------------------------------------------------------------------

// Hermes' rule: level = 1 + floor(sqrt(XP / 150)); level L starts at
// 150 * (L - 1)^2 XP.
export function level(totalXp) {
  const xp = Math.max(0, toNum(totalXp) ?? 0);
  let lvl = 1 + Math.floor(Math.sqrt(xp / 150));
  // Guard against floating-point edge cases at exact boundaries.
  while (150 * lvl ** 2 <= xp) lvl++;
  while (lvl > 1 && 150 * (lvl - 1) ** 2 > xp) lvl--;
  const start = 150 * (lvl - 1) ** 2;
  const next = 150 * lvl ** 2;
  return {
    level: lvl,
    xp,
    level_start_xp: start,
    next_level_xp: next,
    progress: round((xp - start) / (next - start), 4),
  };
}

// ---------------------------------------------------------------------------
// 2. Streaks
// ---------------------------------------------------------------------------

// Walks logged days up to `today`. A day counts when `done(d)`; a shield day
// that isn't done neither breaks nor extends the run; a missing date breaks
// it. Today not (yet) done doesn't break the current streak.
function runStreak(days, today, done) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    if (prev !== null && d.date !== addDays(prev, 1)) run = 0;
    prev = d.date;
    if (done(d)) {
      run++;
      if (run > best) best = run;
    } else if (!(d.shield === true) && d.date !== today) {
      run = 0;
    }
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  const todayRec = byDate.get(today);
  const doneToday = Boolean(todayRec && done(todayRec));
  let current = doneToday ? 1 : 0;
  let date = addDays(today, -1);
  for (;;) {
    const d = byDate.get(date);
    if (!d) break;
    if (done(d)) current++;
    else if (d.shield !== true) break;
    date = addDays(date, -1);
  }
  return { current, best: Math.max(best, current), done_today: doneToday };
}

const goalDone = (g, d) => {
  if (isNum(g?.done_minutes)) return g.done_minutes;
  return g?.subject ? subjectMinutes(d, g.subject) : null;
};

function subjectMinutes(d, subject) {
  const by = d?.hmwk_by_subject ?? {};
  if (isNum(by[subject])) return by[subject];
  const key = Object.keys(by).find((k) => k.toLowerCase() === String(subject).toLowerCase());
  return key ? by[key] : 0;
}

const sameSubject = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const studyGoals = (d) => arr(d?.goals).filter((g) => g && g.subject && isNum(g.target_minutes) && g.target_minutes > 0);

// The standing study goal as of `today`: from the latest logged day with a
// study goal, the subject that has a goal on the most days.
function pickStudyGoal(days) {
  const latest = days.slice().reverse().find((d) => studyGoals(d).length);
  if (!latest) return null;
  const freq = (subject) => days.filter((d) => studyGoals(d).some((g) => sameSubject(g.subject, subject))).length;
  return studyGoals(latest).slice().sort((a, b) => freq(b.subject) - freq(a.subject) || b.target_minutes - a.target_minutes)[0];
}

export function streaks(daily, { today } = {}) {
  today = today ?? localDate(new Date());
  const days = sortedDays(daily).filter((d) => d.date <= today);

  const names = new Set();
  for (const d of days) for (const h of Object.keys(d.habits ?? {})) if (habitCount(d, h) > 0) names.add(h);
  const habits = [...names].map((habit) => ({ habit, ...runStreak(days, today, (d) => habitCount(d, habit) > 0) }))
    .sort((a, b) => b.current - a.current || b.best - a.best || a.habit.localeCompare(b.habit));

  let study_goal = null;
  const goal = pickStudyGoal(days);
  if (goal) {
    const met = (d) => {
      const g = studyGoals(d).find((x) => sameSubject(x.subject, goal.subject));
      if (!g) return false;
      const done = goalDone(g, d);
      return isNum(done) && done >= g.target_minutes;
    };
    const todayRec = days.find((d) => d.date === today);
    const todayGoal = todayRec ? studyGoals(todayRec).find((x) => sameSubject(x.subject, goal.subject)) : null;
    const target = todayGoal?.target_minutes ?? goal.target_minutes;
    const todayMinutes = todayRec ? (todayGoal ? goalDone(todayGoal, todayRec) : subjectMinutes(todayRec, goal.subject)) : 0;
    const run = runStreak(days, today, met);
    study_goal = {
      subject: goal.subject,
      label: goal.label ?? null,
      target_minutes: target,
      today_minutes: todayMinutes ?? 0,
      met_today: isNum(todayMinutes) && todayMinutes >= target,
      current: run.current,
      best: run.best,
    };
  }

  return {
    today,
    habits,
    study_goal,
    shields: days.filter((d) => d.shield === true).map((d) => d.date),
  };
}

// ---------------------------------------------------------------------------
// 5. Pain timeline (defined before recap/weekly, which use it)
// ---------------------------------------------------------------------------

// Foods per meal, with the meal's timestamp. Structured `items` on a meal win
// over parsing its text; only names in the day's food list are kept when the
// day has one. Foods on the day that match no timed meal are untimed.
function foodEvents(d) {
  const dayFoods = arr(d.foods);
  const timed = [];
  const matched = new Set();
  for (const m of arr(d.meals)) {
    const t = timeOf(m?.at);
    if (t === null) continue;
    const text = String(m.text ?? '').toLowerCase();
    let items = Array.isArray(m.items) ? m.items.map(foodItem).filter(Boolean) : foodKeywords(m.text);
    if (dayFoods.length) {
      items = items.filter((f) => dayFoods.includes(f));
      for (const f of dayFoods) if (!items.includes(f) && text.includes(f)) items.push(f);
    }
    for (const label of new Set(items)) {
      timed.push({ t, at: m.at, label, date: d.date });
      matched.add(label);
    }
  }
  const untimed = dayFoods.filter((f) => !matched.has(f)).map((label) => ({ t: null, at: null, label, date: d.date }));
  return { timed, untimed };
}

export function painTimeline(daily, { hours = 3 } = {}) {
  const days = sortedDays(daily);
  const windowMs = (isNum(hours) && hours > 0 ? hours : 3) * 3600000;
  const perDay = new Map(days.map((d) => [d.date, foodEvents(d)]));
  const allTimed = [...perDay.values()].flatMap((x) => x.timed).sort((a, b) => a.t - b.t);

  const episodes = [];
  const occurrenceHits = new Set(); // food occurrences followed by an episode
  const occKey = (f) => `${f.date}|${f.t ?? 'untimed'}|${f.label}`;

  for (const d of days) {
    const { timed, untimed } = perDay.get(d.date);
    for (const ep of dayPainEpisodes(d)) {
      const t = timeOf(ep.at);
      let candidates;
      if (t !== null) {
        // Timed foods in the window before the report (crossing midnight),
        // plus the day's untimed foods as a same-day fallback.
        candidates = [
          ...allTimed.filter((f) => f.t <= t && t - f.t <= windowMs),
          ...untimed,
        ];
      } else {
        // Report without a time: everything eaten that day.
        candidates = [...timed, ...untimed];
      }
      const byLabel = new Map();
      for (const f of candidates) {
        const minutes = t !== null && f.t !== null ? Math.round((t - f.t) / 60000) : null;
        const prior = byLabel.get(f.label);
        if (!prior || (minutes !== null && (prior.minutes_before === null || minutes < prior.minutes_before))) {
          byLabel.set(f.label, { at: f.at, label: f.label, minutes_before: minutes });
        }
        occurrenceHits.add(occKey(f));
      }
      const foods_before = [...byLabel.values()].sort((a, b) =>
        (a.minutes_before ?? Infinity) - (b.minutes_before ?? Infinity) || a.label.localeCompare(b.label));
      episodes.push({ at: ep.at, date: d.date, pain: ep.pain, text: ep.text, foods_before });
    }
  }

  // Per food: episodes it preceded vs times eaten (timed meals, plus one per
  // day for untimed foods).
  const stats = new Map();
  const stat = (food) => {
    if (!stats.has(food)) stats.set(food, { food, episodes: 0, eaten: 0, followed: 0 });
    return stats.get(food);
  };
  for (const { timed, untimed } of perDay.values()) {
    for (const f of [...timed, ...untimed]) {
      const s = stat(f.label);
      s.eaten++;
      if (occurrenceHits.has(occKey(f))) s.followed++;
    }
  }
  for (const ep of episodes) for (const f of ep.foods_before) stat(f.label).episodes++;

  const suspects = [...stats.values()]
    .filter((s) => !(s.eaten <= 1 && s.episodes === 0))
    .map((s) => ({ food: s.food, episodes: s.episodes, eaten: s.eaten, rate: rate(s.followed, s.eaten) ?? 0 }))
    .sort((a, b) => b.episodes - a.episodes || b.rate - a.rate || a.food.localeCompare(b.food));

  return { hours: windowMs / 3600000, episodes, suspects };
}

// ---------------------------------------------------------------------------
// 6. DoorDash
// ---------------------------------------------------------------------------

const SHIFT_FIELDS = ['minutes', 'pay', 'offers', 'miles', 'gas_cost', 'net_profit', 'net_per_hour', 'net_per_mile'];

function mondayOf(iso) {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

// Day totals: the record's own totals when present, else summed shifts.
function doordashDay(d) {
  const dd = d?.doordash;
  if (!dd || typeof dd !== 'object') return null;
  const shifts = arr(dd.shifts).map((s) => {
    const out = { date: d.date, row_id: s?.row_id ?? null, start: s?.start ?? null, end: s?.end ?? null, note: s?.note ?? null };
    for (const f of SHIFT_FIELDS) out[f] = toNum(s?.[f]);
    return out;
  });
  const pick = (field) => toNum(dd[field]) ?? sumOrNull(shifts.map((s) => s[field]));
  const totals = {
    date: d.date,
    shifts: shifts.length,
    pay: pick('pay'),
    net_profit: pick('net_profit'),
    minutes: pick('minutes'),
    miles: pick('miles'),
    gas_cost: pick('gas_cost'),
    offers: pick('offers'),
  };
  const hasAny = shifts.length || ['pay', 'net_profit', 'minutes', 'miles'].some((f) => totals[f] !== null);
  return hasAny ? { shifts, totals } : null;
}

function earnings(dayTotals) {
  const pay = sumOrNull(dayTotals.map((t) => t.pay));
  const net = sumOrNull(dayTotals.map((t) => t.net_profit));
  const minutes = sumOrNull(dayTotals.map((t) => t.minutes));
  const miles = sumOrNull(dayTotals.map((t) => t.miles));
  const hours = isNum(minutes) && minutes > 0 ? minutes / 60 : null;
  return {
    pay,
    net_profit: net,
    minutes,
    miles,
    gas_cost: sumOrNull(dayTotals.map((t) => t.gas_cost)),
    per_hour: hours && isNum(pay) ? round(pay / hours) : null,
    net_per_hour: hours && isNum(net) ? round(net / hours) : null,
    net_per_mile: isNum(miles) && miles > 0 && isNum(net) ? round(net / miles) : null,
  };
}

export function doordashSummary(daily) {
  const days = sortedDays(daily).map(doordashDay).filter(Boolean);
  const shifts = days.flatMap((x) => x.shifts);
  const dayTotals = days.map((x) => x.totals);

  const byWeek = new Map();
  for (const t of dayTotals) {
    const w = mondayOf(t.date);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(t);
  }
  const weeks = [...byWeek].sort((a, b) => a[0].localeCompare(b[0])).map(([week_start, list]) => {
    const e = earnings(list);
    return {
      week_start,
      days: list.length,
      shifts: list.reduce((n, t) => n + t.shifts, 0),
      pay: e.pay,
      net_profit: e.net_profit,
      minutes: e.minutes,
      miles: e.miles,
      per_hour: e.per_hour,
      net_per_hour: e.net_per_hour,
    };
  });

  return {
    shifts,
    days: dayTotals,
    weeks,
    totals: { days: dayTotals.length, shifts: shifts.length, ...earnings(dayTotals) },
  };
}

// ---------------------------------------------------------------------------
// 7. Moods
// ---------------------------------------------------------------------------

export function moodSummary(daily) {
  const checkins = sortedDays(daily).flatMap((d) => arr(d.moods).filter(Boolean).map((m) => ({
    date: d.date,
    at: m.at ?? null,
    feelings: arr(m.feelings).map((f) => String(f).trim()).filter(Boolean),
    severity: toNum(m.severity),
    cause: m.cause ?? null,
    notes: m.notes ?? null,
  })));
  const counts = new Map();
  for (const c of checkins) {
    for (const f of new Set(c.feelings.map((x) => x.toLowerCase()))) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  const top_feelings = [...counts].map(([feeling, count]) => ({ feeling, count }))
    .sort((a, b) => b.count - a.count || a.feeling.localeCompare(b.feeling));
  const sev = checkins.map((c) => c.severity).filter(isNum);
  return {
    checkins,
    top_feelings,
    average_severity: sev.length ? round(sev.reduce((a, b) => a + b, 0) / sev.length, 1) : null,
  };
}

// ---------------------------------------------------------------------------
// 3. Nightly recap
// ---------------------------------------------------------------------------

const RECAP_MAX = 600;

function fitLines(head, lines, max) {
  let text = head;
  const used = [];
  for (const line of lines) {
    const next = `${text} ${line}`;
    if (next.length > max) continue;
    text = next;
    used.push(line);
  }
  return { text, used };
}

export function recap(daily, { date } = {}) {
  const days = sortedDays(daily);
  date = date ?? localDate(new Date());
  const d = days.find((x) => x.date === date);
  const head = `${weekdayName(date)} ${shortDate(date)} recap:`;
  if (!d) return { date, text: `${head} nothing logged.`, lines: [] };

  const lines = [];

  // Homework by subject vs goals.
  const subjects = Object.entries(d.hmwk_by_subject ?? {}).filter(([, m]) => isNum(m) && m > 0).sort((a, b) => b[1] - a[1]);
  const hw = isNum(d.hmwk_minutes) && d.hmwk_minutes > 0 ? d.hmwk_minutes : subjects.reduce((a, [, m]) => a + m, 0);
  if (hw > 0) {
    const parts = subjects.map(([s, m]) => `${cap(s)} ${m}`).join(', ');
    lines.push(`Homework: ${fmtMin(hw)}${parts ? ` (${parts} min)` : ''}.`);
  }
  for (const g of studyGoals(d)) {
    const done = goalDone(g, d) ?? 0;
    lines.push(`${cap(g.label || g.subject)} goal: ${done}/${g.target_minutes} min${done >= g.target_minutes ? ', met' : ', not met'}.`);
  }

  // Work and DoorDash.
  if (isNum(d.work_minutes) && d.work_minutes > 0) lines.push(`Work: ${fmtMin(d.work_minutes)}.`);
  const dd = doordashDay(d);
  if (dd) {
    const t = dd.totals;
    const bits = [];
    if (isNum(t.pay)) bits.push(`${fmtMoney(t.pay)} pay`);
    if (isNum(t.net_profit)) bits.push(`${fmtMoney(t.net_profit)} net`);
    const e = earnings([t]);
    if (isNum(e.net_per_hour)) bits.push(`${fmtMoney(e.net_per_hour)}/h net`);
    const span = [t.shifts ? plural(t.shifts, 'shift') : null, isNum(t.minutes) && t.minutes > 0 ? fmtMin(t.minutes) : null].filter(Boolean).join(', ');
    if (bits.length || span) lines.push(`DoorDash: ${bits.join(', ') || 'logged'}${span ? ` (${span})` : ''}.`);
  }

  // Sleep.
  const sleepBits = [];
  if (isNum(d.sleep_hours)) sleepBits.push(`${round(d.sleep_hours, 1)} h`);
  if (d.wake_time) sleepBits.push(`up at ${fmtClock(d.wake_time) ?? d.wake_time}`);
  if (d.bedtime) sleepBits.push(`bed at ${fmtClock(d.bedtime) ?? d.bedtime}`);
  if (sleepBits.length) lines.push(`Sleep: ${sleepBits.join(', ')}.`);

  // Stomach pain with foods eaten before (looking back across midnight).
  const window = [addDays(date, -1), date];
  const timeline = painTimeline(days.filter((x) => window.includes(x.date)));
  const eps = timeline.episodes.filter((e) => e.date === date);
  if (eps.length) {
    const desc = eps.map((e) => {
      const score = isNum(e.pain) ? `${e.pain}/10` : 'unscored';
      const when = fmtClock(e.at);
      const foods = e.foods_before.slice(0, 3).map((f) => f.label);
      return `${score}${when ? ` at ${when}` : ''}${foods.length ? ` after ${foods.join(', ')}` : ''}`;
    });
    lines.push(`Stomach pain: ${plural(eps.length, 'episode')} (${desc.join('; ')}).`);
  }
  const headaches = arr(d.headache_reports);
  if (headaches.length || (isNum(d.headache) && d.headache > 0)) {
    const n = headaches.length || 1;
    lines.push(`Headache: ${plural(n, 'report')}${isNum(d.headache) ? `, worst ${d.headache}/10` : ''}.`);
  }

  // Skin.
  if (isNum(d.acne_spots)) lines.push(`Acne: ${plural(d.acne_spots, 'spot')}.`);

  // MB (a habit he's cutting): logged today, or how long since the last one.
  const mbDays = days.filter((x) => x.date <= date && x.mb > 0).map((x) => x.date);
  if (d.mb > 0) lines.push(`MB: logged${d.mb > 1 ? ` ${d.mb}x` : ''} today.`);
  else if (mbDays.length) {
    const since = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${mbDays.at(-1)}T12:00:00Z`)) / 86400000);
    lines.push(`MB-free: ${plural(since, 'day')}.`);
  }

  // XP and level (total through this date).
  const hasXp = arr(d.xp_events).length > 0 || (isNum(d.xp) && d.xp !== 0);
  if (hasXp) {
    const total = days.filter((x) => x.date <= date).reduce((a, x) => a + (isNum(x.xp) ? x.xp : 0), 0);
    const lv = level(total);
    lines.push(`XP: ${d.xp >= 0 ? '+' : ''}${d.xp} today, level ${lv.level} (${total} total).`);
  }

  // To-dos.
  const todos = arr(d.todos).filter((t) => t && t.status !== 'skipped');
  if (todos.length) {
    const done = todos.filter((t) => t.done === true || t.status === 'done').length;
    lines.push(`To-dos: ${done} done, ${todos.length - done} open.`);
  }

  if (!lines.length) return { date, text: `${head} nothing tracked yet.`, lines: [] };
  const { text, used } = fitLines(head, lines, RECAP_MAX);
  return { date, text, lines: used };
}

// ---------------------------------------------------------------------------
// 4. Weekly report
// ---------------------------------------------------------------------------

export const WEEKLY_MIN_DAYS = 3;
const WEEKLY_MAX = 1200;

export function weeklyReport(daily, { end } = {}) {
  const days = sortedDays(daily);
  end = end ?? localDate(new Date());
  const start = addDays(end, -6);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(end, -13);
  const thisWeek = days.filter((d) => d.date >= start && d.date <= end);
  const lastWeek = days.filter((d) => d.date >= prevStart && d.date <= prevEnd);
  const comparable = thisWeek.length >= WEEKLY_MIN_DAYS && lastWeek.length >= WEEKLY_MIN_DAYS;
  const diff = (a, b) => (comparable && isNum(a) && isNum(b) ? round(a - b, 1) : null);
  const avg = (vals) => (vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 1) : null);

  // Study.
  const hwOf = (d) => {
    if (isNum(d.hmwk_minutes)) return d.hmwk_minutes;
    return Object.values(d.hmwk_by_subject ?? {}).filter(isNum).reduce((a, b) => a + b, 0);
  };
  const bySubject = {};
  for (const d of thisWeek) {
    for (const [s, m] of Object.entries(d.hmwk_by_subject ?? {})) if (isNum(m)) bySubject[s] = (bySubject[s] ?? 0) + m;
  }
  const best = thisWeek.reduce((b, d) => (hwOf(d) > 0 && (!b || hwOf(d) > b.minutes) ? { date: d.date, minutes: hwOf(d) } : b), null);
  const studyThis = thisWeek.length ? thisWeek.reduce((a, d) => a + hwOf(d), 0) : null;
  const studyLast = lastWeek.length ? lastWeek.reduce((a, d) => a + hwOf(d), 0) : null;
  const study = {
    minutes: studyThis,
    last_week_minutes: studyLast,
    change_minutes: diff(studyThis, studyLast),
    by_subject: Object.fromEntries(Object.entries(bySubject).sort((a, b) => b[1] - a[1])),
    best_day: best,
  };

  // Study goal days.
  const goalDays = thisWeek.filter((d) => studyGoals(d).length);
  const metDays = goalDays.filter((d) => studyGoals(d).every((g) => (goalDone(g, d) ?? 0) >= g.target_minutes));
  const goals = { days_with_goal: goalDays.length, days_met: metDays.length };

  // Sleep.
  const sleepThis = thisWeek.map((d) => d.sleep_hours).filter(isNum);
  const sleepLast = lastWeek.map((d) => d.sleep_hours).filter(isNum);
  const sleep = {
    average_hours: avg(sleepThis),
    last_week_average_hours: avg(sleepLast),
    change_hours: sleepThis.length >= WEEKLY_MIN_DAYS && sleepLast.length >= WEEKLY_MIN_DAYS ? round(avg(sleepThis) - avg(sleepLast), 1) : null,
    nights: sleepThis.length,
  };

  // Pain (foods may come from the day before the week starts).
  const timeline = painTimeline(days.filter((d) => d.date >= addDays(start, -1) && d.date <= end));
  const weekEps = timeline.episodes.filter((e) => e.date >= start);
  const foodCount = new Map();
  for (const e of weekEps) for (const f of e.foods_before) foodCount.set(f.label, (foodCount.get(f.label) ?? 0) + 1);
  const suspects = [...foodCount].map(([food, episodes]) => ({ food, episodes }))
    .sort((a, b) => b.episodes - a.episodes || a.food.localeCompare(b.food)).slice(0, 5);
  const lastEps = lastWeek.reduce((n, d) => n + dayPainEpisodes(d).length, 0);
  const pain = {
    episodes: weekEps.length,
    last_week_episodes: lastWeek.length ? lastEps : null,
    change: diff(weekEps.length, lastEps),
    unscored: weekEps.filter((e) => e.pain === null).length,
    suspected_foods: suspects,
  };

  // Acne trend (first vs latest spot count this week).
  const spotDays = thisWeek.filter((d) => isNum(d.acne_spots));
  const acne = {
    first: spotDays[0] ? { date: spotDays[0].date, spots: spotDays[0].acne_spots } : null,
    latest: spotDays.length >= 2 ? { date: spotDays.at(-1).date, spots: spotDays.at(-1).acne_spots } : null,
    change: spotDays.length >= 2 ? spotDays.at(-1).acne_spots - spotDays[0].acne_spots : null,
    trend: null,
    days: spotDays.length,
  };
  if (acne.change !== null) acne.trend = acne.change < 0 ? 'improving' : acne.change > 0 ? 'worse' : 'flat';

  // XP.
  const xpSum = (list) => (list.length ? list.reduce((a, d) => a + (isNum(d.xp) ? d.xp : 0), 0) : null);
  const xpTotal = days.filter((d) => d.date <= end).reduce((a, d) => a + (isNum(d.xp) ? d.xp : 0), 0);
  const xp = {
    gained: xpSum(thisWeek),
    last_week_gained: xpSum(lastWeek),
    change: diff(xpSum(thisWeek), xpSum(lastWeek)),
    total: xpTotal,
    level: level(xpTotal).level,
  };

  // DoorDash.
  const ddThis = doordashSummary(thisWeek).totals;
  const ddLast = doordashSummary(lastWeek).totals;
  const doordash = ddThis.days ? { ...ddThis, last_week_pay: ddLast.days ? ddLast.pay : null } : null;

  // Moods.
  const m = moodSummary(thisWeek);
  const moods = { checkins: m.checkins.length, top_feelings: m.top_feelings.slice(0, 3), average_severity: m.average_severity };

  // Streaks as of the end date.
  const st = streaks(days, { today: end });
  const streakHighlights = {
    habits: st.habits.filter((h) => h.current >= 2).slice(0, 3).map(({ habit, current, best: b }) => ({ habit, current, best: b })),
    study_goal: st.study_goal ? { subject: st.study_goal.subject, current: st.study_goal.current, best: st.study_goal.best } : null,
    shields_used: st.shields.filter((dt) => dt >= start).length,
  };

  const sections = {
    days_logged: { this_week: thisWeek.length, last_week: lastWeek.length },
    comparable,
    study, goals, sleep, pain, acne, xp, doordash, moods,
    streaks: streakHighlights,
  };

  // Text.
  const head = `Week ${shortDate(start)}-${shortDate(end)}: ${thisWeek.length}/7 days logged.`;
  if (!thisWeek.length) return { start, end, text: `${head} Not enough data for a report.`, sections };
  const vs = (change, unit) => {
    if (!comparable) return '';
    if (!isNum(change)) return '';
    if (change === 0) return ' (same as last week)';
    return ` (${change > 0 ? '+' : ''}${change}${unit} vs last week)`;
  };
  const lines = [];
  if (studyThis > 0) {
    lines.push(`Study: ${fmtMin(studyThis)}${vs(study.change_minutes, ' min')}${best ? `, best ${weekdayName(best.date)} ${fmtMin(best.minutes)}` : ''}.`);
  }
  if (goals.days_with_goal) lines.push(`Study goal met ${goals.days_met}/${goals.days_with_goal} days.`);
  if (sleep.nights) lines.push(`Sleep: avg ${sleep.average_hours} h over ${plural(sleep.nights, 'night')}${isNum(sleep.change_hours) && sleep.change_hours !== 0 ? ` (${sleep.change_hours > 0 ? '+' : ''}${sleep.change_hours} h vs last week)` : ''}.`);
  if (pain.episodes) {
    lines.push(`Stomach pain: ${plural(pain.episodes, 'episode')}${vs(pain.change, '')}${suspects.length ? `; eaten before: ${suspects.slice(0, 3).map((s) => `${s.food} (${s.episodes})`).join(', ')}` : ''}.`);
  } else if (thisWeek.some((d) => arr(d.foods).length || arr(d.pain_reports).length)) {
    lines.push('No stomach pain episodes logged.');
  }
  if (acne.change !== null) lines.push(`Acne: ${acne.first.spots} -> ${acne.latest.spots} spots (${acne.trend}).`);
  if (thisWeek.some((d) => arr(d.xp_events).length || (isNum(d.xp) && d.xp !== 0))) {
    lines.push(`XP: +${xp.gained}${vs(xp.change, '')}, level ${xp.level}.`);
  }
  if (doordash) {
    const bits = [isNum(doordash.pay) ? `${fmtMoney(doordash.pay)} pay` : null, isNum(doordash.net_profit) ? `${fmtMoney(doordash.net_profit)} net` : null,
      isNum(doordash.per_hour) ? `${fmtMoney(doordash.per_hour)}/h` : null].filter(Boolean);
    lines.push(`DoorDash: ${bits.join(', ') || 'logged'} over ${plural(doordash.shifts || doordash.days, doordash.shifts ? 'shift' : 'day')}.`);
  }
  if (moods.checkins) {
    lines.push(`Mood: ${plural(moods.checkins, 'check-in')}${moods.top_feelings.length ? `, mostly ${moods.top_feelings.map((f) => f.feeling).join(', ')}` : ''}.`);
  }
  const sh = streakHighlights.habits.map((h) => `${h.habit.replace(/_/g, ' ')} ${h.current}d`);
  if (streakHighlights.study_goal?.current >= 2) sh.unshift(`${streakHighlights.study_goal.subject} goal ${streakHighlights.study_goal.current}d`);
  if (sh.length) lines.push(`Streaks: ${sh.join(', ')}.`);
  const mbCount = (list) => list.reduce((a, d) => a + (isNum(d.mb) ? d.mb : 0), 0);
  if (mbCount(thisWeek) || mbCount(lastWeek)) {
    lines.push(`MB: ${mbCount(thisWeek)} this week${comparable ? ` (${mbCount(lastWeek)} last week)` : ''}.`);
  }
  if (!comparable) lines.push('Not enough data to compare with last week.');

  const { text } = fitLines(head, lines, WEEKLY_MAX);
  return { start, end, text, sections };
}
