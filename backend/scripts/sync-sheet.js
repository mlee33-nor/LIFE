// Syncs the tracker Google Sheet's "All events" tab into Postgres.
//
//   DATABASE_URL=... npm run db:sync-sheet -- path/to/all-events.csv
//   DATABASE_URL=... SHEET_CSV_URL=https://... npm run db:sync-sheet
//
// Safe to re-run: rows are matched by row_id.

import { readFile } from 'node:fs/promises';
import { createPool, migrate } from '../src/db.js';
import { parseCsv, syncSheet } from '../src/sheet.js';

const file = process.argv[2];
const url = process.env.SHEET_CSV_URL;
if (!file && !url) {
  console.error('Usage: npm run db:sync-sheet -- all-events.csv   (or set SHEET_CSV_URL)');
  process.exit(1);
}

let text;
if (file) {
  text = await readFile(file, 'utf8');
} else {
  const res = await fetch(url, { redirect: 'follow' });
  text = await res.text();
  if (!res.ok || /^\s*</.test(text)) throw new Error(`Could not read sheet CSV (HTTP ${res.status}); is it shared/published?`);
}

const pool = createPool();
await migrate(pool);
const result = await syncSheet(pool, parseCsv(text));
console.log(`Synced ${result.rows} sheet rows -> ${result.events} events (${result.removed} removed from sheet).`);
await pool.end();
