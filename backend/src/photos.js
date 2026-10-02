// Photo uploads: stored in Postgres, served at /api/photos/<sha256> (an
// unguessable address, since these are face photos), and linked
// from a skin event so each photo appears on its day in the dashboard.

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

// True for loopback, private, link-local and other non-public addresses, so a
// photo link can't be used to make the server fetch internal services.
export function isPrivateAddress(ip) {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new ValidationError([`could not resolve ${host}`]);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new ValidationError(['url must point to a public host']);
}

// Downloads an image from a URL the agent provides (e.g. a share link).
// Follows at most 5 redirects, each checked, and stops reading past 15 MB.
export async function fetchImage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError(['url is not a valid URL']);
  }
  let res;
  for (let hop = 0; ; hop++) {
    if (!/^https?:$/.test(parsed.protocol)) throw new ValidationError(['url must be http(s)']);
    await assertPublicHost(parsed.hostname);
    res = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (res.status < 300 || res.status >= 400) break;
    const next = res.headers.get('location');
    if (!next || hop >= 5) throw new ValidationError(['photo link redirects too many times']);
    parsed = new URL(next, parsed);
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!res.ok) throw new ValidationError([`could not download photo (HTTP ${res.status})`]);
  if (!IMAGE_TYPE.test(type)) {
    throw new ValidationError([`url returned ${type || 'unknown content'}, not an image (is the link public?)`]);
  }
  if (Number(res.headers.get('content-length')) > MAX_PHOTO_BYTES) throw new ValidationError(['photo is larger than 15 MB']);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_PHOTO_BYTES) throw new ValidationError(['photo is larger than 15 MB']);
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), contentType: type };
}

// Stores image bytes (deduplicated by content). Returns { id, url, duplicate }.
export async function storePhotoBytes(db, { buffer, contentType, label = null, sourceUrl = null }) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPE.test(type)) throw new ValidationError([`photo must be an image (jpeg, png, webp, gif, heic), got ${type || 'nothing'}`]);
  if (!buffer?.length) throw new ValidationError(['photo is empty']);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const { rows } = await db.query(
    `INSERT INTO photos (sha256, content_type, bytes, label, source_url) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sha256) DO UPDATE SET source_url = COALESCE(photos.source_url, EXCLUDED.source_url)
     RETURNING id, (xmax <> 0) AS duplicate`,
    [sha256, type, buffer, label, sourceUrl]
  );
  return { id: String(rows[0].id), url: `/api/photos/${sha256}`, duplicate: rows[0].duplicate };
}

// For sheet rows that link to an image: reuse the stored copy if this link
// was downloaded before, otherwise download and store it.
export async function photoFromLink(db, url, label) {
  const { rows } = await db.query('SELECT id, sha256 FROM photos WHERE source_url = $1', [url]);
  if (rows.length) return { id: String(rows[0].id), url: `/api/photos/${rows[0].sha256}` };
  const image = await fetchImage(url);
  return storePhotoBytes(db, { ...image, label, sourceUrl: url });
}

// Saves an uploaded photo and a skin event for it. Re-uploading the same
// image returns the existing photo instead of duplicating it.
export async function savePhoto(pool, { buffer, contentType, label = null, at = null, sourceUrl = null }) {
  const atSql = at ? parseIso(at, 'at') : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stored = await storePhotoBytes(client, { buffer, contentType, label, sourceUrl });
    // Same image again: only add an entry if none is live (it may have been deleted).
    if (stored.duplicate) {
      const { rows: live } = await client.query(
        `SELECT 1 FROM events WHERE deleted_at IS NULL AND data->>'kind' = 'photo' AND data->>'url' = $1 LIMIT 1`,
        [stored.url]
      );
      if (live.length) {
        await client.query('ROLLBACK');
        return stored;
      }
    }
    const id = stored.id;
    const sha256 = stored.url.split('/').pop();
    const data = { kind: 'photo', photo_id: id, url: `/api/photos/${sha256}`, text: label, severity: null };
    const params = [JSON.stringify(data)];
    if (atSql) params.push(atSql.param);
    await client.query(
      `INSERT INTO events (tracker, data, at) VALUES ('skin', $1::jsonb, ${atSql ? atSql.sql.replace('$', '$2') : 'now()'})`,
      params
    );
    await client.query('COMMIT');
    return stored;
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
