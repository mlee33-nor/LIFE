// Logging-agent endpoints from tracker-api-contract.md: POST /log and
// GET /entries (plus DELETE /entries/:id for corrections).

import { timingSafeEqual } from 'node:crypto';
import { localIso, TIMEZONE } from './interpret.js';

export const TRACKERS = ['life', 'food', 'skin'];

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.status = 400;
    this.errors = errors;
  }
}

// YYYY-MM-DD, optionally followed by THH:MM[:SS[.fff]], optionally Z/±HH:MM.
const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(Z|[+-]\d{2}:?\d{2})?)?$/;

// Parses an ISO string into a SQL expression + param. Values without an
// offset are read as local time in TIMEZONE (America/Phoenix by default).
export function parseIso(value, name, { endOfDay = false } = {}) {
  const m = typeof value === 'string' ? value.trim().match(ISO) : null;
  if (!m || Number.isNaN(new Date(m[1]).getTime())) {
    throw new ValidationError([`${name} must be ISO-8601, e.g. 2026-09-25T15:20:00-07:00`]);
  }
  const [, date, time, offset] = m;
  if (offset) return { sql: '$::timestamptz', param: value.trim() };
  if (!time) {
    // Date only: start of that local day, or start of the next day for `until`.
    return {
      sql: `(($::date + ${endOfDay ? 1 : 0})::timestamp AT TIME ZONE '${TIMEZONE}')`,
      param: date,
      exclusive: endOfDay,
    };
  }
  return { sql: `($::timestamp AT TIME ZONE '${TIMEZONE}')`, param: `${date}T${time}` };
}

export function validateLog(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError(['body must be a JSON object: { tracker, at?, data }']);
  }
  const errors = [];
  if (!TRACKERS.includes(body.tracker)) errors.push(`tracker must be one of: ${TRACKERS.join(', ')}`);
  if (body.data === undefined) errors.push('data is required (any JSON)');
  let at = null;
  if (body.at !== undefined && body.at !== null) {
    try {
      at = parseIso(body.at, 'at');
    } catch (err) {
      errors.push(...err.errors);
    }
  }
  if (errors.length) throw new ValidationError(errors);
  return { tracker: body.tracker, at, data: body.data };
}

export async function insertLog(pool, { tracker, at, data }) {
  const atSql = at ? at.sql.replace('$', '$3') : 'now()';
  const params = [tracker, JSON.stringify(data)];
  if (at) params.push(at.param);
  const { rows } = await pool.query(
    `INSERT INTO events (tracker, data, at) VALUES ($1, $2::jsonb, ${atSql}) RETURNING id`,
    params
  );
  return String(rows[0].id);
}

// Inserts several validated entries atomically; returns their ids.
export async function insertLogs(pool, entries) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [];
    for (const e of entries) ids.push(await insertLog(client, e));
    await client.query('COMMIT');
    return ids;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listEntries(pool, params) {
  const tracker = params.get('tracker');
  if (!TRACKERS.includes(tracker)) {
    throw new ValidationError([`tracker query param is required: one of ${TRACKERS.join(', ')}`]);
  }
  const where = ['deleted_at IS NULL', 'tracker = $1'];
  const values = [tracker];
  for (const [name, op] of [['since', '>='], ['until', '<=']]) {
    const v = params.get(name);
    if (!v) continue;
    const parsed = parseIso(v, name, { endOfDay: name === 'until' });
    values.push(parsed.param);
    where.push(`at ${parsed.exclusive ? '<' : op} ${parsed.sql.replace('$', `$${values.length}`)}`);
  }
  const { rows } = await pool.query(
    `SELECT id, tracker, at, data FROM events WHERE ${where.join(' AND ')} ORDER BY at, id`,
    values
  );
  return rows.map((r) => ({ id: String(r.id), tracker: r.tracker, at: localIso(r.at), data: r.data }));
}

export async function softDelete(pool, id) {
  const { rowCount } = await pool.query(
    'UPDATE events SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return rowCount > 0;
}

// Accepts "Authorization: Bearer <key>", or ?key=<key> (browser
// EventSource can't send headers).
export function checkApiKey(req, expected, url) {
  if (!expected) return false;
  const header = req.headers.authorization ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : (url?.searchParams.get('key') ?? '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readBody(req, limit = 100_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  return body;
}

export function parseJson(text) {
  if (!text.trim()) throw new ValidationError(['request body is empty']);
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError(['request body is not valid JSON']);
  }
}

export async function readJson(req) {
  return parseJson(await readBody(req));
}
