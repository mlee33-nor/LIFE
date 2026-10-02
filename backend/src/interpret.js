// Turns raw tracker events (shapes defined in
// tracker-api-contract.md) into one record per local calendar day that the
// dashboard and analytics can use. Unknown shapes are kept but ignored.

export const TIMEZONE = process.env.APP_TIMEZONE || 'America/Phoenix';

export const ACTIVITIES = ['work', 'hmwk', 'workout', 'walk', 'rest', 'social', 'chores', 'routine'];
export const HABITS = [
  'water', 'meal', 'shower', 'room_clean', 'am_skincare', 'pm_skincare',
  'sunscreen', 'brush_teeth', 'wash_face', 'get_dressed', 'breakfast', 'walk', 'bedtime',
];

// Numeric per-day metrics, usable in /api/timeseries and correlations.
export const METRICS = [
  'stomach_pain',
  'acne',
  'acne_spots',
  'headache',
  'sleep_hours',
  'wake_hour',
  'water',
  'meals_logged',
  'habits_done',
  'misses',
  'xp',
  ...ACTIVITIES.map((a) => `${a}_minutes`),
];

// A bedtime more than this long before a wake-up isn't counted as sleep.
const MAX_SLEEP_HOURS = 16;
// A session start older than this is stale: a later end doesn't pair with it,
// and it isn't shown as "currently working on".
const MAX_SESSION_MS = 16 * 3600000;
// Homework subjects that count toward the same goal (Hermes counts Calculus
// toward the Math target and Geology toward Science).
const SUBJECT_GROUPS = [
  ['math', 'calculus', 'calc', 'precalc', 'algebra', 'statistics', 'stats'],
  ['science', 'geology', 'biology', 'chemistry', 'physics'],
];

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const offsetFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'longOffset' });
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export const localDate = (d) => dayFormatter.format(typeof d === 'string' ? new Date(d) : d);

// ISO-8601 in the app timezone, e.g. 2026-09-25T15:20:00-07:00.
export function localIso(d) {
  if (typeof d === 'string') d = new Date(d);
  const p = Object.fromEntries(partsFormatter.formatToParts(d).map((x) => [x.type, x.value]));
  const tz = offsetFormatter.formatToParts(d).find((x) => x.type === 'timeZoneName').value;
  const offset = tz === 'GMT' ? '+00:00' : tz.replace('GMT', '');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

const STOPWORDS = new Set(
  ('a an the and or with without some of on in at for to from my i had ate eat eating just then also ' +
   'breakfast lunch dinner snack meal food little bit lot plus side cup cups bowl plate piece pieces ' +
   'big small large half few was were is it that this very really')
    .split(' ')
);

// Rough keyword extraction from free-text meals: "Chicken burrito w/ cheese"
// -> ["chicken", "burrito", "cheese"].
// Food items from a meal description, kept whole so names like "Dutch Bros
// Golden Eagle" stay one item: "chicken burrito with cheese and salsa" ->
// ["chicken burrito", "cheese", "salsa"]. Filler words at the edges
// ("had a", "for lunch") are dropped and the last word is singularized.
export function foodKeywords(text) {
  if (typeof text !== 'string') return [];
  const items = text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')               // "(half bowl)" quantities
    .replace(/w\//g, ' with ')
    .split(/\s*(?:[,;+&|\n]|\band\b|\bwith\b|\bplus\b)\s*/)
    .map(foodItem)
    .filter(Boolean);
  return [...new Set(items)];
}

// Normalizes one item name: lowercase, trimmed filler, singular last word.
export function foodItem(name) {
  const words = String(name ?? '').toLowerCase().replace(/[^a-z0-9'’ -]+/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length && (STOPWORDS.has(words[0]) || /^\d+$/.test(words[0]))) words.shift();
  while (words.length && STOPWORDS.has(words.at(-1))) words.pop();
  if (!words.length || words.join('').length < 3) return null;
  words[words.length - 1] = singular(words.at(-1));
  return words.join(' ');
}

// Crude plural -> singular so "fries"/"fry" and "eggs"/"egg" match.
function singular(w) {
  if (w.length <= 3 || w.endsWith('ss') || w === 'bros' || w === 'fries') return w; // "Dutch Bros" isn't a plural
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}


// Numbers, including numbers sent as strings ("6") by an agent.
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};
const sessionKey = (d) => `${d.activity}|${d.subject ?? ''}`;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
const hhmm = (d) => localIso(d).slice(11, 16);
const round2 = (n) => Math.round(n * 100) / 100;

// Minutes on `subject` including subjects in the same group (math + calculus).
function subjectMinutes(bySubject, subject) {
  const group = SUBJECT_GROUPS.find((g) => g.includes(subject)) ?? [subject];
  return Object.entries(bySubject)
    .filter(([s]) => group.some((g) => s === g || s.split(' ').includes(g)))
    .reduce((sum, [, m]) => sum + m, 0);
}

function emptyDay(date) {
  return {
    date,
    event_count: 0,
    stomach_pain: null,
    pain_reports: [],
    acne: null,
    acne_spots: null,
    new_spots: null,
    headache: null,
    headache_reports: [],
    bedtime: null,
    wake_time: null,
    wake_hour: null,
    sleep_hours: null,
    meals: [],
    foods: [],
    meals_logged: 0,
    water: null,
    habits: {},
    habits_done: 0,
    missed_habits: [],
    misses: 0,
    xp: 0,
    xp_events: [],
    sessions: [],
    ...Object.fromEntries(ACTIVITIES.map((a) => [`${a}_minutes`, 0])),
    hmwk_by_subject: {},
    goals: [],
    todos: [],
    moods: [],
    shield: false,
    life_notes: [],
    doordash: null,
    skin: { routines: 0, photos: 0, notes: [], locations: [], photo_list: [] },
    notes: [],
  };
}

// events: [{ id, tracker, at: Date, data }] sorted by `at`.
// Returns { daily, activeSessions, staleSessions, revisit }.
export function interpret(events, { now = Date.now() } = {}) {
  const days = new Map();
  const day = (date) => {
    if (!days.has(date)) days.set(date, emptyDay(date));
    return days.get(date);
  };
  const open = new Map(); // sessionKey -> start event
  const todos = new Map(); // todo_id -> { date, todo }
  const revisit = new Map(); // problem row id -> problem
  let lastBedtime = null;

  const addSession = (d, activity, subject, minutes, startAt, endAt, label = null, extra = {}) => {
    if (minutes === null || minutes < 0) return;
    const m = Math.round(minutes);
    d.sessions.push({
      activity, subject, label, minutes: m,
      start: startAt ? localIso(startAt) : null,
      end: endAt ? localIso(endAt) : null,
      ...extra,
    });
    if (ACTIVITIES.includes(activity)) d[`${activity}_minutes`] += m;
    if (activity === 'hmwk') {
      const s = subject ?? 'general';
      d.hmwk_by_subject[s] = (d.hmwk_by_subject[s] ?? 0) + m;
    }
  };

  for (const e of events) {
    const data = e.data && typeof e.data === 'object' ? e.data : {};
    // The sheet's credited day (data.day) wins over the clock time, e.g.
    // 12:10 AM skincare counted toward Friday.
    const dayOfEvent = (ev) => (isDay(ev.data?.day) ? ev.data.day : localDate(ev.at));
    const d = day(dayOfEvent(e));
    d.event_count++;

    if (e.tracker === 'life' && data.kind === 'session' && data.activity) {
      const key = sessionKey(data);
      if (data.action === 'start') {
        open.set(key, e);
      } else if (data.action === 'end') {
        const startedAt = data.started_at ? new Date(data.started_at) : null;
        const hasStart = startedAt && !Number.isNaN(startedAt.getTime());
        // Pair with the open start only if it's this session's start: same
        // start time when the end says, else started within MAX_SESSION_MS.
        let start = open.get(key) ?? null;
        if (start) {
          const same = hasStart
            ? Math.abs(start.at - startedAt) <= 5 * 60000
            : e.at >= start.at && e.at - start.at <= MAX_SESSION_MS;
          if (same) open.delete(key);
          else start = null;
        }
        const from = start?.at ?? (hasStart ? startedAt : null);
        let minutes = num(data.minutes);
        if (minutes === null && from) {
          const diff = (e.at - from) / 60000;
          minutes = diff > 0 && diff * 60000 <= MAX_SESSION_MS ? diff : null;
        }
        // Credited day: the entry's own day if given (sheet), else the start's day.
        const target = isDay(data.day) ? d : start ? day(dayOfEvent(start)) : d;
        addSession(target, data.activity, data.subject ?? null, minutes, from, e.at,
          data.label ?? start?.data.label ?? null, data.paused ? { paused: true } : {});
      } else if (num(data.minutes) !== null) {
        addSession(d, data.activity, data.subject ?? null, num(data.minutes), null, e.at, data.label ?? null);
      }
    } else if (e.tracker === 'life' && data.kind === 'habit' && data.habit) {
      const h = d.habits[data.habit] ?? { count: 0, value: null };
      h.count++;
      if (num(data.value) !== null) h.value = (h.value ?? 0) + num(data.value);
      d.habits[data.habit] = h;
      if (data.habit === 'water') d.water = h.value ?? h.count;
      // The sheet's "meal" habit is XP for a meal already in the food log.
      if (data.habit === 'meal' && data.source !== 'sheet') d.meals_logged++;
      if (data.habit === 'bedtime') lastBedtime = e.at;
    } else if (e.tracker === 'life' && data.kind === 'wake') {
      // First wake-up of the day sets wake time; sleep runs from the last bedtime.
      if (d.wake_time === null) {
        d.wake_time = hhmm(e.at);
        d.wake_hour = round2(Number(d.wake_time.slice(0, 2)) + Number(d.wake_time.slice(3)) / 60);
        const bed = lastBedtime ?? (data.bedtime ? new Date(data.bedtime) : null);
        const hours = bed ? (e.at - bed) / 3600000 : null;
        if (hours !== null && hours > 0 && hours <= MAX_SLEEP_HOURS) {
          d.sleep_hours = round2(hours);
          d.bedtime = hhmm(bed);
        } else if (num(data.sleep_minutes) > 0) {
          d.sleep_hours = round2(num(data.sleep_minutes) / 60);
        }
      }
      lastBedtime = null;
    } else if (e.tracker === 'life' && data.kind === 'todo' && (data.text || data.todo_id)) {
      // One to-do per todo_id across all days: it stays on the day it was
      // added, and its latest update (even days later) sets the status.
      const id = String(data.todo_id ?? e.id);
      const prior = todos.get(id)?.todo;
      const status = data.status ?? (data.done === true ? 'done' : data.done === false ? 'open' : prior?.status ?? 'open');
      todos.set(id, {
        date: todos.get(id)?.date ?? d.date,
        todo: {
          id,
          text: data.text ?? prior?.text ?? null,
          status,
          done: status === 'done',
          priority: data.priority ?? prior?.priority ?? 'normal',
          notes: data.notes ?? prior?.notes ?? null,
          at: prior?.at ?? localIso(e.at),
          ...(prior && status !== prior.status && { updated_at: localIso(e.at) }),
        },
      });
    } else if (e.tracker === 'life' && data.kind === 'goal') {
      // Latest version of a goal wins; progress is filled in below.
      const id = data.subject ?? data.label;
      d.goals = d.goals.filter((g) => (g.subject ?? g.label) !== id);
      d.goals.push({ label: data.label ?? null, subject: data.subject ?? null, target_minutes: num(data.target_minutes), ...(data.standing && { standing: true }) });
    } else if (e.tracker === 'life' && data.kind === 'headache') {
      // Unscored reports are listed but don't set the 0-10 score.
      const severity = num(data.severity);
      d.headache_reports.push({ at: localIso(e.at), severity, text: data.text ?? null });
      if (severity !== null) d.headache = Math.max(d.headache ?? 0, severity);
    } else if (e.tracker === 'life' && data.kind === 'sleep' && num(data.hours) !== null) {
      // Reported sleep; a bedtime -> wake calculation takes precedence.
      d.reported_sleep_hours = num(data.hours);
    } else if (e.tracker === 'life' && data.kind === 'miss' && data.habit) {
      if (!d.missed_habits.includes(data.habit)) d.missed_habits.push(data.habit);
      d.misses = d.missed_habits.length;
    } else if (e.tracker === 'life' && data.kind === 'xp' && num(data.amount) !== null) {
      d.xp += num(data.amount);
      d.xp_events.push({ at: localIso(e.at), amount: num(data.amount), reason: data.reason ?? null });
    } else if (e.tracker === 'life' && data.kind === 'mood') {
      const feelings = Array.isArray(data.feelings) && data.feelings.length
        ? data.feelings
        : String(data.text ?? data.mood ?? '').split(/\s*(?:;|,|\band\b)\s*/).map((f) => f.trim().toLowerCase()).filter(Boolean);
      d.moods.push({ at: localIso(e.at), feelings, severity: num(data.severity), cause: data.cause ?? null, notes: data.note ?? data.notes ?? null });
    } else if (e.tracker === 'life' && data.kind === 'shield') {
      d.shield = true;
    } else if (e.tracker === 'life' && ['life_note', 'symptom', 'note'].includes(data.kind) && data.text) {
      d.life_notes.push({ at: localIso(e.at), kind: data.note_kind ?? data.kind, text: data.text });
    } else if (e.tracker === 'life' && data.kind === 'mb') {
      d.mb = (d.mb ?? 0) + 1;
    } else if (e.tracker === 'life' && (data.kind === 'dash' || data.kind === 'dash_expense')) {
      // Sums stay null until a value is reported (pay can be "pending").
      const dd = (d.doordash ??= { shifts: [], pay: null, net_profit: null, miles: null, minutes: null, gas_cost: null, expenses: null });
      if (data.kind === 'dash') {
        const shift = {
          row_id: data.sheet_row_id ?? e.id, label: data.label ?? null, start: data.start ?? localIso(e.at), end: data.end ?? null,
          minutes: num(data.minutes), pay: num(data.pay), offers: num(data.offers), miles: num(data.miles),
          gas_cost: num(data.gas_cost), net_profit: num(data.net_profit), net_per_hour: num(data.net_per_hour),
          net_per_mile: num(data.net_per_mile), note: data.note ?? null,
        };
        dd.shifts.push(shift);
        for (const k of ['pay', 'net_profit', 'miles', 'minutes', 'gas_cost']) {
          if (shift[k] !== null) dd[k] = round2((dd[k] ?? 0) + shift[k]);
        }
      } else if (num(data.amount) !== null) {
        dd.expenses = round2((dd.expenses ?? 0) + num(data.amount));
      }
      dd.net_after_expenses = dd.net_profit === null ? null : round2(dd.net_profit - (dd.expenses ?? 0));
    } else if (e.tracker === 'life' && data.kind === 'revisit') {
      const id = String(data.sheet_row_id ?? data.problem_id ?? e.id);
      revisit.set(id, {
        row_id: id, date: d.date, topic: data.topic ?? null, problem_id: data.problem_id ?? null,
        problem: data.problem ?? null, where_stuck: data.where_stuck ?? null, status: data.status ?? 'open',
        revisited_at: data.revisited_at ?? null, mastered_at: data.mastered_at ?? null,
        concept: Boolean(data.concept), photo_url: data.photo_url ?? null,
      });
    } else if (e.tracker === 'food') {
      const pain = num(data.pain);
      if (pain !== null) d.stomach_pain = Math.max(d.stomach_pain ?? 0, pain);
      if (pain !== null || data.kind === 'pain_report') {
        d.pain_reports.push({ at: localIso(e.at), pain, text: data.text ?? null });
      }
      if (data.kind === 'meal') {
        d.meals.push({ at: localIso(e.at), text: data.text ?? '' });
        d.meals_logged++;
        // Structured item names (from the sheet) beat parsing free text.
        const items = Array.isArray(data.items) ? data.items.map(foodItem).filter(Boolean) : foodKeywords(data.text);
        for (const k of items) if (!d.foods.includes(k)) d.foods.push(k);
      } else if (data.kind === 'note' && data.text) {
        d.notes.push({ tracker: 'food', at: localIso(e.at), text: data.text });
      }
    } else if (e.tracker === 'skin') {
      // Acne score comes from `severity` (0-10) on skin events.
      const severity = num(data.severity);
      if (severity !== null) d.acne = Math.max(d.acne ?? 0, severity);
      if (data.kind === 'spots' && num(data.count) !== null) d.acne_spots = Math.max(d.acne_spots ?? 0, num(data.count));
      if (data.kind === 'new_spots' && num(data.count) !== null) d.new_spots = num(data.count);
      if (data.kind === 'zone_spots' && data.zone && num(data.count) !== null) {
        // Per-zone spot counts for the face map. Severity is estimated from
        // the count so zones can be shaded: 1-2 mild, 3-5 moderate, 6+ active.
        const count = num(data.count);
        d.skin.locations = d.skin.locations.filter((l) => l.zone !== data.zone);
        if (count > 0) {
          d.skin.locations.push({ zone: data.zone, spots: count, severity: count >= 6 ? 7 : count >= 3 ? 5 : 2, severity_estimated: true });
        }
        continue;
      }
      if (data.kind === 'routine') d.skin.routines++;
      else if (data.kind === 'photo') {
        d.skin.photos++;
        const label = data.text ?? data.label ?? null;
        // A corrected angle wins over the one guessed from the label.
        const angle = data.angle ?? String(label ?? '').toLowerCase().match(/\b(front|left|right)\b/)?.[1] ?? null;
        d.skin.photo_list.push({ at: localIso(e.at), label, angle, url: data.url ?? null, photo_id: data.photo_id ?? null, external_ref: data.photo_ref ?? null });
        continue; // photos are listed in photo_list, not repeated as notes
      }
      if (data.text) d.skin.notes.push({ at: localIso(e.at), kind: data.kind ?? null, text: data.text });
    }
  }

  for (const { date, todo } of todos.values()) day(date).todos.push(todo);

  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const standing = new Map(); // standing goals carry forward to later days
  for (const d of daily) {
    for (const g of d.goals) if (g.standing) standing.set(g.subject ?? g.label, g);
    for (const [id, g] of standing) {
      if (!d.goals.some((x) => (x.subject ?? x.label) === id)) d.goals.push({ ...g, carried: true });
    }
    d.goals = d.goals.map((g) => {
      const done = g.subject ? subjectMinutes(d.hmwk_by_subject, g.subject) : null;
      return { ...g, done_minutes: done, complete: g.target_minutes != null && done != null && done >= g.target_minutes };
    });
    d.habits_done = Object.keys(d.habits).length;
    if (d.sleep_hours === null && d.reported_sleep_hours != null) d.sleep_hours = d.reported_sleep_hours;
    delete d.reported_sleep_hours;
    // No total logged (or it was unreadable): add up the face-map zones.
    if (d.acne_spots === null && d.skin.locations.length) d.acne_spots = d.skin.locations.reduce((s, l) => s + l.spots, 0);
  }

  const session = (e) => ({
    id: e.id,
    row_id: e.data.sheet_row_id ?? null,
    activity: e.data.activity,
    subject: e.data.subject ?? null,
    label: e.data.label ?? null,
    started_at: localIso(e.at),
  });
  const starts = [...open.values()];
  return {
    daily,
    activeSessions: starts.filter((e) => now - e.at <= MAX_SESSION_MS).map(session),
    // Started but never ended: Hermes should close these.
    staleSessions: starts.filter((e) => now - e.at > MAX_SESSION_MS).map(session),
    revisit: [...revisit.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
