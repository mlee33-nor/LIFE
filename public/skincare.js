// Skincare routine card (Acne tab): AM wash, PM wash and sunscreen per day
// from the /api/daily records MOTION writes, shown even when no face photos
// exist. day.habits = { am_skincare: { count }, ... }; day.missed_habits lists
// the ones explicitly reported as skipped. Nothing is inferred beyond that.

import { esc, plural, isNum, phoenixToday, shiftIso, isoLabel } from './util.js';

const ROWS = [
  { key: 'am', label: 'AM wash', short: 'AM', habits: ['am_skincare', 'wash_face'], missed: ['am_skincare', 'wash_face'] },
  { key: 'pm', label: 'PM wash', short: 'PM', habits: ['pm_skincare'], missed: ['pm_skincare'] },
  { key: 'spf', label: 'Sunscreen', short: 'SPF', habits: ['sunscreen'], missed: ['sunscreen'] },
];
const MAX_COLUMNS = 30;

// 'done' | 'skipped' | null (not logged)
function status(day, row) {
  if (!day) return null;
  if (row.habits.some((h) => Number(day.habits?.[h]?.count) > 0)) return 'done';
  if ((day.missed_habits ?? []).some((h) => row.missed.includes(String(h).toLowerCase()))) return 'skipped';
  return null;
}

// Consecutive days done, ending today (or yesterday while today has nothing yet).
function streak(byDate, row, today) {
  let date = status(byDate.get(today), row) ? today : shiftIso(today, -1);
  let count = 0;
  while (status(byDate.get(date), row) === 'done') { count += 1; date = shiftIso(date, -1); }
  return count;
}

const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function renderSkincare({ days = [], rangeDays = 14 } = {}) {
  const el = document.getElementById('skincare-card');
  if (!el) return;
  const today = phoenixToday();
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days.length ? days.reduce((m, d) => (d.date < m ? d.date : m), days[0].date) : today;
  const span = Math.min(rangeDays ?? MAX_COLUMNS, MAX_COLUMNS);
  let start = shiftIso(today, -(span - 1));
  if (start < first) start = first; // never pre-history
  const dates = [];
  for (let d = start; d <= today; d = shiftIso(d, 1)) dates.push(d);
  const scope = rangeDays ? `Last ${plural(rangeDays, 'day')}` : 'All time';
  const head = (extra = '') => `<div class="extra-head"><div><p class="eyebrow">Skin · ${esc(scope)}${rangeDays && rangeDays > MAX_COLUMNS ? ` (latest ${MAX_COLUMNS})` : ''}</p><h2>Skincare routine</h2></div>${extra}</div>`;

  const anyLogged = days.some((d) => ROWS.some((r) => status(d, r)));
  if (!anyLogged) {
    el.innerHTML = `${head()}<div class="extra-empty"><span aria-hidden="true">✿</span><div><strong>No face washes logged yet</strong><p>Tell MOTION “AM face wash done” / “PM routine done” and it shows here.</p></div></div>`;
    return;
  }

  const n = dates.length;
  const stats = ROWS.map((row) => {
    const done = dates.filter((d) => status(byDate.get(d), row) === 'done').length;
    return { row, done, streak: streak(byDate, row, today) };
  });
  const shownRows = ROWS.filter((row) => row.key !== 'spf' || days.some((d) => status(d, row)));

  // Spots after a PM wash vs not: only with >= 5 counted days, never guessed.
  let spotsLine = '';
  const counted = days.filter((d) => isNum(d.acne_spots));
  if (counted.length >= 5) {
    const after = [], without = [];
    for (const d of counted) {
      const prev = status(byDate.get(shiftIso(d.date, -1)), ROWS[1]);
      if (prev === 'done') after.push(Number(d.acne_spots));
      else if (prev === 'skipped' || byDate.has(shiftIso(d.date, -1))) without.push(Number(d.acne_spots));
    }
    if (after.length >= 2 && without.length >= 2) {
      spotsLine = `<p class="extra-thin">Spots the morning after a PM wash: avg <b>${mean(after).toFixed(1)}</b> (${plural(after.length, 'day')}) vs <b>${mean(without).toFixed(1)}</b> without (${plural(without.length, 'day')}). An observation from your logs, not a medical conclusion.</p>`;
    }
  }

  const stateText = { done: 'done', skipped: 'skipped (reported)', null: 'not logged' };
  const grid = `<div class="skin-grid-wrap"><table class="skin-grid" style="--cols:${n}">
    <caption class="sr-only">Skincare routine by day, ${esc(isoLabel(dates[0]))} to ${esc(isoLabel(dates.at(-1)))}</caption>
    <thead><tr><th scope="col"><span class="sr-only">Routine</span></th>${dates.map((d) => `<th scope="col" class="${d === today ? 'is-today' : ''}"><span aria-hidden="true">${esc(isoLabel(d, { weekday: 'narrow' }))}<br>${Number(d.slice(8))}</span><span class="sr-only">${esc(isoLabel(d, { weekday: 'short', month: 'short', day: 'numeric' }))}</span></th>`).join('')}</tr></thead>
    <tbody>${shownRows.map((row) => `<tr><th scope="row">${row.label}</th>${dates.map((d) => {
      const st = status(byDate.get(d), row);
      const label = `${isoLabel(d)} ${row.label}: ${stateText[st]}`;
      return `<td class="${d === today ? 'is-today' : ''}"><span class="skin-cell ${st ?? 'none'}" role="img" aria-label="${esc(label)}" title="${esc(label)}">${st === 'done' ? '✓' : st === 'skipped' ? '✗' : ''}</span></td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>`;

  el.innerHTML = `${head(`<span class="extra-chip">${plural(n, 'day')}</span>`)}
    <div class="skin-stats">${stats.filter((s) => shownRows.includes(s.row)).map((s) => `<div><span>${s.row.label}</span><strong>${s.done}<small>/${n} days</small></strong><small>${s.streak ? `🔥 ${plural(s.streak, 'day')} streak` : 'no streak running'}</small></div>`).join('')}</div>
    ${grid}
    <p class="skin-legend" aria-hidden="true"><span><i class="skin-cell done">✓</i>done</span><span><i class="skin-cell skipped">✗</i>reported skipped</span><span><i class="skin-cell none"></i>not logged</span></p>
    ${spotsLine}`;
}
