// HTTP API for the lifestyle dashboard.
//
// Muse (Luna) routes, per tracker-api-contract.md — require MUSE_API_KEY:
//   POST   /log               append one event
//   GET    /entries           raw events for one tracker
//   DELETE /entries/:id       soft-delete a mistaken event
//
// Dashboard routes (/api/*) for the UI — interpreted data and insights.
//
//   DATABASE_URL   Postgres connection string (required)
//   MUSE_API_KEY   Bearer key Muse uses; Muse routes are disabled if unset
//   READ_API_KEY   optional; if set, /api/* (except health) require it
//   APP_TIMEZONE   default America/Phoenix
//   PORT           default 3001 (Railway sets this)
//   CORS_ORIGIN    default *

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, PgStore } from './db.js';
import { METRICS, TIMEZONE, ACTIVITIES, HABITS, localDate, localIso } from './interpret.js';
import {
  checkApiKey,
  insertLog,
  listEntries,
  readJson,
  softDelete,
  validateLog,
  ValidationError,
  TRACKERS,
} from './write.js';
import {
  filterRange,
  foodTriggers,
  lifestyleCorrelations,
  summary,
  timeseries,
  FLARE_THRESHOLD,
  SYMPTOM_WINDOWS,
} from './analytics.js';

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

export function createServer(store, { pool, museApiKey, readApiKey } = {}) {
  const clients = new Set();

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
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

  // --- Muse routes ----------------------------------------------------

  async function handleMuse(req, url) {
    if (!museApiKey) throw new HttpError(503, 'MUSE_API_KEY is not configured on the server');
    if (!checkApiKey(req, museApiKey, url)) throw new HttpError(401, 'Missing or invalid API key');

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

  const routes = {
    '/api/health': async () => {
      try {
        return { ok: true, ...meta(store, await store.get()) };
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
      if (url.pathname === '/log' || url.pathname.startsWith('/entries')) {
        sendJson(res, 200, await handleMuse(req, url));
        return;
      }

      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

      if (url.pathname === '/') {
        sendJson(res, 200, { name: 'lifestyle-dashboard-api', health: '/api/health', docs: 'API.md' });
        return;
      }

      if (readApiKey && url.pathname !== '/api/health' &&
          !checkApiKey(req, readApiKey, url) && !checkApiKey(req, museApiKey, url)) {
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
        const ping = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }

      const handler = routes[url.pathname];
      if (!handler) throw new HttpError(404, 'Not found');
      sendJson(res, 200, await handler(url.searchParams));
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
  const museApiKey = process.env.MUSE_API_KEY;
  if (!museApiKey) console.warn('MUSE_API_KEY not set: Muse routes are disabled.');
  createServer(store, { pool, museApiKey, readApiKey: process.env.READ_API_KEY }).listen(PORT, () => {
    console.log(`Dashboard API on http://localhost:${PORT} (timezone ${TIMEZONE})`);
  });
}
