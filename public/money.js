// Money tab, top card: income by month across RSA, eBay, Upwork and DoorDash,
// from GET /api/money. Only reported amounts; a source with nothing logged
// says so instead of showing $0.

import { esc, isNum, getOptional } from './util.js';

const COLORS = { RSA: '#2f6fe4', eBay: '#e5a000', Upwork: '#14a800', DoorDash: '#e8452c' };
const colorOf = (s) => COLORS[s] ?? '#8a6fd1';
const usd = (v) => (isNum(v) ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : '—');
const monthName = (ym, opts = { month: 'long' }) => (ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', opts) : '');

export async function loadMoney() {
  const el = document.getElementById('money-card');
  if (!el) return;
  const res = await getOptional('/api/money');
  render(el, res.ok ? res.data : null);
}

function render(el, data) {
  const head = '<div class="extra-head"><div><p class="eyebrow">All side jobs</p><h2>Income</h2></div></div>';
  if (!data) { el.innerHTML = `${head}<p class="extra-thin">Income isn’t available right now.</p>`; return; }
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const months = (Array.isArray(data.months) ? data.months : []).slice(-6);
  const max = Math.max(1, ...months.map((m) => m.total || 0));
  const tile = (s) => {
    const has = s.months_logged > 0;
    return `<article class="money-tile" style="--src:${colorOf(s.source)}">
      <span class="money-src">${esc(s.source)}</span>
      ${has ? `<strong>${usd(s.last_month)}</strong><small>${esc(monthName(data.last_month))}</small>
      <small>${isNum(s.this_month) ? `${usd(s.this_month)} so far in ${esc(monthName(data.this_month))}` : `nothing yet in ${esc(monthName(data.this_month))}`}</small>`
      : '<strong class="money-none">Not logged yet</strong><small>Text MOTION when you get paid</small>'}
    </article>`;
  };
  const bar = (m) => {
    const parts = Object.entries(m.by_source || {}).filter(([, v]) => isNum(v) && v > 0);
    const label = parts.map(([s, v]) => `${s} ${usd(v)}`).join(', ');
    return `<li><span class="money-month">${esc(monthName(m.month, { month: 'short', year: '2-digit' }))}</span>
      <span class="money-bar" role="img" aria-label="${esc(`${monthName(m.month)}: ${usd(m.total)} (${label})`)}">${parts.map(([s, v]) => `<i style="width:${(v / max) * 100}%;background:${colorOf(s)}" title="${esc(`${s}: ${usd(v)}`)}"></i>`).join('')}</span>
      <b>${usd(m.total)}</b></li>`;
  };
  const used = [...new Set(months.flatMap((m) => Object.keys(m.by_source || {})))];
  el.innerHTML = `${head}
    <div class="money-summary">
      <div><span>${esc(monthName(data.last_month))}</span><strong>${usd(data.totals?.last_month)}</strong></div>
      <div><span>${esc(monthName(data.this_month))} so far</span><strong>${usd(data.totals?.this_month)}</strong></div>
    </div>
    <div class="money-tiles">${sources.map(tile).join('')}</div>
    ${months.length ? `<h3 class="money-h3">By month</h3><ul class="money-months">${months.map(bar).join('')}</ul>
      <p class="money-legend">${used.map((s) => `<span><i style="background:${colorOf(s)}"></i>${esc(s)}</span>`).join('')}</p>` : ''}
    <p class="extra-thin">Reported amounts (eBay is profit; DoorDash is net after gas and expenses). Text MOTION things like “RSA paid $1,800 for October” or “eBay sale, $12 profit”.</p>`;
}
