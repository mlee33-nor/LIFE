// HTTP API for the lifestyle dashboard.
//
// Logging-agent routes (Instinct), per tracker-api-contract.md — require WRITE_API_KEY:
//   POST   /log               append one event
//   GET    /entries           raw events for one tracker
//   DELETE /entries/:id       soft-delete a mistaken event
//   GET/POST /submit          same, as a key-gated HTML form for browser agents
//   POST   /sync/sheet        body = the sheet's "All events" tab as CSV; upserts it
//   POST   /photos            image body (?label=&at=) or JSON {url, label, at}
//
// Dashboard routes (/api/*) for the UI — interpreted data and insights.
//
//   DATABASE_URL   Postgres connection string (required)
//   WRITE_API_KEY  Bearer key the logging agent uses; write routes are disabled if unset
//                  (MUSE_API_KEY is still read as a fallback)
//   READ_API_KEY   optional; if set, /api/* (except health) require it
//   APP_TIMEZONE   default America/Phoenix
//   PORT           default 3001 (Railway sets this)
//   CORS_ORIGIN    default *

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, PgStore } from './db.js';
import { handleForm } from './form.js';
import { parseCsv, syncSheet } from './sheet.js';
import { recordSync, startSheetPoller } from './sheet-poller.js';
import { fetchImage, getPhoto, photoFromLink, readBuffer, savePhoto } from './photos.js';
import { METRICS, TIMEZONE, ACTIVITIES, HABITS, localDate, localIso } from './interpret.js';
import {
  checkApiKey,
  insertLog,
  listEntries,
  readBody,
  readJson,
  softDelete,
  validateLog,
  ValidationError,
  TRACKERS,
} from './write.js';
import {
  filterRange,
  foodCompass,
  foodTriggers,
  focusCurve,
  lifestyleCorrelations,
  optimalBlueprint,
  summary,
  timeseries,
  FLARE_THRESHOLD,
  SYMPTOM_WINDOWS,
} from './analytics.js';
import { weeklyReview } from './review.js';
import { caffeine, countdown, nudges } from './coach.js';
import { doordashSummary, level, moodSummary, painTimeline, recap, streaks, weeklyReport } from './extras.js';

const PORT = Number(process.env.PORT ?? 3001);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function dateParam(params, name) {
  const v = params.get(name);
  if (v === null || v === '') return undefined;
  if (!ISO_DATE.test(v)) throw new HttpError(400, `"${name}" must be YYYY-MM-DD`);
  return v;
}

function intParam(params, name, fallback, { min = 1, max = 3650 } = {}) {
  const v = params.get(name);
  if (v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `"${name}" must be an integer between ${min} and ${max}`);
  }
  return n;
}

function meta(store, state) {
  return {
    timezone: TIMEZONE,
    loaded_at: state.loadedAt,
    last_write_at: state.lastWriteAt,
    event_count: state.events.length,
    day_count: state.daily.length,
    stale_error: store.lastError,
  };
}

export function createServer(store, { pool, writeApiKey, readApiKey } = {}) {
  const clients = new Set();

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      if (!res.destroyed) res.write(msg);
    }
  }

  // Coalesce bursts of writes into one push to the UI.
  let pending = null;
  store.on('change', () => {
    if (pending || clients.size === 0) return;
    pending = setTimeout(async () => {
      pending = null;
      try {
        broadcast('data-updated', meta(store, await store.get()));
      } catch (err) {
        broadcast('source-error', { error: err.message });
      }
    }, 300);
  });

  // --- Logging-agent routes -------------------------------------------

  async function handleAgent(req, url) {
    if (!writeApiKey) throw new HttpError(503, 'WRITE_API_KEY is not configured on the server');
    if (!checkApiKey(req, writeApiKey, url)) throw new HttpError(401, 'Missing or invalid API key');

    if (url.pathname === '/log' && req.method === 'POST') {
      const id = await insertLog(pool, validateLog(await readJson(req)));
      return { ok: true, id };
    }
    if (url.pathname === '/entries' && req.method === 'GET') {
      return { entries: await listEntries(pool, url.searchParams) };
    }
    const match = url.pathname.match(/^\/entries\/(\d+)$/);
    if (match && req.method === 'DELETE') {
      if (!(await softDelete(pool, match[1]))) throw new HttpError(404, `Entry ${match[1]} not found`);
      return { ok: true, deleted: match[1] };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  // --- Dashboard routes -----------------------------------------------

  // When the Google Sheet last pushed, and whether that's recent enough.
  async function sheetSyncStatus() {
    const { rows } = await pool.query(`SELECT name, synced_at, result FROM sync_status WHERE name IN ('sheet', 'sheet_error')`);
    const ok = rows.find((r) => r.name === 'sheet');
    const failed = rows.find((r) => r.name === 'sheet_error');
    // Only surface an error that happened after the last successful sync.
    const error = failed && (!ok || failed.synced_at > ok.synced_at)
      ? { last_error: failed.result.error, last_error_at: localIso(failed.synced_at) } : {};
    if (!ok) return { last_synced_at: null, healthy: false, note: 'sheet has never synced', ...error };
    const minutes = Math.round((Date.now() - ok.synced_at.getTime()) / 60000);
    return {
      last_synced_at: localIso(ok.synced_at),
      minutes_ago: minutes,
      healthy: minutes <= 15 && !error.last_error,
      polling: Boolean(process.env.SHEET_CSV_URL),
      ...ok.result,
      ...error,
    };
  }

  const routes = {
    '/api/health': async () => {
      try {
        return { ok: true, ...meta(store, await store.get()), sheet_sync: await sheetSyncStatus() };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    '/api/schema': async () => ({
      timezone: TIMEZONE,
      trackers: TRACKERS,
      metrics: METRICS,
      activities: ACTIVITIES,
      habits: HABITS,
      flare_threshold: FLARE_THRESHOLD,
      symptom_windows_days: SYMPTOM_WINDOWS,
    }),

    '/api/daily': async (params) => {
      const state = await store.get();
      return {
        meta: meta(store, state),
        days: filterRange(state.daily, dateParam(params, 'from'), dateParam(params, 'to')),
      };
    },

    '/api/timeseries': async (params) => {
      const state = await store.get();
      const requested = params.get('metrics');
      const metrics = requested ? requested.split(',').map((m) => m.trim()) : METRICS;
      const bad = metrics.filter((m) => !METRICS.includes(m));
      if (bad.length) throw new HttpError(400, `Unknown metrics: ${bad.join(', ')}`);
      return {
        meta: meta(store, state),
        ...timeseries(state.daily, {
          from: dateParam(params, 'from'),
          to: dateParam(params, 'to'),
          metrics,
          smooth: intParam(params, 'smooth', 7, { min: 1, max: 90 }),
        }),
      };
    },

    '/api/summary': async (params) => {
      const state = await store.get();
      return {
        meta: meta(store, state),
        active_sessions: state.activeSessions,
        level: level(state.daily.reduce((sum, d) => sum + (d.xp ?? 0), 0)),
        ...summary(state.daily, {
          days: intParam(params, 'days', 30),
          to: dateParam(params, 'to'),
        }),
      };
    },

    '/api/insights/foods': async (params) => {
      const state = await store.get();
      const days = filterRange(state.daily, dateParam(params, 'from'), dateParam(params, 'to'));
      return {
        meta: meta(store, state),
        disclaimer: 'Associations in your own logs, not medical conclusions.',
        ...foodTriggers(days, { minDays: intParam(params, 'min_days', 3, { max: 365 }) }),
      };
    },

    '/api/insights/lifestyle': async (params) => {
      const state = await store.get();
      const days = filterRange(state.daily, dateParam(params, 'from'), dateParam(params, 'to'));
      return {
        meta: meta(store, state),
        disclaimer: 'Correlation, not causation. Needs ~2+ weeks of data to be meaningful.',
        correlations: lifestyleCorrelations(days),
      };
    },

    '/api/analytics/blueprint': async (params) => {
      const state = await store.get();
      const days = filterRange(state.daily, dateParam(params, 'from'), dateParam(params, 'to'));
      return {
        meta: meta(store, state),
        ...optimalBlueprint(days.length ? days : state.daily),
      };
    },

    '/api/analytics/food-compass': async (params) => {
      const state = await store.get();
      const days = filterRange(state.daily, dateParam(params, 'from'), dateParam(params, 'to'));
      return {
        meta: meta(store, state),
        ...foodCompass(days.length ? days : state.daily),
      };
    },

    '/api/analytics/focus-curve': async (params) => {
      const state = await store.get();
      const days = filterRange(state.daily, dateParam(params, 'from'), dateParam(params, 'to'));
      return {
        meta: meta(store, state),
        ...focusCurve(days.length ? days : state.daily),
      };
    },

    // Face photos for before/after comparison: grouped by day, each tagged
    // with its angle (front/left/right) so the same angle can be compared.
    // A day's to-do list, plus unfinished tasks carried over from earlier
    // days (most recent first). Defaults to today in the app timezone.
    '/api/todos': async (params, req) => {
      const state = await store.get();
      const date = dateParam(params, 'date') ?? localDate(new Date());
      const day = state.daily.find((d) => d.date === date);
      const rank = { high: 0, normal: 1, low: 2 };
      const sort = (list) => [...list].sort((a, b) => Number(a.done) - Number(b.done) || rank[a.priority] - rank[b.priority]);
      const todos = sort(day?.todos ?? []);
      const carriedOver = state.daily
        .filter((d) => d.date < date)
        .flatMap((d) => d.todos.filter((t) => t.status === 'open').map((t) => ({ ...t, from: d.date })))
        .sort((a, b) => b.from.localeCompare(a.from));
      return {
        meta: meta(store, state),
        date,
        todos,
        carried_over: carriedOver,
        done: todos.filter((t) => t.done).length,
        total: todos.filter((t) => t.status !== 'skipped').length,
        // Whether this visitor may add/tick to-dos (same rule as POST /api/todos),
        // so the page only shows tick boxes that will actually save.
        can_edit: Boolean((readApiKey && checkApiKey(req, readApiKey)) || checkApiKey(req, writeApiKey)),
      };
    },

    // "This week" review: the 7 days ending ?end= (default today) vs the 7 before.
    '/api/review': async (params) => {
      const state = await store.get();
      return { meta: meta(store, state), ...weeklyReview(state.daily, { end: dateParam(params, 'end') }) };
    },

    '/api/skin/photos': async () => {
      const state = await store.get();
      const days = state.daily
        .map((d) => ({
          date: d.date,
          spots: d.acne_spots,
          photos: d.skin.photo_list.filter((p) => p.url),
        }))
        .filter((d) => d.photos.length);
      return {
        meta: meta(store, state),
        angles: [...new Set(days.flatMap((d) => d.photos.map((p) => p.angle).filter(Boolean)))],
        days,
      };
    },

    // Goal progress and habit streaks (recovery-shield days don't break them).
    '/api/streaks': async (params) => {
      const state = await store.get();
      return { meta: meta(store, state), ...streaks(state.daily, { today: dateParam(params, 'date') ?? localDate(new Date()) }) };
    },

    // Short plain-text recap of one day, for Hermes to text at night.
    '/api/recap': async (params) => {
      const state = await store.get();
      return { meta: meta(store, state), ...recap(state.daily, { date: dateParam(params, 'date') ?? localDate(new Date()) }) };
    },

    // Plain-text weekly report: the 7 days ending ?end= vs the 7 before.
    '/api/report/weekly': async (params) => {
      const state = await store.get();
      return { meta: meta(store, state), ...weeklyReport(state.daily, { end: dateParam(params, 'end') ?? localDate(new Date()) }) };
    },

    // Each stomach-pain report with what was eaten in the hours before it.
    '/api/food/pain-timeline': async (params) => {
      const state = await store.get();
      return {
        meta: meta(store, state),
        disclaimer: 'Associations in your own logs, not medical conclusions.',
        ...painTimeline(state.daily, { hours: intParam(params, 'hours', 3, { min: 1, max: 24 }) }),
      };
    },

    // What's off track right now; `text` is ready for MOTION to send.
    '/api/nudges': async () => {
      const state = await store.get();
      const now = new Date();
      // Re-split open sessions against the current time (the store may be minutes old).
      const open = [...state.activeSessions, ...state.staleSessions];
      const fresh = (s) => now - new Date(s.started_at) <= 16 * 3600000;
      const status = await sheetSyncStatus();
      return {
        meta: meta(store, state),
        ...nudges(state.daily, {
          now, exams: state.exams, issues: status.issues ?? [],
          activeSessions: open.filter(fresh), staleSessions: open.filter((s) => !fresh(s)),
        }),
      };
    },

    // Days until each upcoming exam and the study pace toward it.
    '/api/countdown': async (params) => {
      const state = await store.get();
      return { meta: meta(store, state), ...countdown(state.daily, state.exams, { today: dateParam(params, 'date') ?? localDate(new Date()) }) };
    },

    '/api/caffeine': async (params) => {
      const state = await store.get();
      const days = filterRange(state.daily, dateParam(params, 'from'), dateParam(params, 'to'));
      return {
        meta: meta(store, state),
        disclaimer: 'Associations in your own logs, not medical conclusions.',
        ...caffeine(days, { hours: intParam(params, 'hours', 3, { min: 1, max: 12 }) }),
      };
    },

    '/api/doordash': async () => {
      const state = await store.get();
      return { meta: meta(store, state), ...doordashSummary(state.daily) };
    },

    '/api/moods': async () => {
      const state = await store.get();
      return { meta: meta(store, state), ...moodSummary(state.daily) };
    },

    // Math problems to come back to (open first).
    '/api/revisit': async () => {
      const state = await store.get();
      const rank = { open: 0, revisited: 1, solved: 2, mastered: 3 };
      const problems = [...state.revisit].sort((a, b) => (rank[a.status] ?? 1) - (rank[b.status] ?? 1) || b.date.localeCompare(a.date));
      return { meta: meta(store, state), open: problems.filter((p) => p.status === 'open').length, problems };
    },

    // What Hermes wrote that the dashboard couldn't read, and sessions it
    // started but never ended, so Hermes can fix them.
    '/api/sync/issues': async () => {
      const state = await store.get();
      const status = await sheetSyncStatus();
      return {
        checked_at: status.last_synced_at ?? null,
        last_error: status.last_error ?? null,
        skipped: status.issues ?? [],
        photo_errors: status.photo_errors ?? [],
        removal_skipped: status.skipped_removal ?? null,
        unclosed_sessions: state.staleSessions.map((s) => ({ row_id: s.row_id, activity: s.activity, subject: s.subject, started_at: s.started_at })),
      };
    },

    '/api/feed': async (params) => {
      const state = await store.get();
      const tracker = params.get('tracker');
      const from = dateParam(params, 'from');
      const to = dateParam(params, 'to');
      const limit = intParam(params, 'limit', 200, { max: 5000 });
      const daily = new Set(filterRange(state.daily, from, to).map((d) => d.date));
      const events = state.events
        .filter((e) => (!tracker || e.tracker === tracker) && daily.has(localDate(e.at)))
        .slice(-limit)
        .reverse()
        .map((e) => ({ ...e, at: localIso(e.at) }));
      return { meta: meta(store, state), events };
    },
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');

    try {
      if (url.pathname === '/sync/sheet' && req.method === 'POST') {
        if (!writeApiKey) throw new HttpError(503, 'WRITE_API_KEY is not configured on the server');
        if (!checkApiKey(req, writeApiKey, url)) throw new HttpError(401, 'Missing or invalid API key');
        const rows = parseCsv(await readBody(req, 5_000_000));
        if (!rows.length || !('row_id' in rows[0])) throw new HttpError(400, 'Body must be the sheet CSV with a row_id column');
        const result = await syncSheet(pool, rows, { resolvePhoto: (link, label) => photoFromLink(pool, link, label) });
        await recordSync(pool, result, url.searchParams.get('via') ?? 'manual');
        sendJson(res, 200, { ok: true, ...result });
        return;
      }

      // Correct a photo's camera angle when its label was wrong:
      // POST /photos/<sha256>/angle {"angle": "front" | "left" | "right" | null}
      const angleMatch = url.pathname.match(/^\/photos\/([a-f0-9]{64})\/angle$/);
      if (angleMatch && req.method === 'POST') {
        if (!writeApiKey) throw new HttpError(503, 'WRITE_API_KEY is not configured on the server');
        if (!checkApiKey(req, writeApiKey, url)) throw new HttpError(401, 'Missing or invalid API key');
        const { angle = null } = await readJson(req);
        if (angle !== null && !['front', 'left', 'right'].includes(angle)) {
          throw new ValidationError(['angle must be "front", "left", "right" or null']);
        }
        const { rowCount } = await pool.query('UPDATE photos SET angle = $2 WHERE sha256 = $1', [angleMatch[1], angle]);
        if (!rowCount) throw new HttpError(404, 'Photo not found');
        store.dirty = true;
        store.emit('change', { op: 'PHOTO_ANGLE' });
        sendJson(res, 200, { ok: true, angle });
        return;
      }

      if (url.pathname === '/photos' && req.method === 'POST') {
        if (!writeApiKey) throw new HttpError(503, 'WRITE_API_KEY is not configured on the server');
        if (!checkApiKey(req, writeApiKey, url)) throw new HttpError(401, 'Missing or invalid API key');
        const type = (req.headers['content-type'] ?? '').toLowerCase();
        let photo;
        if (type.startsWith('application/json')) {
          const body = await readJson(req);
          photo = { ...(await fetchImage(body.url)), label: body.label ?? null, at: body.at ?? null, sourceUrl: body.url };
        } else {
          photo = { buffer: await readBuffer(req), contentType: type, label: url.searchParams.get('label'), at: url.searchParams.get('at') };
        }
        sendJson(res, 200, { ok: true, ...(await savePhoto(pool, photo)) });
        return;
      }

      if (url.pathname === '/submit' && (req.method === 'GET' || req.method === 'POST')) {
        await handleForm(req, res, { pool, store, writeApiKey });
        return;
      }

      if (url.pathname === '/log' || url.pathname.startsWith('/entries')) {
        sendJson(res, 200, await handleAgent(req, url));
        return;
      }

      // Owner actions from the dashboard (add / tick off to-dos). Need the
      // dashboard password (READ_API_KEY) or the agent key; never open.
      if (req.method === 'POST' && /^\/api\/todos(\/[^/]+)?$/.test(url.pathname)) {
        const owner = (readApiKey && checkApiKey(req, readApiKey, url)) || checkApiKey(req, writeApiKey, url);
        if (!owner) throw new HttpError(401, 'Missing or invalid API key');
        const body = await readJson(req);
        const id = decodeURIComponent(url.pathname.split('/')[3] ?? '');
        const state = await store.get();
        let data;
        if (!id) {
          // New task: { text, priority?, date? }
          const text = String(body.text ?? '').trim();
          if (!text) throw new ValidationError(['text is required']);
          data = {
            kind: 'todo', todo_id: `web-${Date.now().toString(36)}`, text, status: 'open',
            priority: ['high', 'low'].includes(body.priority) ? body.priority : 'normal',
            day: /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '') ? body.date : localDate(new Date()),
          };
        } else {
          // Update: { status: open|done|skipped } — carry the task's text and
          // day so this entry fully replaces the older version of the task.
          if (!['open', 'done', 'skipped'].includes(body.status)) throw new ValidationError(['status must be open, done or skipped']);
          const owning = state.daily.find((d) => d.todos.some((t) => t.id === id));
          const current = owning?.todos.find((t) => t.id === id);
          if (!current) throw new HttpError(404, `To-do ${id} not found`);
          data = { kind: 'todo', todo_id: id, text: current.text, priority: current.priority, notes: current.notes, status: body.status, day: owning.date };
        }
        const entryId = await insertLog(pool, { tracker: 'life', at: null, data: { ...data, source: 'dashboard' } });
        sendJson(res, 200, { ok: true, id: data.todo_id, entry: entryId, status: data.status });
        return;
      }

      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

      if (url.pathname === '/') {
        sendJson(res, 200, { name: 'lifestyle-dashboard-api', health: '/api/health', docs: 'API.md' });
        return;
      }

      if (readApiKey && url.pathname !== '/api/health' &&
          !checkApiKey(req, readApiKey, url) && !checkApiKey(req, writeApiKey, url)) {
        throw new HttpError(401, 'Missing or invalid API key');
      }

      if (url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('retry: 3000\n\n');
        clients.add(res);
        const ping = setInterval(() => {
          if (!res.destroyed) res.write(': ping\n\n');
        }, 25000);
        const cleanup = () => {
          clearInterval(ping);
          clients.delete(res);
        };
        req.on('close', cleanup);
        res.on('error', cleanup); // client vanished mid-write (EPIPE etc.)
        return;
      }

      const photoMatch = url.pathname.match(/^\/api\/photos\/([a-f0-9]{64})$/);
      if (photoMatch) {
        const photo = await getPhoto(pool, photoMatch[1]);
        if (!photo) throw new HttpError(404, 'Photo not found');
        res.writeHead(200, {
          'Content-Type': photo.content_type,
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(photo.bytes);
        return;
      }

      const handler = routes[url.pathname];
      if (!handler) throw new HttpError(404, 'Not found');
      sendJson(res, 200, await handler(url.searchParams, req));
    } catch (err) {
      sendError(res, err);
    }
  });

  server.on('close', () => clearTimeout(pending));
  return server;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendError(res, err) {
  if (err instanceof ValidationError) {
    sendJson(res, 400, { ok: false, error: err.message, details: err.errors });
  } else if (['23514', '22P02', '22007', '22008'].includes(err.code)) {
    // Postgres check-constraint / bad-format errors: the caller's fault.
    sendJson(res, 400, { ok: false, error: err.message });
  } else if (err.status) {
    sendJson(res, err.status, { ok: false, error: err.message });
  } else {
    console.error(err);
    sendJson(res, 503, { ok: false, error: err.message });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  await migrate(pool);
  const store = new PgStore(pool);
  await store.listen();
  const writeApiKey = process.env.WRITE_API_KEY || process.env.MUSE_API_KEY;
  if (!writeApiKey) console.warn('WRITE_API_KEY not set: write routes are disabled.');
  if (process.env.SHEET_CSV_URL) {
    startSheetPoller(pool, process.env.SHEET_CSV_URL, {
      seconds: Number(process.env.SHEET_POLL_SECONDS ?? 60),
      tabGids: (process.env.SHEET_TAB_GIDS ?? "").split(",").map((g) => g.trim()).filter(Boolean),
    });
    console.log('Polling the Google Sheet for changes.');
  }
  createServer(store, { pool, writeApiKey, readApiKey: process.env.READ_API_KEY }).listen(PORT, () => {
    console.log(`Dashboard API on http://localhost:${PORT} (timezone ${TIMEZONE})`);
  });
}
