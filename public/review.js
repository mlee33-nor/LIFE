// "This week": an honest review from GET /api/review - this week's numbers
// next to last week's, only from what was logged. Where there isn't enough
// data the card says so instead of showing a guess.

const API_BASE = window.SOMA_API_BASE ?? '';
const API_KEY = window.SOMA_API_KEY ?? (() => { try { return localStorage.getItem('soma-api-key') ?? ''; } catch { return ''; } })();

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtDate = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const weekday = (iso) => fmtDate(iso, { weekday: 'short' });
const minutes = (m) => (!isNum(m) ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`);
// "2026-09-23T09:05:00-07:00" -> "9:05 AM", read as written (already local).
const clock = (at) => {
  const hm = String(at ?? '').slice(11, 16);
  if (!/^\d\d:\d\d$/.test(hm)) return '';
  const h = Number(hm.slice(0, 2));
  return `${h % 12 || 12}:${hm.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
};

export async function loadReview() {
  const el = document.getElementById('review-card');
  if (!el) return;
  let data = null;
  try {
    const res = await fetch(`${API_BASE}/api/review`, { headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {} });
    if (res.ok) data = await res.json();
  } catch { /* offline: show the empty state */ }
  render(el, data);
}

// Change vs last week. `fewerIsBetter` colours a drop green and a rise
// coral; otherwise the pill stays neutral (more homework isn't "good" or "bad").
function delta(value, { fewerIsBetter = false, format = (v) => `${v}`, suffix = 'vs last week', same = 'same as last week' } = {}) {
  if (!isNum(value)) return '';
  const tone = !fewerIsBetter || value === 0 ? 'neutral' : value < 0 ? 'good' : 'warn';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '=';
  const text = value === 0 ? same : `${format(Math.abs(value))} ${suffix}`;
  return `<span class="review-delta ${tone}"><span aria-hidden="true">${arrow}</span> ${esc(text)}</span>`;
}

const notEnough = (why) => `<span class="review-thin">Not enough data yet${why ? ` · ${esc(why)}` : ''}</span>`;

function tile({ label, value, sub = '', foot = '', empty = false }) {
  return `<div class="review-tile${empty ? ' empty' : ''}">
    <p class="review-label">${esc(label)}</p>
    <strong class="review-value">${value}</strong>
    ${sub ? `<p class="review-sub">${sub}</p>` : ''}
    ${foot ? `<div class="review-foot">${foot}</div>` : ''}
  </div>`;
}

function tiles(r) {
  const { xp, homework: hw, todos, acne, stomach, sleep } = r;
  const compareWhy = `${r.days_logged.last_week} of 7 days logged last week`;
  const subjects = Object.entries(hw.by_subject).slice(0, 3).map(([s, m]) => `${esc(s)} ${minutes(m)}`).join(' · ');
  const pct = todos.total ? Math.round((todos.done / todos.total) * 100) : 0;

  return [
    tile({
      label: 'XP',
      value: isNum(xp.this_week) ? xp.this_week.toLocaleString() : '—',
      sub: xp.best_day ? `Best: ${weekday(xp.best_day.date)} (${xp.best_day.xp})` : '',
      foot: xp.enough_data ? delta(xp.change) : notEnough(isNum(xp.this_week) ? compareWhy : ''),
      empty: !isNum(xp.this_week),
    }),
    tile({
      label: 'Homework',
      value: minutes(hw.this_week_minutes),
      sub: [subjects, hw.goals.set ? `${hw.goals.hit}/${hw.goals.set} goals hit` : ''].filter(Boolean).join('<br>'),
      foot: hw.enough_data ? delta(hw.change_minutes, { format: minutes }) : notEnough(isNum(hw.this_week_minutes) ? compareWhy : ''),
      empty: !isNum(hw.this_week_minutes),
    }),
    tile({
      label: 'To-dos',
      value: todos.total ? `${todos.done}<small> / ${todos.total}</small>` : '—',
      sub: todos.total ? `<span class="review-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="To-dos done"><span style="width:${pct}%"></span></span>` : '',
      foot: todos.total ? `<span class="review-thin">${pct}% done</span>` : '<span class="review-thin">No to-dos this week</span>',
      empty: !todos.total,
    }),
    tile({
      label: 'Acne spots',
      value: acne.latest ? acne.latest.spots : acne.first ? acne.first.spots : '—',
      sub: acne.enough_data
        ? `${acne.first.spots} → ${acne.latest.spots} · ${weekday(acne.first.date)} to ${weekday(acne.latest.date)}`
        : acne.first ? `Counted once (${weekday(acne.first.date)})` : '',
      foot: `${acne.enough_data
        ? delta(acne.change, { fewerIsBetter: true, format: (v) => `${v} spot${v === 1 ? '' : 's'}`, suffix: 'this week', same: 'no change this week' })
        : notEnough('need 2 days with a count')}${acne.photo_days ? `<span class="review-thin">${acne.photo_days} photo day${acne.photo_days === 1 ? '' : 's'}</span>` : ''}`,
      empty: !acne.first,
    }),
    tile({
      label: 'Stomach',
      value: `${stomach.reports}<small> report${stomach.reports === 1 ? '' : 's'}</small>`,
      sub: isNum(stomach.average_pain) ? `Avg pain ${stomach.average_pain}/10 (${stomach.scored_reports} scored)` : stomach.reports ? 'No pain scores given' : '',
      foot: isNum(stomach.change_reports)
        ? delta(stomach.change_reports, { fewerIsBetter: true, format: (v) => `${v} report${v === 1 ? '' : 's'}` })
        : stomach.enough_data ? '' : notEnough(`${stomach.food_days} day${stomach.food_days === 1 ? '' : 's'} of meals`),
      empty: !stomach.reports && !stomach.enough_data,
    }),
    tile({
      label: 'Sleep',
      value: isNum(sleep.average_hours) ? `${sleep.average_hours}<small> h avg</small>` : '—',
      sub: sleep.nights ? `${sleep.nights} night${sleep.nights === 1 ? '' : 's'} known` : '',
      foot: isNum(sleep.change_hours) ? delta(sleep.change_hours, { format: (v) => `${v} h` }) : notEnough(sleep.enough_data ? 'to compare' : `need ${r.min_days} nights`),
      empty: !isNum(sleep.average_hours),
    }),
  ].join('');
}

function painList(stomach) {
  if (!stomach.pain_reports.length) return '';
  const foods = (list) => list.map(esc).join(', ');
  const rows = stomach.pain_reports.map((p) => {
    const before = [
      p.foods_same_day.length ? `${foods(p.foods_same_day)} <em>(same day)</em>` : '',
      p.foods_day_before.length ? `${foods(p.foods_day_before)} <em>(day before)</em>` : '',
    ].filter(Boolean).join(' · ');
    return `<li>
      <div class="review-pain-top"><strong>${esc(weekday(p.date))} ${esc(clock(p.at))}</strong>${isNum(p.pain) ? `<span class="review-score">${p.pain}/10</span>` : ''}</div>
      <p>${before ? `After: ${before}` : 'No meals logged that day or the day before'}</p>
      ${p.text ? `<small>“${esc(p.text)}”</small>` : ''}
    </li>`;
  }).join('');
  return `<div class="review-section"><h3>Pain reports</h3><ul class="review-pain">${rows}</ul></div>`;
}

function safeFoods(stomach) {
  if (stomach.safe_foods === null) return '';
  if (!stomach.safe_foods.length) return '<div class="review-section"><h3>No pain after</h3><p class="review-thin">Nothing yet this week: every food was followed by a pain report or the next day wasn’t logged.</p></div>';
  const chips = stomach.safe_foods.slice(0, 12).map((f) => `<li>${esc(f.food)}${f.days > 1 ? ` <span>×${f.days}</span>` : ''}</li>`).join('');
  return `<div class="review-section"><h3>No pain after</h3><ul class="review-chips">${chips}</ul><p class="review-thin">No pain report that day or the next. Based on ${stomach.food_days} days of meals.</p></div>`;
}

function render(el, r) {
  if (!r) {
    el.innerHTML = '<div class="review-head"><div><p class="eyebrow">Review</p><h2>This week</h2></div></div><p class="review-thin review-empty">The weekly review isn’t available right now.</p>';
    return;
  }
  const span = `${fmtDate(r.this_week.from, { month: 'short', day: 'numeric' })} – ${fmtDate(r.this_week.to, { month: 'short', day: 'numeric' })}`;
  el.innerHTML = `
    <div class="review-head">
      <div><p class="eyebrow">Review · ${esc(span)}</p><h2>This week</h2></div>
      <span class="review-logged">${r.days_logged.this_week}/7 days logged</span>
    </div>
    ${r.highlights.length
      ? `<ul class="review-highlights">${r.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
      : '<p class="review-thin review-empty">Nothing logged this week yet.</p>'}
    <div class="review-tiles">${tiles(r)}</div>
    ${painList(r.stomach)}
    ${safeFoods(r.stomach)}
    <p class="review-note">Only counts what was logged. Days with no entries are left out, not treated as zero.</p>`;
}
