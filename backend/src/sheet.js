// Maps the tracker Google Sheet into events in the shapes interpret.js
// understands. Every event gets data.sheet_row_id so a re-sync updates rows in
// place, and data.source = 'sheet'.
//
// The main source is the "All events" tab. Columns: row_id, date, time_local,
// timezone, tracker, category, event, label, value, unit, outcome, status,
// start_at, end_at, minutes_reported, minutes_confirmed, xp_awarded, meal_id,
// onset_minutes_approx, source_message_ids, photo_reference, notes,
// photo_url, credit_date, reported_at_local.
//
// Optional side tabs (DoorDash, Math revisitor, Emotion check-ins, Skin, Food)
// are merged in by mergeSheetTabs(): they hold structured details and rows
// that never made it into "All events".

export const COLUMNS = [
  'row_id', 'date', 'time_local', 'timezone', 'tracker', 'category', 'event', 'label', 'value', 'unit',
  'outcome', 'status', 'start_at', 'end_at', 'minutes_reported', 'minutes_confirmed', 'xp_awarded', 'meal_id',
  'onset_minutes_approx', 'source_message_ids', 'photo_reference', 'notes', 'photo_url', 'credit_date',
  'reported_at_local',
];
const REQUIRED = ['row_id', 'date', 'tracker'];

const ACTIVITY = {
  homework: 'hmwk', hmwk: 'hmwk', study: 'hmwk', work: 'work', workout: 'workout', walk: 'walk',
  rest: 'rest', social: 'social', chores: 'chores', routine: 'routine',
};
const SESSION_EVENTS = ['start', 'end', 'duration', 'pause'];
// Skin-tab rows already covered by Life-tab rows (sessions, wake, bedtime) or
// derived by the sheet's own dashboard; skipped to avoid double counting.
const SKIN_SKIP = /^(nap|rest in bed|stated bedtime|first wake text|bedtime-to-first-wake|routine score)/;
// Sheet zone names ("leftCheek") -> the face map's zone ids ("left_cheek").
const zoneId = (name) => name.trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/\s+/g, '_').toLowerCase();

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true; // a quote mid-field (5" screen) is literal
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.filter(Boolean).map((k) => [k, (r[keys.indexOf(k)] ?? '').trim()])));
}

const todoPriority = (v) => (/high|urgent|!/i.test(v ?? '') ? 'high' : /low/i.test(v ?? '') ? 'low' : 'normal');

// Direct image link for a photo row: the photo_url column, or source_url
// inside a JSON photo_reference.
function photoLink(row) {
  if (/^https?:\/\//.test(row.photo_url ?? '')) return row.photo_url.trim();
  try {
    const ref = JSON.parse(row.photo_reference);
    if (/^https?:\/\//.test(ref?.source_url ?? '')) return ref.source_url;
  } catch {
    // not JSON
  }
  return null;
}

const num = (v) => {
  const s = String(v ?? '').replace(/^\$/, '').trim();
  return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;
};
const slug = (s) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const bool = (v) => (/^true$/i.test(v) ? true : /^false$/i.test(v) ? false : null);
const pad = (n) => String(n).padStart(2, '0');

// "2026-09-30", "9/30/2026", "2026/9/30" -> "2026-09-30"; anything else -> null.
export function normDate(value) {
  const s = String(value ?? '').trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}

const nextDay = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// Clock time from "7:00", "08:00-11:00", "about 10:50", "2:42 PM", or a
// spreadsheet day fraction ("0.4895833" = 11:45). Returns [h, m] or null.
function clock(text) {
  const s = String(text ?? '').trim();
  if (/^0?\.\d+$/.test(s)) {
    const mins = Math.round(Number(s) * 24 * 60);
    return [Math.floor(mins / 60) % 24, mins % 60];
  }
  // AM/PM only as its own word: "18:12 America/Phoenix" is not 6:12 AM.
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([AaPp])\.?[Mm]\.?(?![A-Za-z]))?/);
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return h < 24 ? [h, Number(m[2])] : null;
}

const stamp = (date, [h, m]) => `${date}T${pad(h)}:${pad(m)}:00-07:00`;

// The day a row counts toward: credit_date when Hermes set one, else date.
const creditDay = (row) => normDate(row.credit_date) ?? normDate(row.date);

// When the row happened. Sheet times are America/Phoenix (UTC-7 year-round).
// A full timestamp in time_local wins. A bare early-morning time on a row
// credited to the previous evening (e.g. 00:10 skincare counted for Friday)
// belongs to the next calendar day; the row id or reported_at_local says so.
function atFor(row) {
  const raw = row.time_local || row.time || '';
  const dated = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](.*)$/);
  const date = normDate(row.date);
  if (dated && clock(dated[2])) return stamp(dated[1], clock(dated[2]));
  const t = clock(raw);
  if (!t) return `${date}T12:00:00-07:00`;
  if (t[0] < 5) {
    const next = nextDay(date);
    const idDate = row.row_id.match(/(\d{4})(\d{2})(\d{2})T\d{4}/);
    const reported = normDate(String(row.reported_at_local ?? '').slice(0, 10));
    if ((idDate && `${idDate[1]}-${idDate[2]}-${idDate[3]}` === next) || reported === next) return stamp(next, t);
  }
  return stamp(date, t);
}

// Exact local timestamp from a start_at/end_at cell ("2026-09-26 2:00",
// "2026-09-30T15:40:19-07:00"), or null.
export function stampFor(value) {
  const m = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  return m ? `${m[1]}T${pad(m[2])}:${m[3]}:00-07:00` : null;
}

// Homework subject from a label: "General HMWK" -> "general",
// "Math practice / review" -> "math", "" -> "general".
export function subjectOf(label) {
  const s = String(label ?? '').toLowerCase()
    .replace(/\b(hmwk|homework|hw|practice|review|session|study|studying|daily|goal|target|minutes?|per|day)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s || 'general';
}

// One name per habit, whatever wording Hermes used ("Teeth brushed",
// "Brush teeth", "teeth" -> brush_teeth).
export function canonicalHabit(label, event = '') {
  const s = `${event} ${label}`.toLowerCase().replace(/_/g, ' ');
  if (/skin am|\bam\b.*(skin|face)|morning (skin|face) routine/.test(s)) return 'am_skincare';
  if (/skin pm|\bpm\b.*(skin|face)|night routine|evening routine/.test(s)) return 'pm_skincare';
  if (/teeth|brush/.test(s)) return 'brush_teeth';
  if (/sunscreen|spf/.test(s)) return 'sunscreen';
  if (/wash.*face|face wash|\bface\b|cleanser/.test(s)) return 'wash_face';
  if (/shower/.test(s)) return 'shower';
  if (/room|clean/.test(s)) return 'room_clean';
  if (/\bchange\b|changed|dressed/.test(s)) return 'get_dressed';
  if (/breakfast|brunch/.test(s)) return 'breakfast';
  if (/(^|\s)food$|\bmeal\b/.test(s)) return 'meal';
  if (/walk/.test(s)) return 'walk';
  if (/water/.test(s)) return 'water';
  return slug(label || event) || 'habit';
}

function skinRoutine(label) {
  if (/sunscreen|spf/.test(label)) return 'sunscreen';
  const care = /routine|wash|cleanser|skin|face/.test(label);
  if (care && /\bam\b|morning/.test(label)) return 'am_skincare';
  if (care && /\bpm\b|night|evening/.test(label)) return 'pm_skincare';
  return null;
}

// "Topic: chain rule. Problem: ... Where stuck: ..." -> { topic, ... }
function noteField(notes, name) {
  const m = String(notes ?? '').match(new RegExp(`${name}:\\s*([^.]+(?:\\.[0-9][^.]*)*)`, 'i'));
  return m ? m[1].trim() : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// "for exam prep (exam Oct 13)" -> { word: 'exam', date: '2026-10-13' }: the next
// such date on or after the row's date.
function examFromText(text, rowDate) {
  const m = String(text ?? '').match(/\b(exam|midterm|final|test)\b[^.;]{0,20}?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  const base = normDate(rowDate);
  if (!m || !base) return null;
  let year = Number(base.slice(0, 4));
  let date = `${year}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[3])}`;
  if (date < base) date = `${++year}${date.slice(4)}`;
  return { word: m[1].toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), date };
}

// row -> [{ key, tracker, at, day, data }]
function mapLifeRow(row, at, day, ctx) {
  const out = [];
  const add = (suffix, data, when = at) => out.push({ key: row.row_id + suffix, tracker: 'life', at: when, day, data });
  const category = row.category.toLowerCase();
  const event = row.event.toLowerCase();
  const label = row.label;
  const xp = num(row.xp_awarded);
  const minutes = num(row.minutes_confirmed) ?? num(row.minutes_reported);

  if (category === 'wake' || event === 'wake' || event === 'awake') {
    // Wake rows may carry the night's sleep (start_at = bedtime, minutes).
    const bed = stampFor(row.start_at);
    add('', {
      kind: 'wake', text: row.notes || null,
      sleep_minutes: bed && minutes > 0 ? minutes : null, bedtime: bed,
    }, stampFor(row.end_at) ?? at);
  } else if (category === 'sleep') {
    add('', { kind: 'habit', habit: 'bedtime', value: null, text: row.status || null }, stampFor(row.start_at) ?? at);
  } else if (ACTIVITY[category] && SESSION_EVENTS.includes(event)) {
    const activity = ACTIVITY[category];
    // Homework labels are the subject ("History", "Calculus"); other
    // activities' labels are descriptions ("AI work", "Allison").
    const subject = activity === 'hmwk' ? subjectOf(label) : null;
    const startStamp = stampFor(row.start_at);
    const base = { kind: 'session', activity, subject, label: label || null };
    if (event === 'start') {
      // A start closed by its own end/pause row, or marked closed, adds nothing.
      if (/closed/.test(row.status) || (startStamp && ctx.closedStarts.has(`${category}|${startStamp}`))) {
        // covered by the end row
      } else if (num(row.minutes_confirmed) > 0) {
        // Never closed, but some minutes were confirmed: count those.
        add('', { ...base, action: 'end', minutes: num(row.minutes_confirmed), started_at: startStamp }, startStamp ?? at);
      } else {
        add('', { ...base, action: 'start', minutes: null }, startStamp ?? at);
      }
    } else {
      // end / pause / duration rows carry the confirmed minutes. A session that
      // ran past midnight counts toward the day it started, unless Hermes set
      // credit_date.
      const endAt = (event !== 'duration' && stampFor(row.end_at)) || at;
      const startDay = startStamp?.slice(0, 10);
      const credited = !normDate(row.credit_date) && startDay && startDay < day
        && new Date(endAt) - new Date(startStamp) <= 16 * 3600000 ? startDay : day;
      out.push({ key: row.row_id, tracker: 'life', at: endAt, day: credited,
        data: { ...base, action: 'end', minutes, started_at: startStamp, paused: event === 'pause' || undefined } });
    }
  } else if (category === 'mb') {
    add('', { kind: 'mb', text: [row.value, row.notes].filter(Boolean).join(' — ') || null });
  } else if (category === 'miss' || row.outcome === 'miss') {
    add('', { kind: 'miss', habit: canonicalHabit(label || category), text: row.notes || null });
  } else if (['bonus', 'ritual', 'care'].includes(category) && (label || event)) {
    if (/^(false|no|skipped)$/i.test(row.value)) add('', { kind: 'miss', habit: canonicalHabit(label, event), text: row.notes || null });
    else add('', { kind: 'habit', habit: canonicalHabit(label, event), value: null, text: row.value || null });
  } else if (/stomach|tummy|gut|cramp/i.test(`${label} ${category}`) && /pain|ache|hurt|cramp/i.test(`${label} ${category} ${event}`)) {
    // Stomach pain logged on the Life side ("health / symptom / Stomach Pain"): a pain report.
    out.push({ key: row.row_id, tracker: 'food', at, day, data: { kind: 'pain_report', pain: num(row.value) ?? num(row.severity_0_10), text: [label, row.notes].filter(Boolean).join(' — ') || 'stomach pain' } });
  } else if ((category === 'symptom' || category === 'health') && /headache/i.test(label)) {
    add('', { kind: 'headache', severity: num(row.value), text: row.notes || null });
  } else if (category === 'symptom' || category === 'note' || category === 'health') {
    add('', { kind: 'life_note', note_kind: category, text: [label, row.value, row.notes].filter(Boolean).join(' — ') || null });
  } else if (category === 'todo') {
    // One row per task; Hermes flips `status` to done/skipped on the same row.
    const status = /done|complete/i.test(row.status) ? 'done' : /skip|cancel/i.test(row.status) ? 'skipped' : 'open';
    add('', { kind: 'todo', todo_id: row.row_id, text: label || row.notes || null, status, priority: todoPriority(row.value), notes: row.notes || null });
  } else if (category === 'study_goal') {
    add('', { kind: 'goal', label: label || null, subject: label ? subjectOf(label) : null, target_minutes: num(row.minutes_reported), text: row.value || null });
  } else if (category === 'goal') {
    // A standing target ("120 min/day Math"), carried forward to later days.
    add('', {
      kind: 'goal', label: label || null, subject: label ? subjectOf(label) : null,
      target_minutes: num(row.value) ?? num(row.minutes_reported), standing: event === 'daily_target' || /day/i.test(row.unit),
      text: row.notes || null,
    });
    const exam = examFromText(row.notes, row.date);
    if (exam) out.push({ key: `${row.row_id}#exam`, tracker: 'life', at, day, data: { kind: 'exam', label: `${label ? subjectOf(label).replace(/^\w/, (c) => c.toUpperCase()) : 'Study'} ${exam.word}`, subject: label ? subjectOf(label) : null, date: exam.date } });
  } else if (category === 'emotion' || category === 'mood') {
    const feelings = String(row.value || (/^(emotion|mood)$/i.test(label) ? '' : label)).split(/\s*(?:;|,|\band\b)\s*/).map((f) => f.trim().toLowerCase()).filter(Boolean);
    add('', { kind: 'mood', text: row.value || label, feelings, severity: num(row.severity_0_10), cause: row.cause || null, note: row.notes || null });
  } else if (category === 'exam' || category === 'deadline' || event === 'exam') {
    // An upcoming exam: value (or end_at) = its date, label = its name.
    const date = normDate(row.value) ?? normDate(String(row.end_at).slice(0, 10)) ?? normDate(String(row.start_at).slice(0, 10));
    // Subject: the unit column if given, else from the name ("MAT 213 Midterm" -> math).
    const named = String(label).replace(/\b(midterm|final|exam|test|quiz)\b/gi, '').replace(/\b[A-Z]{2,4}\s?\d{3}\b/g, '');
    const subject = row.unit ? subjectOf(row.unit) : /\bmath?\b|calc/i.test(label) ? 'math' : named.trim() ? subjectOf(named) : null;
    add('', { kind: 'exam', label: label || 'Exam', subject, date, status: row.status || null });
  } else if (category === 'freeze') {
    add('', { kind: 'shield', text: label || row.notes || null });
  } else {
    add('', { kind: category || 'note', text: [label, row.value, row.notes].filter(Boolean).join(' — ') || null });
  }

  // Only the Life tab awards XP (per the sheet's Read me).
  if (xp) add('#xp', { kind: 'xp', amount: xp, reason: label || category });
  return out;
}

function mapSkinRow(row, at, day, issues) {
  const label = row.label.toLowerCase();
  if (row.status === 'not_reported' || row.status === 'pending' || SKIN_SKIP.test(label)) return [];
  const out = [];
  const add = (tracker, data) => out.push({ key: row.row_id, tracker, at, day, data });
  const yes = bool(row.value);
  const count = num(row.value);
  const routine = skinRoutine(label);

  // A routine check-in with no TRUE/FALSE (e.g. "AM Routine" reported) means done.
  if (routine && yes === null && !row.value && /check|routine|reported/i.test(`${row.event} ${row.category}`)) {
    add('life', { kind: 'habit', habit: routine, value: null, text: row.notes || null });
  } else if (routine && yes !== null) {
    add('life', yes ? { kind: 'habit', habit: routine, value: null } : { kind: 'miss', habit: routine, text: row.notes || null });
  } else if (label === 'water' && count !== null) {
    const glasses = row.unit === 'oz' ? Math.round((count / 8) * 10) / 10 : count;
    add('life', { kind: 'habit', habit: 'water', value: glasses, text: `${row.value} ${row.unit}`.trim() });
  } else if (label === 'night sleep' && count !== null) {
    add('life', { kind: 'sleep', hours: count, text: row.notes || null });
  } else if (label === 'headache' && yes) {
    add('life', { kind: 'headache', severity: null, text: row.notes || null });
  } else if (label.startsWith('visible spots:')) {
    if (count === null) issues.push({ row_id: row.row_id, reason: `spot count "${row.value}" is not a number` });
    else add('skin', { kind: 'zone_spots', zone: zoneId(row.label.split(':')[1]), count, text: row.notes || null });
  } else if (label === 'visible inflamed spots' || label === 'new spots') {
    if (count === null) {
      if (row.value) issues.push({ row_id: row.row_id, reason: `spot count "${row.value}" is not a number (format the cell as a plain number)` });
    } else add('skin', { kind: label === 'new spots' ? 'new_spots' : 'spots', count, text: row.notes || null });
  } else if (/acne severity|acne score/.test(label) && count !== null) {
    add('skin', { kind: 'note', text: row.label, severity: count });
  } else if (row.photo_url || row.photo_reference || row.unit === 'photo') {
    // photo_url is a direct image link the sync downloads and stores; the
    // older photo_reference is often a private link (or JSON).
    add('skin', { kind: 'photo', text: row.label, source_url: photoLink(row), photo_ref: row.photo_url ? null : row.photo_reference || null });
  } else {
    const value = yes === true ? 'yes' : yes === false ? 'no' : row.value;
    add('skin', { kind: 'note', text: [row.label, value].filter(Boolean).join(': '), severity: null });
  }
  return out;
}

// DoorDash rows: a dash (shift) or a day-level expense.
function mapDashRow(row, at, day) {
  const key = row.row_id;
  if (/expense/i.test(row.category) || /^dd-exp/.test(key)) {
    return [{ key, tracker: 'life', at, day, data: { kind: 'dash_expense', amount: num(row.amount ?? row.value), text: row.label || row.notes || null } }];
  }
  const startStamp = stampFor(row.start_at);
  const endStamp = stampFor(row.end_at);
  // Structured columns come from the DoorDash tab; "All events" only has net in value.
  const data = {
    kind: 'dash', label: row.label || null,
    start: startStamp, end: endStamp,
    minutes: num(row.minutes_confirmed) ?? num(row.minutes_reported),
    pay: num(row.pay) ?? num(String(row.notes).match(/\$(\d+(?:\.\d+)?)\s*gross/)?.[1]),
    offers: num(row.offers),
    miles: num(row.miles),
    gas_cost: num(row.gas_cost) ?? num(String(row.notes).match(/gas \$(\d+(?:\.\d+)?)/)?.[1]),
    net_profit: num(row.net_profit) ?? num(row.value),
    net_per_hour: num(row.net_per_hour),
    net_per_mile: num(row.net_per_mile),
    note: row.note || row.notes || null,
  };
  return [{ key, tracker: 'life', at: startStamp ?? at, day, data }];
}

// Money rows: income from side jobs. label = source (RSA, eBay, Upwork),
// value = amount; event=monthly makes it that month's total (month = date's
// month, or YYYY-MM in unit), otherwise it's one payment/sale on that day.
function mapMoneyRow(row, at, day) {
  const amount = num(row.value);
  const monthly = /month/i.test(row.event) || /month/i.test(row.category);
  const period = monthly ? (String(row.unit).match(/^\d{4}-\d{2}$/) ? row.unit : day.slice(0, 7)) : null;
  return [{ key: row.row_id, tracker: 'life', at, day, data: { kind: 'income', job: row.label || row.category || null, amount, period, basis: row.outcome || null, note: row.notes || null } }];
}

// Math revisitor rows: problems to come back to.
function mapRevisitRow(row, at, day) {
  return [{
    key: row.row_id, tracker: 'life', at, day,
    data: {
      kind: 'revisit', problem_id: row.label || null,
      topic: row.topic || noteField(row.notes, 'Topic'),
      problem: row.problem_transcription || noteField(row.notes, 'Problem') || null,
      where_stuck: row.where_stuck || noteField(row.notes, 'Where stuck') || null,
      status: (row.status || 'open').toLowerCase(),
      revisited_at: row.revisited_at || null, mastered_at: row.mastered_at || null,
      concept: row.event === 'concept' || undefined,
      photo_url: photoLink(row), notes: row.notes || null,
    },
  }];
}

// Food rows are grouped by day + meal_id into one meal event (plus one pain
// report per meal). "no pain reported" becomes pain 0 only if the same day
// has no unscored pain report, so a pain day never reads as pain-free.
function mapFoodRows(rows) {
  const out = [];
  const meals = new Map();
  for (const row of rows) {
    const id = `${creditDay(row)}|${row.meal_id || row.row_id}`;
    if (!meals.has(id)) meals.set(id, []);
    meals.get(id).push(row);
  }
  const pained = (r) => /pain reported/i.test(r.outcome) && !/no pain/i.test(r.outcome);
  const painDays = new Set(rows.filter(pained).map(creditDay));

  for (const [id, items] of meals) {
    const first = items[0];
    const day = creditDay(first);
    const mealId = id.slice(11);
    const eaten = stampFor(first.eaten_at_local);
    const at = eaten ?? atFor(first);
    const text = items.map((r) => [r.label, r.value].filter(Boolean).join(' (') + (r.value ? ')' : '')).join(', ');
    out.push({ key: `meal:${id}`, tracker: 'food', at, day, data: { kind: 'meal', text, items: items.map((r) => r.label).filter(Boolean), pain: null, meal_id: mealId } });

    const pains = items.filter(pained);
    if (pains.length) {
      const onset = num(pains[0].onset_minutes_approx);
      // Pain happened `onset` minutes after eating, when the eating time is known.
      const reportAt = eaten && onset ? new Date(new Date(eaten).getTime() + onset * 60000).toISOString() : at;
      out.push({ key: `pain:${id}`, tracker: 'food', at: reportAt, day,
        data: {
          kind: 'pain_report', pain: num(pains.find((r) => num(r.severity_0_10) !== null)?.severity_0_10), meal_id: mealId,
          onset_minutes: onset,
          text: [`after ${pains.map((r) => r.label).join(', ')}`, onset ? `~${onset} min onset` : null].filter(Boolean).join(', '),
        },
      });
    } else if (items.some((r) => /no pain reported/i.test(r.outcome)) && !painDays.has(day)) {
      out.push({ key: `pain:${id}`, tracker: 'food', at, day, data: { kind: 'pain_report', pain: 0, text: 'no pain reported', meal_id: mealId } });
    }
  }
  return out;
}

// Fill missing columns so a renamed or dropped column can't crash the mapper.
const normalize = (row) => {
  const out = { ...row };
  for (const c of COLUMNS) out[c] = String(out[c] ?? '').trim();
  return out;
};

// rows from parseCsv -> [{ tracker, at, data }] with data.sheet_row_id set.
// Rows that can't be read are pushed onto `issues` as { row_id, reason }.
export function mapSheetRows(rawRows, issues = []) {
  const events = [];
  const food = [];
  const seen = new Set();
  let rows = rawRows.map(normalize);
  // Session names live on start rows; end rows (which carry the minutes)
  // share start_at/end_at with them, so copy the name across.
  const sessionKey = (r) => `${r.category}|${r.start_at}|${r.end_at}`;
  const names = new Map(rows.filter((r) => r.event === 'start' && r.label && r.start_at).map((r) => [sessionKey(r), r.label]));
  rows = rows.map((r) => (['end', 'pause'].includes(r.event) && !r.label && names.has(sessionKey(r)) ? { ...r, label: names.get(sessionKey(r)) } : r));
  // Starts that an end/pause row closes (matched by category + start time).
  const closedStarts = new Set(rows
    .filter((r) => ['end', 'pause'].includes(r.event.toLowerCase()) && stampFor(r.start_at))
    .map((r) => `${r.category.toLowerCase()}|${stampFor(r.start_at)}`));
  const ctx = { closedStarts };

  for (const row of rows) {
    if (!row.row_id) { if (row.date || row.label) issues.push({ row_id: null, reason: `row without row_id (${row.date} ${row.label})`.trim() }); continue; }
    if (seen.has(row.row_id)) { issues.push({ row_id: row.row_id, reason: 'duplicate row_id; only the first row is used' }); continue; }
    seen.add(row.row_id);
    if (!normDate(row.date)) { issues.push({ row_id: row.row_id, reason: `date "${row.date}" is not a date (use YYYY-MM-DD)` }); continue; }
    const day = creditDay(row);
    const tracker = row.tracker.toLowerCase();
    try {
      if (tracker.startsWith('food')) food.push(row);
      else if (tracker === 'life') events.push(...mapLifeRow(row, atFor(row), day, ctx));
      else if (tracker === 'skin') events.push(...mapSkinRow(row, atFor(row), day, issues));
      else if (tracker.startsWith('doordash')) events.push(...mapDashRow(row, atFor(row), day));
      else if (tracker === 'money' || tracker === 'income') events.push(...mapMoneyRow(row, atFor(row), day));
      else if (tracker.startsWith('math')) events.push(...mapRevisitRow(row, atFor(row), day));
      else issues.push({ row_id: row.row_id, reason: `unknown tracker "${row.tracker}"` });
    } catch (err) {
      issues.push({ row_id: row.row_id, reason: `could not read row: ${err.message}` });
    }
  }
  events.push(...mapFoodRows(food));
  return events.map(({ key, tracker, at, day, data }) => ({
    // `day` = the day this counts toward (credit_date, else date), which can
    // differ from the clock time (e.g. 12:10 AM skincare credited to Friday).
    tracker, at, data: { ...data, sheet_row_id: key, source: 'sheet', day },
  }));
}

// ---- Side tabs --------------------------------------------------------------

// Which side tab a parsed CSV is, by its header.
export function tabKind(rows) {
  const keys = new Set(Object.keys(rows[0] ?? {}));
  if (keys.has('pay') && keys.has('net_profit')) return 'doordash';
  if (keys.has('problem_transcription')) return 'math';
  if (keys.has('feeling_1')) return 'emotion';
  if (keys.has('eaten_at_local')) return 'food';
  if (keys.has('confirmation_status') && keys.has('label') && keys.has('rule_id')) return 'skin';
  if (keys.has('tracker') && keys.has('category')) return 'all';
  return null;
}

const asTime = (date, value) => {
  const t = clock(value);
  return t ? `${date} ${pad(t[0])}:${pad(t[1])}` : '';
};

function fromTab(kind, r) {
  const date = normDate(r.date) ?? r.date;
  switch (kind) {
    case 'doordash':
      if (!r.row_id || r.row_id === 'row_id') return null; // the expense section's own header
      if (/^dd-exp/.test(r.row_id)) {
        // Expense rows sit under their own header: row_id,date,amount,category,note.
        return { row_id: r.row_id, date, tracker: 'DoorDash', category: 'expense', event: 'expense', amount: r.start, value: r.start, label: r.minutes || r.end };
      }
      return {
        row_id: r.row_id, date, tracker: 'DoorDash', category: 'dash', event: 'dash', time_local: asTime(date, r.start).slice(11),
        start_at: asTime(date, r.start), end_at: asTime(date, r.end), minutes_confirmed: r.minutes,
        pay: r.pay, offers: r.offers, miles: r.miles, gas_cost: r.gas_cost, net_profit: r.net_profit,
        net_per_hour: r.net_per_hour, net_per_mile: r.net_per_mile, note: r.note,
      };
    case 'math':
      return {
        row_id: r.row_id, date, time_local: r.time_local, tracker: 'Math revisitor', category: 'study', event: 'problem',
        label: r.problem_id, status: r.status, topic: r.topic, problem_transcription: r.problem_transcription,
        where_stuck: r.where_stuck, revisited_at: r.revisited_at, mastered_at: r.mastered_at, photo_url: r.photo_url,
        notes: r.qualifier, credit_date: r.credit_date, reported_at_local: r.reported_at_local,
      };
    case 'emotion':
      return {
        row_id: r.row_id, date, time_local: r.report_time_local, tracker: 'Life', category: 'emotion', event: 'emotion',
        value: [r.feeling_1, r.feeling_2].filter(Boolean).join('; '), severity_0_10: r.severity_0_10, cause: r.cause, notes: r.notes,
      };
    case 'skin':
      return { ...r, date, tracker: 'Skin', category: 'skin_log', event: 'reported', status: r.confirmation_status, notes: r.qualifier };
    default:
      return null;
  }
}

// Merges side tabs into the "All events" rows, keyed by row_id:
//  - DoorDash / Math revisitor / Emotion rows replace their "All events" copies
//    (the tabs have the structured columns) and add rows missing from it;
//  - Skin rows missing from "All events" are added, and a number mangled there
//    (e.g. 16 shown as "0:00") is taken from the Skin tab;
//  - Food rows add their pain score and eaten-at time to the matching row.
// The Life tab is not merged: its rows use different ids for the same sessions.
export function mergeSheetTabs(allRows, tabs = []) {
  const byId = new Map(allRows.map((r) => [r.row_id, r]));
  const extra = [];
  for (const rows of tabs) {
    const kind = tabKind(rows);
    for (const r of rows) {
      if (!r.row_id) continue;
      const existing = byId.get(r.row_id);
      if (kind === 'food') {
        if (existing) Object.assign(existing, { severity_0_10: r.severity_0_10 || existing.severity_0_10 || '', eaten_at_local: r.eaten_at_local || '' });
        continue;
      }
      const row = fromTab(kind, r);
      if (!row) continue;
      if (kind === 'skin' && existing) {
        if (num(existing.value) === null && num(row.value) !== null && /^\d+:\d{2}$/.test(existing.value)) existing.value = row.value;
        continue;
      }
      if (existing) Object.assign(existing, { ...row, credit_date: row.credit_date || existing.credit_date, reported_at_local: row.reported_at_local || existing.reported_at_local });
      else { byId.set(row.row_id, row); extra.push(row); }
    }
  }
  return [...allRows, ...extra];
}

// ---- Sheet vs direct entries -----------------------------------------------

// What an entry is "about", so a direct (API/form) entry only replaces the
// sheet's copy of the same thing — never everything of that kind on that day.
// Kinds that add up (meals, XP, water, notes) only match an identical entry.
function topic(e) {
  const d = e.data ?? {};
  const kind = d.kind === 'miss' ? 'habit' : d.kind ?? 'unknown';
  const low = (v) => String(v ?? '').toLowerCase().trim();
  let detail;
  if (d.kind === 'session') detail = `${d.activity}|${d.subject ?? ''}|${d.minutes ?? ''}`;
  else if (['habit', 'miss'].includes(d.kind) && d.habit !== 'water') detail = d.habit;
  else if (d.kind === 'todo') detail = d.todo_id ?? low(d.text);
  else if (d.kind === 'xp') detail = `${d.amount}|${low(d.reason)}`;
  else if (d.kind === 'meal') detail = (Array.isArray(d.items) && d.items.length ? d.items.map(low).sort().join('+') : low(d.text));
  else if (['pain_report', 'headache', 'mood', 'life_note', 'note'].includes(d.kind)) detail = `${low(d.text)}|${d.pain ?? d.severity ?? ''}`;
  else detail = `unique:${d.sheet_row_id ?? d.url ?? Math.random()}`; // photos, water, dashes... never replace each other
  return `${e.tracker}|${kind}|${detail}`;
}

// Sheet data is a backup: when the same entry came in through the API/form on
// the same day, drop the sheet's version of it.
export function preferDirectEntries(events, dayOf) {
  const key = (e) => `${/^\d{4}-\d{2}-\d{2}$/.test(e.data?.day ?? '') ? e.data.day : dayOf(e.at)}|${topic(e)}`;
  const direct = new Set(events.filter((e) => e.data?.source !== 'sheet').map(key));
  if (direct.size === 0) return events;
  return events.filter((e) => e.data?.source !== 'sheet' || !direct.has(key(e)));
}

// ---- Sync -------------------------------------------------------------------

// Refuse to remove more than this share of existing sheet entries in one
// sync; a truncated or broken export shouldn't wipe the backup.
const MAX_REMOVAL_SHARE = 0.5;

// Upserts mapped sheet events by sheet_row_id and soft-deletes sheet events
// whose rows are gone from the sheet. Rows that exist but couldn't be read are
// left alone (never treated as removed). Entries deleted through the API stay
// deleted. Returns counts and issues.
export async function syncSheet(pool, rows, { resolvePhoto, tabs = [] } = {}) {
  const issues = [];
  const merged = mergeSheetTabs(rows.map(normalize), tabs);
  const events = mapSheetRows(merged, issues);
  // Download linked photos (once each) and point the events at the stored copy.
  const photoErrors = [];
  if (resolvePhoto) {
    for (const e of events) {
      if (e.data.kind !== 'photo' || !e.data.source_url) continue;
      try {
        const photo = await resolvePhoto(e.data.source_url, e.data.text);
        Object.assign(e.data, { url: photo.url, photo_id: photo.id });
      } catch (err) {
        photoErrors.push(`${e.data.sheet_row_id}: ${err.message}`);
      }
    }
  }
  const base = { rows: merged.length, ...(issues.length && { issues }) };
  if (events.length === 0) return { ...base, events: 0, removed: 0, skipped_removal: 'no valid rows in sheet' };
  // Rows still in the sheet that couldn't be read keep their existing entries.
  const unreadable = new Set(issues.map((i) => i.row_id).filter(Boolean));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let upserted = 0;
    for (const e of events) {
      await client.query(
        `INSERT INTO events (tracker, at, data) VALUES ($1, $2, $3)
         ON CONFLICT ((data->>'sheet_row_id')) WHERE data ? 'sheet_row_id'
         DO UPDATE SET tracker = EXCLUDED.tracker, at = EXCLUDED.at, data = EXCLUDED.data,
           deleted_at = CASE WHEN events.deleted_by = 'sheet' THEN NULL ELSE events.deleted_at END,
           deleted_by = CASE WHEN events.deleted_by = 'sheet' THEN NULL ELSE events.deleted_by END
         WHERE events.tracker IS DISTINCT FROM EXCLUDED.tracker OR events.at IS DISTINCT FROM EXCLUDED.at
            OR events.data IS DISTINCT FROM EXCLUDED.data OR events.deleted_by = 'sheet'`,
        [e.tracker, e.at, e.data]
      );
      upserted++;
    }
    const ids = new Set(events.map((e) => e.data.sheet_row_id));
    const { rows: live } = await client.query(
      `SELECT data->>'sheet_row_id' AS id FROM events WHERE data ? 'sheet_row_id' AND deleted_at IS NULL`
    );
    const stale = live.map((r) => r.id).filter((id) => !ids.has(id) && !unreadable.has(id.replace(/#xp$/, '')));
    let removed = 0;
    let skipped;
    if (stale.length > 5 && stale.length > live.length * MAX_REMOVAL_SHARE) {
      skipped = `would remove ${stale.length} of ${live.length} sheet entries; export looks incomplete`;
    } else if (stale.length > 0) {
      ({ rowCount: removed } = await client.query(
        `UPDATE events SET deleted_at = now(), deleted_by = 'sheet'
         WHERE data ? 'sheet_row_id' AND deleted_at IS NULL AND data->>'sheet_row_id' = ANY($1)`,
        [stale]
      ));
    }
    await client.query('COMMIT');
    return {
      ...base, events: upserted, removed,
      photos: events.filter((e) => e.data.kind === 'photo' && e.data.url).length,
      ...(photoErrors.length && { photo_errors: photoErrors }),
      ...(skipped && { skipped_removal: skipped }),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
