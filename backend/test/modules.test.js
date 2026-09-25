import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

// Catches syntax errors in modules the other tests don't import (db.js,
// index.js, form.js), which would otherwise only show up at deploy time.
test('every src module loads', async () => {
  const dir = new URL('../src/', import.meta.url);
  for (const file of await readdir(dir)) {
    if (file.endsWith('.js')) await assert.doesNotReject(import(new URL(file, dir).href), file);
  }
});

test('createPool explains how to set DATABASE_URL', async () => {
  const { createPool } = await import('../src/db.js');
  assert.throws(() => createPool(''), /DATABASE_URL is not set[\s\S]*docker run/);
});
