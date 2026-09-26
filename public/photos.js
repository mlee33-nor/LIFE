// Acne photos: a per-day gallery and a before/after comparison slider.
// Data comes from GET /api/skin/photos (days with photos, each photo tagged
// with its angle: front / left / right).

const API_BASE = window.SOMA_API_BASE ?? '';
const API_KEY = window.SOMA_API_KEY ?? (() => { try { return localStorage.getItem('soma-api-key') ?? ''; } catch { return ''; } })();
const state = { days: [], before: null, after: null, angle: 'front', position: 50 };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const photoUrl = (url) => `${API_BASE}${url}${API_KEY ? `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(API_KEY)}` : ''}`;
const niceDate = (iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts);
const angleName = (angle) => (angle ? angle[0].toUpperCase() + angle.slice(1) : 'Photo');
const photoFor = (day, angle) => day?.photos.find((p) => p.angle === angle) ?? null;

export async function loadSkinPhotos() {
  const el = document.getElementById('skin-photos');
  if (!el) return;
  try {
    const res = await fetch(`${API_BASE}/api/skin/photos`, { headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.days = [...data.days].sort((a, b) => a.date.localeCompare(b.date)); // oldest first
  } catch {
    state.days = [];
  }
  // Keep the user's picks if those days still exist; otherwise compare the
  // first and latest days that have photos.
  const dates = state.days.map((d) => d.date);
  if (!dates.includes(state.before)) state.before = dates[0] ?? null;
  if (!dates.includes(state.after) || state.after === state.before) state.after = dates.at(-1) ?? null;
  render(el);
}

function render(el) {
  if (!state.days.length) {
    el.innerHTML = `${header('No face photos yet')}<p class="photo-empty">Face photos appear here once INSTINCT logs them with a photo link, or when one is uploaded on the log form.</p>`;
    return;
  }
  const before = state.days.find((d) => d.date === state.before);
  const after = state.days.find((d) => d.date === state.after);
  const angles = ['front', 'left', 'right'].filter((a) => state.days.some((d) => photoFor(d, a)));
  if (!angles.includes(state.angle)) state.angle = angles[0] ?? 'front';
  const b = photoFor(before, state.angle);
  const a = photoFor(after, state.angle);
  const dayOptions = (selected) => state.days.map((d) => `<option value="${d.date}"${d.date === selected ? ' selected' : ''}>${esc(niceDate(d.date))}</option>`).join('');

  el.innerHTML = `
    ${header(`${state.days.length} ${state.days.length === 1 ? 'day' : 'days'} of photos`)}
    <div class="compare-controls">
      <label>Before<select id="compare-before">${dayOptions(state.before)}</select></label>
      <label>After<select id="compare-after">${dayOptions(state.after)}</select></label>
      <div class="angle-toggle" role="group" aria-label="Photo angle">
        ${angles.map((angle) => `<button type="button" data-angle="${angle}" class="${angle === state.angle ? 'active' : ''}" aria-pressed="${angle === state.angle}">${angleName(angle)}</button>`).join('')}
      </div>
    </div>
    ${state.days.length < 2
      ? `<p class="photo-empty">Only one day has photos so far. The before/after slider appears once a second day is logged.</p>`
      : b && a
        ? compare(before, after, b, a)
        : `<p class="photo-empty">No ${angleName(state.angle).toLowerCase()} photo on ${esc(niceDate((b ? after : before).date))}. Try another angle.</p>`}
    <h3 class="photo-gallery-title">All photos</h3>
    <div class="photo-gallery">
      ${[...state.days].reverse().map((d) => `
        <div class="photo-day">
          <div class="photo-day-head"><strong>${esc(niceDate(d.date, { weekday: 'long', month: 'short', day: 'numeric' }))}</strong><span>${d.spots != null ? `${d.spots} spots` : 'spots not counted'}</span></div>
          <div class="photo-row">
            ${d.photos.map((p) => `<a class="photo-thumb" href="${esc(photoUrl(p.url))}" target="_blank" rel="noopener" title="${esc(p.label || angleName(p.angle))}"><img src="${esc(photoUrl(p.url))}" alt="${esc(`${p.label || angleName(p.angle)}, ${niceDate(d.date)}`)}" loading="lazy"><span>${esc(angleName(p.angle))}</span></a>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;

  el.querySelector('#compare-before').addEventListener('change', (e) => { state.before = e.target.value; render(el); });
  el.querySelector('#compare-after').addEventListener('change', (e) => { state.after = e.target.value; render(el); });
  el.querySelectorAll('[data-angle]').forEach((btn) => btn.addEventListener('click', () => { state.angle = btn.dataset.angle; render(el); }));
  wireSlider(el);
}

function header(subtitle) {
  return `<div class="card-header"><div><p class="eyebrow">Skin photos</p><h2>Before &amp; after</h2><p>${esc(subtitle)}. Drag the divider to compare the same angle on two days.</p></div></div>`;
}

function compare(before, after, b, a) {
  const tag = (day) => `${niceDate(day.date)}${day.spots != null ? ` · ${day.spots} spots` : ''}`;
  return `
    <div class="compare-stage" style="--pos:${state.position}%">
      <img class="compare-img" src="${esc(photoUrl(a.url))}" alt="After: ${esc(tag(after))}" draggable="false">
      <img class="compare-img compare-before" src="${esc(photoUrl(b.url))}" alt="Before: ${esc(tag(before))}" draggable="false">
      <span class="compare-tag before">Before · ${esc(tag(before))}</span>
      <span class="compare-tag after">After · ${esc(tag(after))}</span>
      <div class="compare-divider" aria-hidden="true"><span class="compare-handle">⇆</span></div>
      <input class="compare-range" type="range" min="0" max="100" value="${state.position}" aria-label="Before and after divider position">
    </div>`;
}

function wireSlider(el) {
  const stage = el.querySelector('.compare-stage');
  if (!stage) return;
  const range = stage.querySelector('.compare-range');
  const set = (pos) => {
    state.position = Math.min(100, Math.max(0, pos));
    stage.style.setProperty('--pos', `${state.position}%`);
    range.value = String(Math.round(state.position));
  };
  range.addEventListener('input', () => set(Number(range.value)));
  // Drag anywhere on the image, not just the thin handle.
  const fromPointer = (e) => {
    const rect = stage.getBoundingClientRect();
    set(((e.clientX - rect.left) / rect.width) * 100);
  };
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    fromPointer(e);
    const move = (ev) => fromPointer(ev);
    const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
  });
}
