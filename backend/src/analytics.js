// Derived insights over the daily records produced by aggregateDaily().
// These are simple associations over personal data, not medical findings.

import { HABITS, METRICS, localDate } from './interpret.js';

export const SYMPTOMS = ['stomach_pain', 'acne', 'headache'];

// Days after eating a food to look for a symptom. Stomach pain tends to
// show up the same or next day; acne usually lags by a few days.
export const SYMPTOM_WINDOWS = {
  stomach_pain: [0, 1],
  acne: [1, 3],
  headache: [0, 1],
};

// A day at or above this score counts as a "flare" day.
export const FLARE_THRESHOLD = 4;

const round = (n, dp = 2) =>
  n === null || Number.isNaN(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

export function filterRange(records, from, to) {
  return records.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

// Compares the symptom score `lag` days after eating `food` with the score
// `lag` days after days it wasn't eaten.
function compareAtLag(daily, byDate, food, symptom, lag) {
  const withFood = [];
  const without = [];
  for (const d of daily) {
    const v = byDate.get(addDays(d.date, lag))?.[symptom];
    if (v === null || v === undefined) continue;
    (d.foods.includes(food) ? withFood : without).push(v);
  }
  if (withFood.length === 0 || without.length === 0) return null;
  return {
    lag_days: lag,
    days_eaten: withFood.length,
    avg_after_eating: mean(withFood),
    avg_otherwise: mean(without),
    difference: mean(withFood) - mean(without),
    flare_rate_after_eating: withFood.filter((s) => s >= FLARE_THRESHOLD).length / withFood.length,
  };
}

// For each food, compares the symptom score after eating it against the
// score after days it wasn't eaten, separately for each lag in the
// symptom's window, and reports the lag with the biggest effect.
// Positive `difference` = worse after eating.
export function foodTriggers(daily, { minDays = 3, windows = SYMPTOM_WINDOWS } = {}) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const allFoods = [...new Set(daily.flatMap((d) => d.foods))];
  const result = {};

  for (const symptom of SYMPTOMS) {
    const [start, end] = windows[symptom];
    const rows = [];
    for (const food of allFoods) {
      const byLag = [];
      for (let lag = start; lag <= end; lag++) {
        const c = compareAtLag(daily, byDate, food, symptom, lag);
        if (c && c.days_eaten >= minDays) byLag.push(c);
      }
      if (byLag.length === 0) continue;

      const best = byLag.reduce((a, b) => (b.difference > a.difference ? b : a));
      rows.push({
        food,
        days_eaten: best.days_eaten,
        lag_days: best.lag_days,
        avg_after_eating: round(best.avg_after_eating),
        avg_otherwise: round(best.avg_otherwise),
        difference: round(best.difference),
        flare_rate_after_eating: round(best.flare_rate_after_eating),
        confidence: best.days_eaten >= 10 ? 'medium' : 'low',
        by_lag: byLag.map((c) => ({ lag_days: c.lag_days, difference: round(c.difference), days_eaten: c.days_eaten })),
      });
    }
    rows.sort((a, b) => b.difference - a.difference);
    result[symptom] = {
      window_days: windows[symptom],
      foods: rows,
    };
  }
  return result;
}

function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function describeR(r) {
  if (r === null) return 'not enough data';
  const a = Math.abs(r);
  if (a < 0.2) return 'none';
  const strength = a < 0.4 ? 'weak' : a < 0.6 ? 'moderate' : 'strong';
  return `${strength} ${r > 0 ? 'positive' : 'negative'}`;
}

// Correlates each lifestyle metric with each symptom on the same day and
// the following day (e.g. poor sleep -> next-day acne).
export function lifestyleCorrelations(daily) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const factors = METRICS.filter((m) => !SYMPTOMS.includes(m));
  const rows = [];

  for (const factor of factors) {
    for (const symptom of SYMPTOMS) {
      for (const lag of [0, 1]) {
        const pairs = [];
        for (const d of daily) {
          const target = byDate.get(addDays(d.date, lag));
          if (d[factor] !== null && target && target[symptom] !== null) {
            pairs.push([d[factor], target[symptom]]);
          }
        }
        const r = pearson(pairs);
        rows.push({
          factor,
          symptom,
          lag_days: lag,
          r: round(r),
          n: pairs.length,
          strength: describeR(r),
        });
      }
    }
  }
  rows.sort((a, b) => Math.abs(b.r ?? 0) - Math.abs(a.r ?? 0));
  return rows;
}

function averages(days) {
  const out = {};
  for (const m of METRICS) {
    out[m] = round(mean(days.map((d) => d[m]).filter((v) => v !== null)));
  }
  return out;
}

function currentStreak(daily, symptom, endDate) {
  // Consecutive logged days, counting back from endDate, below the flare threshold.
  let streak = 0;
  let expected = endDate;
  for (let i = daily.length - 1; i >= 0; i--) {
    const d = daily[i];
    if (d.date > endDate) continue;
    if (d.date !== expected) break;
    if (d[symptom] !== null && d[symptom] >= FLARE_THRESHOLD) break;
    streak++;
    expected = addDays(expected, -1);
  }
  return streak;
}

// Headline numbers for the last `days` days ending at `to` (defaults to the
// most recent logged date), plus the same numbers for the preceding period.
export function summary(daily, { days = 30, to } = {}) {
  if (daily.length === 0) return { period: null, message: 'No data logged yet' };

  const end = to ?? daily[daily.length - 1].date;
  const start = addDays(end, -(days - 1));
  const current = filterRange(daily, start, end);
  const prevEnd = addDays(start, -1);
  const previous = filterRange(daily, addDays(prevEnd, -(days - 1)), prevEnd);

  const curAvg = averages(current);
  const prevAvg = averages(previous);
  const change = {};
  for (const m of METRICS) {
    change[m] = curAvg[m] === null || prevAvg[m] === null ? null : round(curAvg[m] - prevAvg[m]);
  }

  const foodCounts = {};
  for (const d of current) for (const f of d.foods) foodCounts[f] = (foodCounts[f] ?? 0) + 1;
  const topFoods = Object.entries(foodCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([food, days_eaten]) => ({ food, days_eaten }));

  const worst = (symptom) => {
    const logged = current.filter((d) => d[symptom] !== null);
    if (!logged.length) return null;
    const top = logged.reduce((a, b) => (b[symptom] > a[symptom] ? b : a));
    return { date: top.date, value: top[symptom] };
  };

  const lastLogged = daily[daily.length - 1].date;

  return {
    period: { from: start, to: end, days },
    days_logged: current.length,
    last_logged_date: lastLogged,
    days_since_last_log: daysBetween(lastLogged, localDate(new Date())),
    averages: curAvg,
    previous_period_averages: prevAvg,
    change_vs_previous: change,
    flare_days: Object.fromEntries(
      SYMPTOMS.map((s) => [s, current.filter((d) => d[s] !== null && d[s] >= FLARE_THRESHOLD).length])
    ),
    worst_day: Object.fromEntries(SYMPTOMS.map((s) => [s, worst(s)])),
    current_streak_without_flare: Object.fromEntries(
      SYMPTOMS.map((s) => [s, currentStreak(daily, s, end)])
    ),
    flare_threshold: FLARE_THRESHOLD,
    top_foods: topFoods, // keywords pulled from meal descriptions
    habit_completion: habitCompletion(current),
    xp: {
      period_total: current.reduce((a, d) => a + d.xp, 0),
      all_time_total: daily.reduce((a, d) => a + d.xp, 0),
      today: daily[daily.length - 1].date === end ? daily[daily.length - 1].xp : 0,
    },
    hmwk_minutes_by_subject: hmwkBySubject(current),
    totals_minutes: Object.fromEntries(
      METRICS.filter((m) => m.endsWith('_minutes')).map((m) => [m, current.reduce((a, d) => a + (d[m] ?? 0), 0)])
    ),
  };
}

// Per habit: days done, days explicitly missed, and share of logged days done.
function habitCompletion(days) {
  if (!days.length) return {};
  const seen = new Set([
    ...HABITS,
    ...days.flatMap((d) => Object.keys(d.habits)),
    ...days.flatMap((d) => d.missed_habits),
  ]);
  return Object.fromEntries(
    [...seen].map((h) => [h, {
      days_done: days.filter((d) => d.habits[h]).length,
      days_missed: days.filter((d) => d.missed_habits.includes(h)).length,
      rate: round(days.filter((d) => d.habits[h]).length / days.length),
    }])
  );
}

function hmwkBySubject(days) {
  const out = {};
  for (const d of days) {
    for (const [s, m] of Object.entries(d.hmwk_by_subject)) out[s] = (out[s] ?? 0) + m;
  }
  return out;
}

// Time series ready for charting: one point per calendar day in range
// (gaps filled with nulls) plus a trailing moving average.
export function timeseries(daily, { from, to, metrics = METRICS, smooth = 7 } = {}) {
  if (daily.length === 0) return { from: null, to: null, points: [] };
  const start = from ?? daily[0].date;
  const end = to ?? daily[daily.length - 1].date;
  const byDate = new Map(daily.map((d) => [d.date, d]));

  const points = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const d = byDate.get(date);
    const point = { date };
    for (const m of metrics) point[m] = d ? d[m] : null;
    points.push(point);
  }

  if (smooth > 1) {
    for (const m of metrics) {
      points.forEach((p, i) => {
        const window = points
          .slice(Math.max(0, i - smooth + 1), i + 1)
          .map((q) => q[m])
          .filter((v) => v !== null);
        p[`${m}_avg${smooth}`] = round(mean(window));
      });
    }
  }
  return { from: start, to: end, smooth, points };
}
