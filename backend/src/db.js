// Postgres access: connection pool, migrations, and a cached store that
// refreshes when the logging agent writes (via LISTEN/NOTIFY on `events_changed`).

import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { interpret, localDate } from './interpret.js';
import { preferDirectEntries } from './sheet.js';

const SCHEMA_URL = new URL('../db/schema.sql', import.meta.url);

export function sslFor(connectionString) {
  // Railway's public proxy needs TLS; its private network and localhost don't.
  if (process.env.PGSSL === 'disable') return false;
  if (process.env.PGSSL === 'require') return { rejectUnauthorized: false };
  return /proxy\.rlwy\.net|railway\.app/.test(connectionString) ? { rejectUnauthorized: false } : false;
}

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. For local dev, start Postgres with\n' +
        '  docker run -d --name life-pg -e POSTGRES_PASSWORD=dev -p 55432:5432 postgres:16-alpine\n' +
        'then set DATABASE_URL=postgresql://postgres:dev@localhost:55432/postgres (see backend/API.md).'
    );
  }
  return new pg.Pool({ connectionString, ssl: sslFor(connectionString), max: 5 });
}

export async function migrate(pool) {
  await pool.query(await readFile(SCHEMA_URL, 'utf8'));
}

// Holds all non-deleted events in memory (a personal log is small) and
// reloads them when notified of a change, or at most every `ttlMs` if the
// listener connection is down.
export class PgStore extends EventEmitter {
  constructor(pool, { ttlMs = 5000 } = {}) {
    super();
    this.pool = pool;
    this.ttlMs = ttlMs;
    this.state = null;
    this.dirty = true;
    this.loadedAtMs = 0;
    this.listening = false;
    this.lastError = null;
    this.loading = null;
  }

  get source() {
    return 'postgres';
  }

  async listen() {
    let client;
    try {
      client = await this.pool.connect();
      await client.query('LISTEN events_changed');
      this.listening = true;
      client.on('notification', (msg) => {
        this.dirty = true;
        this.emit('change', JSON.parse(msg.payload));
      });
      client.on('error', (err) => this.relisten(client, err));
      client.on('end', () => this.relisten(client));
    } catch (err) {
      client?.release(true);
      this.relisten(null, err);
    }
  }

  relisten(client, err) {
    if (!this.listening && client) return;
    this.listening = false;
    this.dirty = true;
    if (err) console.error('LISTEN connection lost:', err.message);
    try {
      client?.release(true);
    } catch {
      // already released
    }
    if (!this.closed) setTimeout(() => this.listen(), 3000).unref();
  }

  async get() {
    const expired = !this.listening && Date.now() - this.loadedAtMs > this.ttlMs;
    if (this.state && !this.dirty && !expired) return this.state;
    // Collapse concurrent reloads into one query.
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async load() {
    this.dirty = false;
    try {
      const { rows } = await this.pool.query(
        `SELECT id, tracker, at, data, created_at FROM events
         WHERE deleted_at IS NULL ORDER BY at, id`
      );
      const all = rows.map((r) => ({ id: String(r.id), tracker: r.tracker, at: r.at, data: r.data }));
      const events = preferDirectEntries(all, localDate);
      const lastWrite = rows.reduce((max, r) => (r.created_at > max ? r.created_at : max), new Date(0));
      this.state = {
        events,
        ...interpret(events),
        loadedAt: new Date().toISOString(),
        lastWriteAt: rows.length ? lastWrite.toISOString() : null,
      };
      this.loadedAtMs = Date.now();
      this.lastError = null;
    } catch (err) {
      this.dirty = true;
      this.lastError = `Database query failed: ${err.message}`;
      if (!this.state) throw new Error(this.lastError);
    }
    return this.state;
  }

  async close() {
    this.closed = true;
    this.listening = false;
    await this.pool.end();
  }
}
