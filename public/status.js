// Live "Synced N min ago" in the header, from /api/health (public), so it's
// always clear whether the Google Sheet sync is working.

const API_BASE = window.SOMA_API_BASE ?? '';
let timer = null;

function label(sync) {
  if (!sync || !sync.last_synced_at) return { text: 'Sheet never synced', ok: false };
  if (sync.last_error) return { text: 'Sheet sync problem', ok: false, title: sync.last_error };
  const m = sync.minutes_ago ?? 0;
  const ago = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  return { text: `Synced ${ago}`, ok: Boolean(sync.healthy), title: `Last sheet sync: ${sync.last_synced_at}` };
}

async function refresh() {
  const el = document.getElementById('sync-state');
  if (!el || document.body.classList.contains('is-locked')) return;
  try {
    const res = await fetch(`${API_BASE}/api/health`);
    const health = await res.json();
    const { text, ok, title } = label(health.sheet_sync);
    const span = el.querySelector('span:last-child') ?? el;
    span.textContent = text;
    el.classList.toggle('connected', ok);
    el.classList.toggle('error', !ok);
    el.title = title ?? '';
  } catch {
    /* keep the last known state */
  }
}

export function startSyncStatus() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, 60000);
}

export const refreshSyncStatus = refresh;
