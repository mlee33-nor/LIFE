// Shared helpers: Phoenix time, pluralizing, escaping, optional API calls and
// the one subject/activity palette used by the Life and Homework tabs.

export const TZ = 'America/Phoenix';
export const API_BASE = window.SOMA_API_BASE ?? '';
export const API_KEY = window.SOMA_API_KEY ?? (() => { try { return localStorage.getItem('soma-api-key') ?? ''; } catch { return ''; } })();

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;
export const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// "Today" and the hour always come from Phoenix, never the device clock's zone.
export const phoenixToday = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const phoenixHour = (date = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date));
export const phoenixLabel = (opts, date = new Date()) => date.toLocaleDateString('en-US', { timeZone: TZ, ...opts });
export const greeting = () => { const h = phoenixHour(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

// Calendar arithmetic on YYYY-MM-DD strings (UTC noon, so no DST surprises).
export const shiftIso = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
export const isoLabel = (iso, opts = { month: 'short', day: 'numeric' }) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso ?? ''))) return '—';
  return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
};

// Minutes since midnight from "23:30", "11:30 PM" or an ISO timestamp (read as written).
export function clockMinutes(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  const iso = text.match(/T(\d{1,2}):(\d{2})/);
  const plain = iso || text.match(/^\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!plain) return null;
  let h = Number(plain[1]);
  const m = Number(plain[2]);
  const ampm = !iso && plain[3] ? plain[3].toLowerCase() : null;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h > 23 || m > 59 ? null : h * 60 + m;
}
export const clockLabel = (minute) => {
  if (minute === null || minute === undefined) return '—';
  const v = ((Math.round(minute) % 1440) + 1440) % 1440;
  const h = Math.floor(v / 60);
  return `${h % 12 || 12}:${String(v % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const durationLabel = (minutes) => {
  const m = Math.round(Number(minutes) || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
};
export const money = (v, digits = 2) => (isNum(v) ? `$${Number(v).toFixed(digits)}` : '—');

// GET that never throws: 404 / offline / bad JSON all come back as { ok:false }.
export async function getOptional(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) } });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: await res.json() };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

// ---------- Subjects ----------
// MOTION writes subjects freely ("math", "Math", "General Hmwk"). Show them
// title-cased, merge exact case-insensitive duplicates, and fold the
// "no particular subject" spellings into General.
const GENERAL = new Set(['', 'unspecified', 'other', 'general', 'general hmwk', 'general homework', 'homework', 'hmwk', 'none', 'null', 'misc']);
export function canonicalSubject(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (GENERAL.has(text.toLowerCase())) return 'General';
  return text.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
export const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export const activityNames = { hmwk: 'Homework', work: 'Work', workout: 'Workout', walk: 'Walking', chores: 'Chores', routine: 'Routine', rest: 'Rest', social: 'Social', sleep: 'Sleep' };
// One fixed, saturated hue per activity/subject. Colours follow the thing,
// never its position. Every colour is >= 3:1 against the light card and
// replay backgrounds (#fffdf8 / #f3eff8) so bars and dots stay visible.
const palette = {
  work: '#2563eb',                                             // blue
  hmwk: '#7c3aed', general: '#7c3aed',                         // violet: homework with no subject
  math: '#d06f00', algebra: '#d06f00', geometry: '#d06f00', statistics: '#d06f00',
  calculus: '#b45309', precalculus: '#b45309',                 // deeper amber, same family as math
  geology: '#059669',                                          // emerald (earth science)
  science: '#059669', biology: '#059669', chemistry: '#059669', physics: '#059669', // emerald
  history: '#db2777',                                          // pink
  english: '#c026d3', reading: '#c026d3', writing: '#c026d3',  // fuchsia
  workout: '#169436', walk: '#169436',                         // green (exercise)
  routine: '#0891b2',                                          // cyan
  chores: '#4d7c0f',                                           // olive
  social: '#dc2626',                                           // red
  rest: '#64748b', sleep: '#475569',                           // slate: downtime
};
export function colorFor(key) {
  if (!key) return '#6b7280';
  const k = String(key).toLowerCase();
  if (palette[k]) return palette[k];
  // Unknown homework subjects stay violet; unknown activities are neutral.
  return activityNames[k] ? '#6b7280' : palette.hmwk;
}

// Productive time only: rest, naps, sleep and social don't count as "active".
export const PRODUCTIVE = new Set(['work', 'hmwk', 'homework', 'workout', 'walk', 'chores']);
const RESTFUL = /\b(nap|sleep|bed|rest)\b/i;
export const isProductive = (s) => PRODUCTIVE.has(String(s?.activity ?? '').toLowerCase()) && !RESTFUL.test(`${s?.label ?? ''}`.replace(/bedroom/i, ''));
