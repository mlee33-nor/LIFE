// Turns raw tracker events (shapes defined in
// tracker-api-contract.md) into one record per local calendar day that the
// dashboard and analytics can use. Unknown shapes are kept but ignored.

export const TIMEZONE = process.env.APP_TIMEZONE || 'America/Phoenix';

export const ACTIVITIES = ['work', 'hmwk', 'workout', 'walk', 'rest', 'social'];
export const HABITS = [
  'water', 'meal', 'shower', 'room_clean', 'am_skincare', 'pm_skincare',
  'sunscreen', 'morning_ritual', 'bedtime',
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

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sessionKey = (d) => `${d.activity}|${d.subject ?? ''}`;

function emptyDay(date) {
  return {
    date,
    event_count: 0,
    stomach_pain: null,
    pain_reports: [],
    acne: null,
    acne_spots: null,
    headache: null,
    headache_reports: [],
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
    skin: { routines: 0, photos: 0, notes: [], locations: [], photo_list: [] },
    notes: [],
  };
}

// events: [{ id, tracker, at: Date, data }] sorted by `at`.
// Returns { daily, activeSessions }.
export function interpret(events) {
  const days = new Map();
  const day = (date) => {
    if (!days.has(date)) days.set(date, emptyDay(date));
    return days.get(date);
  };
  const open = new Map(); // sessionKey -> start event
  let lastBedtime = null;

  const addSession = (d, activity, subject, minutes, startAt, endAt, label = null) => {
    if (minutes === null || minutes < 0) return;
    const m = Math.round(minutes);
    d.sessions.push({
      activity, subject, label, minutes: m,
      start: startAt ? localIso(startAt) : null,
      end: endAt ? localIso(endAt) : null,
    });
    if (ACTIVITIES.includes(activity)) d[`${activity}_minutes`] += m;
    if (activity === 'hmwk') {
      const s = subject ?? 'other';
      d.hmwk_by_subject[s] = (d.hmwk_by_subject[s] ?? 0) + m;
    }
  };

  for (const e of events) {
    const data = e.data && typeof e.data === 'object' ? e.data : {};
    const d = day(localDate(e.at));
    d.event_count++;

    if (e.tracker === 'life' && data.kind === 'session' && data.activity) {
      const key = sessionKey(data);
      if (data.action === 'start') {
        open.set(key, e);
      } else if (data.action === 'end') {
        const start = open.get(key);
        open.delete(key);
        const minutes = num(data.minutes) ?? (start ? (e.at - start.at) / 60000 : null);
        // Attribute the session to the day it started.
        addSession(start ? day(localDate(start.at)) : d, data.activity, data.subject ?? null,
          minutes, start?.at ?? null, e.at, data.label ?? start?.data.label ?? null);
      } else if (num(data.minutes) !== null) {
        addSession(d, data.activity, data.subject ?? null, num(data.minutes), null, e.at, data.label ?? null);
      }
    } else if (e.tracker === 'life' && data.kind === 'habit' && data.habit) {
      const h = d.habits[data.habit] ?? { count: 0, value: null };
      h.count++;
      if (num(data.value) !== null) h.value = (h.value ?? 0) + num(data.value);
      d.habits[data.habit] = h;
      if (data.habit === 'water') d.water = h.value ?? h.count;
      if (data.habit === 'meal') d.meals_logged++;
      if (data.habit === 'bedtime') lastBedtime = e.at;
    } else if (e.tracker === 'life' && data.kind === 'wake') {
      // First wake-up of the day sets wake time; sleep runs from the last bedtime.
      if (d.wake_time === null) {
        const hhmm = localIso(e.at).slice(11, 16);
        d.wake_time = hhmm;
        d.wake_hour = Math.round((Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3)) / 60) * 100) / 100;
        const hours = lastBedtime ? (e.at - lastBedtime) / 3600000 : null;
        if (hours !== null && hours > 0 && hours <= MAX_SLEEP_HOURS) d.sleep_hours = Math.round(hours * 100) / 100;
      }
      lastBedtime = null;
    } else if (e.tracker === 'life' && data.kind === 'goal') {
      // Latest version of a goal wins; progress is filled in below.
      d.goals = d.goals.filter((g) => g.label !== data.label);
      d.goals.push({ label: data.label ?? null, subject: data.subject ?? null, target_minutes: num(data.target_minutes) });
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
        const angle = String(label ?? '').toLowerCase().match(/\b(front|left|right)\b/)?.[1] ?? null;
        d.skin.photo_list.push({ at: localIso(e.at), label, angle, url: data.url ?? null, photo_id: data.photo_id ?? null, external_ref: data.photo_ref ?? null });
        continue; // photos are listed in photo_list, not repeated as notes
      }
      if (data.text) d.skin.notes.push({ at: localIso(e.at), kind: data.kind ?? null, text: data.text });
    }
  }

  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of daily) {
    for (const g of d.goals) {
      g.done_minutes = g.subject ? (d.hmwk_by_subject[g.subject] ?? 0) : null;
      g.complete = g.target_minutes != null && g.done_minutes != null && g.done_minutes >= g.target_minutes;
    }
    d.habits_done = Object.keys(d.habits).length;
    if (d.sleep_hours === null && d.reported_sleep_hours != null) d.sleep_hours = d.reported_sleep_hours;
    delete d.reported_sleep_hours;
  }

  const activeSessions = [...open.values()].map((e) => ({
    id: e.id,
    activity: e.data.activity,
    subject: e.data.subject ?? null,
    label: e.data.label ?? null,
    started_at: localIso(e.at),
  }));

  return { daily, activeSessions };
}
