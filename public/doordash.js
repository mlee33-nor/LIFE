// DoorDash tab: weekly earnings, $/hour, $/mile and the shift list, from
// GET /api/doordash. A 404 (not deployed yet) or no shifts shows an empty
// state; nothing is estimated.

import { esc, plural, isNum, getOptional, isoLabel, clockMinutes, clockLabel, durationLabel } from './util.js';

const state = { data: undefined };
const $ = (id) => document.getElementById(id);
const n = (v) => (isNum(v) ? Number(v) : null);
const usd = (v, digits = 2) => (isNum(v) ? `${Number(v) < 0 ? '−' : ''}$${Math.abs(Number(v)).toFixed(digits)}` : '—');
const perHour = (money, minutes) => (isNum(money) && isNum(minutes) && minutes > 0 ? (money / minutes) * 60 : null);
const perMile = (money, miles) => (isNum(money) && isNum(miles) && miles > 0 ? money / miles : null);
const sum = (rows, key) => { const v = rows.map((r) => n(r[key])).filter((x) => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
const timeOf = (at) => { const m = clockMinutes(at); return m === null ? null : clockLabel(m); };

export async function loadDoorDash() {
  const res = await getOptional('/api/doordash');
  state.data = res.ok ? res.data : null;
  render();
}

function kpi(label, value, sub = '') {
  return `<article><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</article>`;
}

function render() {
  const el = $('doordash-dashboard');
  if (!el) return;
  if (state.data === undefined) { el.innerHTML = '<p class="extra-thin">Loading…</p>'; return; }
  const shifts = (Array.isArray(state.data?.shifts) ? state.data.shifts : []).filter(Boolean).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(b.start ?? '').localeCompare(String(a.start ?? '')));
  const weeks = (Array.isArray(state.data?.weeks) ? state.data.weeks : []).filter((w) => w?.week_start).sort((a, b) => a.week_start.localeCompare(b.week_start));
  if (!state.data || (!shifts.length && !weeks.length)) {
    el.innerHTML = `<div class="card extra-card dash-empty"><div class="extra-empty"><span aria-hidden="true">$</span><div><strong>${state.data ? 'No DoorDash shifts logged yet' : 'DoorDash earnings aren’t available yet'}</strong><p>Tell MOTION when you finish a dash with your pay and miles (e.g. “dashed 2h, $38, 24 miles”) and your weekly earnings, $/hour and $/mile appear here.</p></div></div></div>`;
    return;
  }
  const t = state.data.totals || {};
  const pay = n(t.pay) ?? sum(shifts, 'pay');
  const net = n(t.net_profit) ?? sum(shifts, 'net_profit');
  const minutes = n(t.minutes) ?? sum(shifts, 'minutes');
  const miles = n(t.miles) ?? sum(shifts, 'miles');
  const gas = n(t.gas_cost) ?? sum(shifts, 'gas_cost');
  const netHour = n(t.net_per_hour) ?? perHour(net, minutes);
  const payHour = n(t.per_hour) ?? perHour(pay, minutes);
  const netMile = n(t.net_per_mile) ?? perMile(net, miles);
  const shiftCount = n(t.shifts) ?? shifts.length;

  const shownWeeks = weeks.slice(-8);
  const maxPay = Math.max(1, ...shownWeeks.map((w) => Math.max(n(w.pay) ?? 0, n(w.net_profit) ?? 0)));
  const weekChart = shownWeeks.length ? `<article class="card extra-card dash-weeks"><div class="extra-head"><div><p class="eyebrow">By week</p><h2>Weekly earnings</h2></div><div class="dash-legend" aria-hidden="true"><span><i class="pay"></i>Pay</span><span><i class="net"></i>Net profit</span></div></div>
    <div class="dash-bars" role="img" aria-label="Weekly pay and net profit">${shownWeeks.map((w) => {
      const p = n(w.pay), np = n(w.net_profit);
      const wh = n(w.net_per_hour) ?? perHour(np, n(w.minutes));
      return `<div class="dash-week"><div class="dash-week-bars"><i class="pay" style="height:${p !== null ? Math.max(2, (p / maxPay) * 100) : 0}%" title="Pay ${usd(p)}"></i><i class="net" style="height:${np !== null ? Math.max(2, (Math.max(0, np) / maxPay) * 100) : 0}%" title="Net ${usd(np)}"></i></div><strong>${usd(p, 0)}</strong><small>${np !== null ? `net ${usd(np, 0)}` : 'net —'}</small><small>${wh !== null ? `${usd(wh)}/h` : '—/h'}</small><span>${esc(isoLabel(w.week_start))}</span></div>`;
    }).join('')}</div><p class="extra-thin">Weeks start on Monday. Net profit is pay minus gas and costs MOTION logged.</p></article>` : '';

  const rows = shifts.map((s) => {
    const start = timeOf(s.start), end = timeOf(s.end);
    const mins = n(s.minutes), p = n(s.pay), np = n(s.net_profit), mi = n(s.miles);
    const nh = n(s.net_per_hour) ?? perHour(np, mins), nm = n(s.net_per_mile) ?? perMile(np, mi);
    return `<article class="dash-row"><span><strong>${esc(isoLabel(s.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong><small>${start ? `${start}${end ? ` – ${end}` : ''}` : 'time not logged'}${mins !== null ? ` · ${durationLabel(mins)}` : ''}</small></span><span><b>${usd(p)}</b><small>pay${isNum(s.offers) ? ` · ${plural(Number(s.offers), 'offer')}` : ''}</small></span><span><b>${usd(np)}</b><small>net${isNum(s.gas_cost) ? ` · gas ${usd(s.gas_cost)}` : ''}</small></span><span><b>${nh !== null ? `${usd(nh)}/h` : '—'}</b><small>${mi !== null ? `${mi} mi` : 'miles —'}${nm !== null ? ` · ${usd(nm)}/mi` : ''}</small></span>${s.note ? `<p class="dash-note">${esc(s.note)}</p>` : ''}</article>`;
  }).join('');

  el.innerHTML = `
    <section class="dash-kpis">
      ${kpi('Total pay', usd(pay), `${plural(shiftCount, 'shift')}`)}
      ${kpi('Net profit', usd(net), gas !== null ? `after ${usd(gas)} gas` : 'after logged costs')}
      ${kpi('Net per hour', netHour !== null ? usd(netHour) : '—', payHour !== null ? `${usd(payHour)}/h before costs` : minutes !== null ? `${durationLabel(minutes)} dashing` : 'time not logged')}
      ${kpi('Net per mile', netMile !== null ? usd(netMile) : '—', miles !== null ? `${Math.round(miles)} miles` : 'miles not logged')}
    </section>
    ${weekChart}
    <article class="card extra-card dash-shifts"><div class="extra-head"><div><p class="eyebrow">Every dash</p><h2>Shifts</h2></div><span class="extra-chip">${plural(shifts.length, 'shift')}</span></div>
      ${rows ? `<div class="dash-table"><div class="dash-row dash-header" aria-hidden="true"><span>Shift</span><span>Pay</span><span>Net</span><span>Per hour / mile</span></div>${rows}</div>` : '<p class="extra-thin">No individual shifts logged, only weekly totals.</p>'}
    </article>
    <p class="extra-thin dash-foot">All logged shifts. Figures are what MOTION recorded; missing values stay blank instead of being estimated.</p>`;
}

render();
