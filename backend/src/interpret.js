// Turns raw tracker events (shapes defined in
// tracker-api-contract.md) into one record per local calendar day that the
// dashboard and analytics can use. Unknown shapes are kept but ignored.

export const TIMEZONE = process.env.APP_TIMEZONE || 'America/Phoenix';

export const ACTIVITIES = ['work', 'hmwk', 'workout', 'walk', 'rest'];
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
export function foodKeywords(text) {
  if (typeof text !== 'string') return [];
  const words = text
    .toLowerCase()
    .replace(/w\//g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(singular);
  return [...new Set(words)];
}

// Crude plural -> singular so "fries"/"fry" and "eggs"/"egg" match.
function singular(w) {
  if (w.length <= 3 || w.endsWith('ss')) return w;
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
    skin: { routines: 0, photos: 0, notes: [] },
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

  const addSession = (d, activity, subject, minutes, startAt, endAt) => {
    if (minutes === null || minutes < 0) return;
    const m = Math.round(minutes);
    d.sessions.push({
      activity, subject, minutes: m,
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
          minutes, start?.at ?? null, e.at);
      } else if (num(data.minutes) !== null) {
        addSession(d, data.activity, data.subject ?? null, num(data.minutes), null, e.at);
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
        for (const k of foodKeywords(data.text)) if (!d.foods.includes(k)) d.foods.push(k);
      } else if (data.kind === 'note' && data.text) {
        d.notes.push({ tracker: 'food', at: localIso(e.at), text: data.text });
      }
    } else if (e.tracker === 'skin') {
      // Acne score comes from `severity` (0-10) on skin events.
      const severity = num(data.severity);
      if (severity !== null) d.acne = Math.max(d.acne ?? 0, severity);
      if (data.kind === 'spots' && num(data.count) !== null) d.acne_spots = Math.max(d.acne_spots ?? 0, num(data.count));
      if (data.kind === 'routine') d.skin.routines++;
      else if (data.kind === 'photo') d.skin.photos++;
      if (data.text) d.skin.notes.push({ at: localIso(e.at), kind: data.kind ?? null, text: data.text });
    }
  }

  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of daily) {
    d.habits_done = Object.keys(d.habits).length;
    if (d.sleep_hours === null && d.reported_sleep_hours != null) d.sleep_hours = d.reported_sleep_hours;
    delete d.reported_sleep_hours;
  }

  const activeSessions = [...open.values()].map((e) => ({
    id: e.id,
    activity: e.data.activity,
    subject: e.data.subject ?? null,
    started_at: localIso(e.at),
  }));

  return { daily, activeSessions };
}
