// Pulls the tracker Google Sheet on a timer and syncs it when it changes,
// so the dashboard stays current without anything installed in the sheet.
//
//   SHEET_CSV_URL        CSV export link of the "All events" tab, e.g.
//                        https://docs.google.com/spreadsheets/d/<id>/export?format=csv
//                        (the sheet must be shared "anyone with the link")
//   SHEET_POLL_SECONDS   default 60

import { createHash } from 'node:crypto';
import { parseCsv, syncSheet } from './sheet.js';
import { photoFromLink } from './photos.js';

const HEARTBEAT_MS = 10 * 60 * 1000;

export async function recordSync(pool, result, via) {
  await pool.query(
    `INSERT INTO sync_status (name, synced_at, result) VALUES ('sheet', now(), $1)
     ON CONFLICT (name) DO UPDATE SET synced_at = now(), result = EXCLUDED.result`,
    [{ ...result, via }]
  );
}

export function startSheetPoller(pool, url, { seconds = 60, log = console } = {}) {
  let lastHash = null;
  let lastRecorded = 0;
  let running = false;

  async function tick() {
    if (running) return; // a slow sync (e.g. first photo downloads) is still going
    running = true;
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      if (!res.ok || /^\s*</.test(text)) {
        throw new Error(`sheet not readable (HTTP ${res.status}); is it still shared "anyone with the link"?`);
      }
      const hash = createHash('sha256').update(text).digest('hex');
      const heartbeatDue = Date.now() - lastRecorded > HEARTBEAT_MS;
      if (hash === lastHash && !heartbeatDue) return;

      if (hash !== lastHash) {
        const rows = parseCsv(text);
        if (!rows.length || !('row_id' in rows[0])) throw new Error('sheet CSV has no row_id column (wrong tab?)');
        const result = await syncSheet(pool, rows, { resolvePhoto: (link, label) => photoFromLink(pool, link, label) });
        log.log(`Sheet synced: ${JSON.stringify(result)}`);
        await recordSync(pool, result, 'server-poll');
        lastHash = hash;
      } else {
        // Nothing changed: refresh the timestamp so health shows the poller is alive.
        await pool.query(`UPDATE sync_status SET synced_at = now() WHERE name = 'sheet'`);
      }
      lastRecorded = Date.now();
    } catch (err) {
      log.error(`Sheet sync failed: ${err.message}`);
      await pool.query(
        `INSERT INTO sync_status (name, synced_at, result) VALUES ('sheet_error', now(), $1)
         ON CONFLICT (name) DO UPDATE SET synced_at = now(), result = EXCLUDED.result`,
        [{ error: err.message }]
      ).catch(() => {});
    } finally {
      running = false;
    }
  }

  tick();
  const timer = setInterval(tick, seconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
