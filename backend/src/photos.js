// Photo uploads: stored in Postgres, served at /api/photos/<sha256> (an
// unguessable address, since these are face photos), and linked
// from a skin event so each photo appears on its day in the dashboard.

import { createHash } from 'node:crypto';
import { parseIso, ValidationError } from './write.js';

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|heic|heif)$/;

export async function readBuffer(req, limit = MAX_PHOTO_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error(`Photo is larger than ${limit / 1024 / 1024} MB`), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Downloads an image from a URL the agent provides (e.g. a share link).
export async function fetchImage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(['url is not a valid URL']);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new ValidationError(['url must be http(s)']);
  const res = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok) throw new ValidationError([`could not download photo (HTTP ${res.status})`]);
  if (!IMAGE_TYPE.test(type)) {
    throw new ValidationError([`url returned ${type || 'unknown content'}, not an image (is the link public?)`]);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_PHOTO_BYTES) throw new ValidationError(['photo is larger than 15 MB']);
  return { buffer, contentType: type };
}

// Saves a photo and its skin event. Re-uploading the same image returns the
// existing photo instead of duplicating it.
export async function savePhoto(pool, { buffer, contentType, label = null, at = null, sourceUrl = null }) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPE.test(type)) throw new ValidationError([`photo must be an image (jpeg, png, webp, gif, heic), got ${type || 'nothing'}`]);
  if (!buffer?.length) throw new ValidationError(['photo is empty']);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const atSql = at ? parseIso(at, 'at') : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM photos WHERE sha256 = $1', [sha256]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return { id: String(existing.rows[0].id), url: `/api/photos/${sha256}`, duplicate: true };
    }
    const { rows } = await client.query(
      'INSERT INTO photos (sha256, content_type, bytes, label, source_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [sha256, type, buffer, label, sourceUrl]
    );
    const id = String(rows[0].id);
    const data = { kind: 'photo', photo_id: id, url: `/api/photos/${sha256}`, text: label, severity: null };
    const params = [JSON.stringify(data)];
    if (atSql) params.push(atSql.param);
    await client.query(
      `INSERT INTO events (tracker, data, at) VALUES ('skin', $1::jsonb, ${atSql ? atSql.sql.replace('$', '$2') : 'now()'})`,
      params
    );
    await client.query('COMMIT');
    return { id, url: `/api/photos/${sha256}`, duplicate: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getPhoto(pool, sha256) {
  const { rows } = await pool.query('SELECT content_type, bytes FROM photos WHERE sha256 = $1', [sha256]);
  return rows[0] ?? null;
}
