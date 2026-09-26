// Key-gated HTML form at /submit for agents that can drive a browser but
// can't send HTTP headers (Instinct). Plain HTML, no JavaScript needed.
//
// The JSON box accepts the same body as POST /log, an array of them, or
// {"delete": "<id>"}.

import { checkApiKey, insertLogs, parseJson, readBody, softDelete, validateLog, ValidationError } from './write.js';
import { localIso } from './interpret.js';
import { MAX_PHOTO_BYTES, readBuffer, savePhoto } from './photos.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const EXAMPLE = `{"tracker": "food", "data": {"kind": "meal", "text": "eggs, toast", "pain": null}}`;

function page({ key = '', json = '', status = null, message = '', details = [], recent = [] }) {
  const result = status
    ? `<section id="result" data-status="${status}" class="${status}" role="status">
        <strong>${status === 'success' ? 'SUCCESS' : 'ERROR'}:</strong> ${esc(message)}
        ${details.length ? `<ul>${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      </section>`
    : '';
  const rows = recent
    .map((e) => `<tr><td>${esc(e.id)}</td><td>${esc(e.tracker)}</td><td>${esc(e.at)}</td><td><code>${esc(JSON.stringify(e.data))}</code></td></tr>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Log entry</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; background: #fafafa; }
  label { display: block; font-weight: 600; margin: 16px 0 4px; }
  input, textarea { width: 100%; box-sizing: border-box; font: 14px ui-monospace, monospace; padding: 8px; border: 1px solid #999; border-radius: 6px; }
  textarea { min-height: 180px; }
  button { margin-top: 16px; font-size: 16px; padding: 10px 24px; border-radius: 6px; border: 0; background: #2456d6; color: #fff; cursor: pointer; }
  #result { margin: 16px 0; padding: 12px; border-radius: 6px; }
  .success { background: #e3f6e8; border: 1px solid #2e8b57; }
  .error { background: #fde8e8; border: 1px solid #c0392b; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  td, th { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  code { word-break: break-word; }
  small { color: #555; }
</style></head>
<body>
<h1>Log entry</h1>
${result}
<form id="log-form" method="post" action="/submit" enctype="multipart/form-data" autocomplete="off">
  <label for="key">API key</label>
  <input id="key" name="key" type="password" required value="${esc(key)}">
  <label for="json">Entry JSON</label>
  <textarea id="json" name="json" spellcheck="false" placeholder="${esc(EXAMPLE)}">${esc(json)}</textarea>
  <small>One entry <code>{"tracker", "at"?, "data"}</code>, a list <code>[{...}, {...}]</code>, or <code>{"delete": "123"}</code>. See tracker-api-contract.md.</small>
  <label for="photo">Photo (optional)</label>
  <input id="photo" name="photo" type="file" accept="image/*">
  <label for="photo_label">Photo label</label>
  <input id="photo_label" name="photo_label" type="text" placeholder="e.g. Face photo front">
  <small>Attach a face photo to add it to today's skin log. JSON and a photo can be sent together.</small><br>
  <button id="submit" type="submit">Submit</button>
</form>
${recent.length ? `<h2>Latest entries</h2><table id="recent"><tr><th>id</th><th>tracker</th><th>at</th><th>data</th></tr>${rows}</table>` : ''}
</body></html>`;
}

export function sendPage(res, status, opts) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
  });
  res.end(page(opts));
}

async function recentEntries(store) {
  const state = await store.get();
  return state.events.slice(-10).reverse().map((e) => ({ ...e, at: localIso(e.at) }));
}

export async function handleForm(req, res, { pool, store, writeApiKey }) {
  if (req.method === 'GET') {
    sendPage(res, 200, {});
    return;
  }

  // Multipart when a photo is attached; urlencoded otherwise.
  const type = req.headers['content-type'] ?? '';
  let field;
  let photo = null;
  if (type.startsWith('multipart/form-data')) {
    const body = await readBuffer(req, MAX_PHOTO_BYTES + 1_000_000);
    const fd = await new Request('http://local/', { method: 'POST', headers: { 'content-type': type }, body }).formData();
    field = (name) => (typeof fd.get(name) === 'string' ? fd.get(name) : '');
    const file = fd.get('photo');
    if (file && typeof file !== 'string' && file.size > 0) photo = file;
  } else {
    const form = new URLSearchParams(await readBody(req));
    field = (name) => form.get(name) ?? '';
  }
  const key = field('key');
  const json = field('json');

  if (!writeApiKey || !checkApiKey({ headers: { authorization: `Bearer ${key}` } }, writeApiKey)) {
    sendPage(res, 401, { json, status: 'error', message: 'Invalid API key' });
    return;
  }

  try {
    if (!json.trim() && !photo) throw new ValidationError(['fill in the Entry JSON box, attach a photo, or both']);
    const messages = [];
    if (photo) {
      const saved = await savePhoto(pool, {
        buffer: Buffer.from(await photo.arrayBuffer()),
        contentType: photo.type,
        label: field('photo_label') || photo.name || null,
      });
      messages.push(saved.duplicate ? `Photo already saved (photo ${saved.id})` : `Saved photo ${saved.id}`);
    }
    if (json.trim()) messages.push(await handleJson(json, pool));
    store.dirty = true; // show the new rows below without waiting for NOTIFY
    sendPage(res, 200, { key, status: 'success', message: messages.join('; '), recent: await recentEntries(store) });
  } catch (err) {
    const known = err instanceof ValidationError || ['23514', '22P02', '22007', '22008'].includes(err.code);
    if (!known) console.error(err);
    sendPage(res, known ? 400 : 503, {
      key,
      json,
      status: 'error',
      message: known ? 'Nothing was saved' : `Server error: ${err.message}`,
      details: err.errors ?? (known ? [err.message] : []),
    });
  }
}

// Handles the Entry JSON box: entries to log, or {"delete": id}.
async function handleJson(json, pool) {
  {
    let body;
    try {
      body = parseJson(json);
    } catch {
      throw new ValidationError(['the Entry JSON box is empty or not valid JSON']);
    }
    let message;
    if (body && !Array.isArray(body) && body.delete !== undefined) {
      const id = String(body.delete);
      if (!/^\d+$/.test(id) || !(await softDelete(pool, id))) {
        throw new ValidationError([`entry ${id} not found`]);
      }
      message = `Deleted entry ${id}`;
    } else {
      const list = Array.isArray(body) ? body : [body];
      if (list.length === 0 || list.length > 50) throw new ValidationError(['send 1-50 entries']);
      const clean = list.map((e, i) => {
        try {
          return validateLog(e);
        } catch (err) {
          if (list.length > 1) err.errors = err.errors.map((m) => `entry ${i + 1}: ${m}`);
          throw err;
        }
      });
      const ids = await insertLogs(pool, clean);
      message = `Logged ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}, id ${ids.join(', ')}`;
    }
    return message;
  }
}
