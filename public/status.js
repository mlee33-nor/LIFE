// Live "Synced N min ago" in the header, from /api/health (public), so it's
// always clear whether the Google Sheet sync is working. This module is the
// only one that writes the #sync-state badge; app.js reports data loads here.

const API_BASE = window.SOMA_API_BASE ?? '';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
let timer = null;
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
