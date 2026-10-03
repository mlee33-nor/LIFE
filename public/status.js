// Live "Synced N min ago" in the header, from /api/health (public), so it's
// always clear whether the Google Sheet sync is working. This module is the
// only one that writes the #sync-state badge; app.js reports data loads here.
// It also owns "MOTION logged N min ago" (#motion-heard, from last_write_at):
// amber when MOTION has been quiet for over 6 hours between 8 AM and midnight.

const API_BASE = window.SOMA_API_BASE ?? '';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
let timer = null;
let lastWrite = null;
const QUIET_MS = 6 * 3600000;
const phoenixHourNow = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
let dataState = { loaded: false, offline: false, sample: false };

function label(sync) {
  if (!sync || !sync.last_synced_at) return { text: 'Sheet never synced', ok: false };
  if (sync.last_error) return { text: 'Sheet sync problem', ok: false, title: sync.last_error };
  const m = sync.minutes_ago ?? 0;
  const ago = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  return { text: `Synced ${ago}`, ok: Boolean(sync.healthy), title: `Last sheet sync: ${sync.last_synced_at}` };
}

function paint({ text, ok, title = '' }) {
  const el = document.getElementById('sync-state');
  if (!el) return;
  const span = el.querySelector('span:last-child') ?? el;
  span.textContent = text;
  el.classList.toggle('connected', ok === true);
  el.classList.toggle('error', ok === false);
  el.title = title;
}

function ago(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
}

function paintHeard() {
  const el = document.getElementById('motion-heard');
  if (!el) return;
  const t = Date.parse(lastWrite ?? '');
  if (!Number.isFinite(t)) { el.hidden = true; return; }
  const quiet = Date.now() - t > QUIET_MS && phoenixHourNow() >= 8; // 8 AM - midnight
  el.hidden = false;
  el.textContent = `MOTION logged ${ago(Date.now() - t)}`;
  el.classList.toggle('quiet', quiet);
  el.title = `Last entry written ${new Date(t).toLocaleString('en-US', { timeZone: 'America/Phoenix', weekday: 'short', hour: 'numeric', minute: '2-digit' })}${quiet ? ' · nothing new for over 6 hours' : ''}`;
}

async function refresh() {
  const el = document.getElementById('sync-state');
  if (!el || document.body.classList.contains('is-locked')) return;
  // Sample data only ever exists on a local dev server.
  if (dataState.sample && LOCAL) { paint({ text: 'Local sample data', ok: false, title: 'The API could not be reached from this dev server.' }); return; }
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = await res.json();
    paint(label(health.sheet_sync));
    lastWrite = health.last_write_at ?? null;
    paintHeard();
  } catch {
    paint({ text: dataState.loaded ? 'Offline · showing last loaded data' : 'Offline · can’t reach your data', ok: false });
  }
}

export function startSyncStatus() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, 60000);
}

// Called by app.js after each data load attempt.
export function reportDataLoad({ ok, hasData = false, sample = false }) {
  dataState = { loaded: hasData, offline: !ok && !sample, sample };
  if (!ok && !sample) { paint({ text: hasData ? 'Offline · showing last loaded data' : 'Offline · can’t reach your data', ok: false }); return; }
  refresh();
}

export function reportLoading() {
  const el = document.getElementById('sync-state');
  if (el && !el.classList.contains('connected')) paint({ text: 'Connecting…', ok: null });
}

export const refreshSyncStatus = refresh;
