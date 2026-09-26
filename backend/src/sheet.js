// Maps the "All events" tab of the tracker Google Sheet into events in the
// shapes interpret.js understands. Every event gets data.sheet_row_id so a
// re-sync updates rows in place, and data.source = 'sheet'.
//
// Sheet columns: row_id, date, time_local, timezone, tracker, category,
// event, label, value, unit, outcome, status, start_at, end_at,
// minutes_reported, minutes_confirmed, xp_awarded, meal_id,
// onset_minutes_approx, source_message_ids, photo_reference, notes

const ACTIVITY = { homework: 'hmwk', work: 'work', workout: 'workout', walk: 'walk', rest: 'rest', social: 'social' };
const HABIT_ALIASES = { room_cleaned: 'room_clean', skin_am: 'am_skincare', skin_pm: 'pm_skincare', breakfast: 'morning_ritual' };
const SKIN_ROUTINES = { 'am routine': 'am_skincare', 'pm routine': 'pm_skincare', sunscreen: 'sunscreen' };
// Skin-tab rows already covered by Life-tab rows (sessions, wake, bedtime) or
// derived by the sheet's own dashboard; skipped to avoid double counting.
const SKIN_SKIP = /^(nap|rest in bed|stated bedtime|first wake text|bedtime-to-first-wake|routine score|visible spots:)/;

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
    } else if (ch === '"') quoted = true;
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
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const num = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const bool = (v) => (/^true$/i.test(v) ? true : /^false$/i.test(v) ? false : null);

// First HH:MM in the time field (handles "7:00", "08:00-11:00",
// "about 10:50", "2026-09-24 18:12:26 America/Phoenix"); noon if none.
// Sheet times are America/Phoenix, which is UTC-7 year-round.
function atFor(row) {
  const time = (row.time_local || row.time || '').replace(/^\d{4}-\d{2}-\d{2}\s*/, '');
  const m = time.match(/(\d{1,2}):(\d{2})/);
  const hhmm = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '12:00';
  return `${row.date}T${hhmm}:00-07:00`;
}

// row -> [{ sheet_row_id, tracker, at, data }]
function mapLifeRow(row, at) {
  const out = [];
  const add = (suffix, data) => out.push({ key: row.row_id + suffix, tracker: 'life', at, data });
  const category = row.category.toLowerCase();
  const label = row.label;
  const xp = num(row.xp_awarded);

  if (category === 'wake') {
    add('', { kind: 'wake', text: row.notes || null });
  } else if (ACTIVITY[category] && ['start', 'end', 'duration'].includes(row.event)) {
    const activity = ACTIVITY[category];
    // Homework labels are the subject ("History", "Calculus"); other
    // activities' labels are descriptions ("AI work", "Allison").
    const subject = activity === 'hmwk' && label ? label.toLowerCase() : null;
    const minutes = num(row.minutes_confirmed) ?? num(row.minutes_reported);
    if (row.event === 'end' || row.event === 'duration') {
      // End/duration rows carry the confirmed minutes; the sheet pairs start/end.
      add('', { kind: 'session', action: 'end', activity, subject, minutes, label: label || null });
    } else if (!/closed/.test(row.status)) {
      add('', { kind: 'session', action: 'start', activity, subject, minutes: null, label: label || null });
    }
  } else if (category === 'miss' || row.outcome === 'miss') {
    add('', { kind: 'miss', habit: slug(label || category), text: row.notes || null });
  } else if (['bonus', 'ritual', 'care'].includes(category) && label) {
    const habit = HABIT_ALIASES[slug(label)] ?? slug(label);
    add('', { kind: 'habit', habit, value: null, text: row.value || null });
  } else if (category === 'sleep') {
    add('', { kind: 'habit', habit: 'bedtime', value: null, text: row.status || null });
  } else if (category === 'symptom' && /headache/i.test(label)) {
    add('', { kind: 'headache', severity: null, text: row.notes || null });
  } else if (category === 'study_goal') {
    add('', {
      kind: 'goal', label: label || null,
      subject: label ? label.toLowerCase().replace(/\s*homework$/, '') : null,
      target_minutes: num(row.minutes_reported), text: row.value || null,
    });
  } else if (category === 'emotion') {
    add('', { kind: 'mood', text: row.value || label, note: row.notes || null });
  } else {
    add('', { kind: category || 'note', text: [label, row.value, row.notes].filter(Boolean).join(' — ') || null });
  }

  // Only the Life tab awards XP (per the sheet's Read me).
  if (xp) add('#xp', { kind: 'xp', amount: xp, reason: label || category });
  return out;
}

function mapSkinRow(row, at) {
  const label = row.label.toLowerCase();
  if (row.status === 'not_reported' || row.status === 'pending' || SKIN_SKIP.test(label)) return [];
  const out = [];
  const add = (tracker, data) => out.push({ key: row.row_id, tracker, at, data });
  const yes = bool(row.value);

  if (SKIN_ROUTINES[label] && yes !== null) {
    const habit = SKIN_ROUTINES[label];
    add('life', yes ? { kind: 'habit', habit, value: null } : { kind: 'miss', habit, text: row.notes || null });
  } else if (label === 'water' && num(row.value) !== null) {
    const glasses = row.unit === 'oz' ? Math.round((num(row.value) / 8) * 10) / 10 : num(row.value);
    add('life', { kind: 'habit', habit: 'water', value: glasses, text: `${row.value} ${row.unit}`.trim() });
  } else if (label === 'night sleep' && num(row.value) !== null) {
    add('life', { kind: 'sleep', hours: num(row.value), text: row.notes || null });
  } else if (label === 'headache' && yes) {
    add('life', { kind: 'headache', severity: null, text: row.notes || null });
  } else if (label === 'visible inflamed spots' && num(row.value) !== null) {
    add('skin', { kind: 'spots', count: num(row.value), text: row.notes || null });
  } else if (row.photo_reference || row.unit === 'photo') {
    add('skin', { kind: 'photo', text: row.label, photo_ref: row.photo_reference || null });
  } else {
    const value = yes === true ? 'yes' : yes === false ? 'no' : row.value;
    add('skin', { kind: 'note', text: [row.label, value].filter(Boolean).join(': '), severity: null });
  }
  return out;
}

// Food rows are grouped by meal_id into one meal event (plus one pain
// report per meal). "no pain reported" becomes pain 0 only if the same day
// has no unscored pain report, so a pain day never reads as pain-free.
function mapFoodRows(rows) {
  const out = [];
  const meals = new Map();
  for (const row of rows) {
    const id = row.meal_id || row.row_id;
    if (!meals.has(id)) meals.set(id, []);
    meals.get(id).push(row);
  }
  const painDays = new Set(rows.filter((r) => r.outcome === 'pain reported').map((r) => r.date));

  for (const [mealId, items] of meals) {
    const first = items[0];
    const at = atFor(first);
    const text = items.map((r) => [r.label, r.value].filter(Boolean).join(' (') + (r.value ? ')' : '')).join(', ');
    out.push({ key: `meal:${mealId}`, tracker: 'food', at, data: { kind: 'meal', text, pain: null, meal_id: mealId } });

    const pained = items.filter((r) => r.outcome === 'pain reported');
    if (pained.length) {
      const onset = num(pained[0].onset_minutes_approx);
      out.push({
        key: `pain:${mealId}`, tracker: 'food', at,
        data: {
          kind: 'pain_report', pain: num(pained[0].severity_0_10) ?? null, meal_id: mealId,
          text: [`after ${pained.map((r) => r.label).join(', ')}`, onset ? `~${onset} min onset` : null].filter(Boolean).join(', '),
        },
      });
    } else if (items.some((r) => r.outcome === 'no pain reported') && !painDays.has(first.date)) {
      out.push({ key: `pain:${mealId}`, tracker: 'food', at, data: { kind: 'pain_report', pain: 0, text: 'no pain reported', meal_id: mealId } });
    }
  }
  return out;
}

// rows from parseCsv -> [{ tracker, at, data }] with data.sheet_row_id set.
export function mapSheetRows(rows) {
  const events = [];
  const food = [];
  // Session names live on start rows; end rows (which carry the minutes)
  // share start_at/end_at with them, so copy the name across.
  const sessionKey = (r) => `${r.category}|${r.start_at}|${r.end_at}`;
  const names = new Map(rows.filter((r) => r.event === 'start' && r.label && r.start_at).map((r) => [sessionKey(r), r.label]));
  rows = rows.map((r) => (r.event === 'end' && !r.label && names.has(sessionKey(r)) ? { ...r, label: names.get(sessionKey(r)) } : r));
  for (const row of rows) {
    if (!row.row_id || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const tracker = row.tracker.toLowerCase();
    if (tracker.startsWith('food')) food.push(row);
    else if (tracker === 'life') events.push(...mapLifeRow(row, atFor(row)));
    else if (tracker === 'skin') events.push(...mapSkinRow(row, atFor(row)));
  }
  events.push(...mapFoodRows(food));
  return events.map(({ key, tracker, at, data }) => ({
    tracker, at, data: { ...data, sheet_row_id: key, source: 'sheet' },
  }));
}

// What an entry is "about", so a direct entry only replaces sheet entries
// of the same thing: meals replace meals, a hmwk session replaces hmwk
// sessions, a sunscreen habit/miss replaces the sheet's sunscreen, etc.
function topic(e) {
  const d = e.data ?? {};
  const kind = d.kind === 'miss' ? 'habit' : d.kind ?? 'unknown';
  const detail = d.kind === 'session' ? d.activity : ['habit', 'miss'].includes(d.kind) ? d.habit : '';
  return `${e.tracker}|${kind}|${detail ?? ''}`;
}

// Sheet data is a backup: when entries about the same thing on the same day
// came in through the API/form, drop the sheet's versions of them.
export function preferDirectEntries(events, dayOf) {
  const key = (e) => `${dayOf(e.at)}|${topic(e)}`;
  const direct = new Set(events.filter((e) => e.data?.source !== 'sheet').map(key));
  if (direct.size === 0) return events;
  return events.filter((e) => e.data?.source !== 'sheet' || !direct.has(key(e)));
}

// Refuse to remove more than this share of existing sheet entries in one
// sync; a truncated or broken export shouldn't wipe the backup.
const MAX_REMOVAL_SHARE = 0.5;

// Upserts mapped sheet events by sheet_row_id and soft-deletes sheet events
// whose rows are gone from the sheet. Returns counts.
export async function syncSheet(pool, rows) {
  const events = mapSheetRows(rows);
  // An empty mapping would make "NOT (id = ANY('{}'))" match every row.
  if (events.length === 0) return { rows: rows.length, events: 0, removed: 0, skipped_removal: 'no valid rows in sheet' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let upserted = 0;
    for (const e of events) {
      await client.query(
        `INSERT INTO events (tracker, at, data) VALUES ($1, $2, $3)
         ON CONFLICT ((data->>'sheet_row_id')) WHERE data ? 'sheet_row_id'
         DO UPDATE SET tracker = EXCLUDED.tracker, at = EXCLUDED.at, data = EXCLUDED.data, deleted_at = NULL
         WHERE events.tracker IS DISTINCT FROM EXCLUDED.tracker OR events.at IS DISTINCT FROM EXCLUDED.at
            OR events.data IS DISTINCT FROM EXCLUDED.data OR events.deleted_at IS NOT NULL`,
        [e.tracker, e.at, e.data]
      );
      upserted++;
    }
    const ids = events.map((e) => e.data.sheet_row_id);
    const { rows: [counts] } = await client.query(
      `SELECT count(*)::int AS live,
              count(*) FILTER (WHERE NOT (data->>'sheet_row_id' = ANY($1)))::int AS stale
       FROM events WHERE data ? 'sheet_row_id' AND deleted_at IS NULL`,
      [ids]
    );
    let removed = 0;
    let skipped;
    if (counts.stale > 5 && counts.stale > counts.live * MAX_REMOVAL_SHARE) {
      skipped = `would remove ${counts.stale} of ${counts.live} sheet entries; export looks incomplete`;
    } else if (counts.stale > 0) {
      ({ rowCount: removed } = await client.query(
        `UPDATE events SET deleted_at = now()
         WHERE data ? 'sheet_row_id' AND deleted_at IS NULL AND NOT (data->>'sheet_row_id' = ANY($1))`,
        [ids]
      ));
    }
    await client.query('COMMIT');
    return { rows: rows.length, events: upserted, removed, ...(skipped && { skipped_removal: skipped }) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
