// "This week": one card for the week. MOTION's weekly report text (short) on
// top, then the key numbers from GET /api/report/weekly (falling back to
// GET /api/review). "vs last week" arrows only appear when the backend says
// the weeks are comparable; missing data stays "—", never a guess.

import { phoenixToday } from './util.js';

const API_BASE = window.SOMA_API_BASE ?? '';
const API_KEY = window.SOMA_API_KEY ?? (() => { try { return localStorage.getItem('soma-api-key') ?? ''; } catch { return ''; } })();

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtDate = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
const minutes = (m) => (!isNum(m) ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`);

export async function loadReview() {
  const el = document.getElementById('review-card');
  if (!el) return;
  const fetchJson = async (path) => {
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {} });
      return res.ok ? await res.json() : null;
    } catch { return null; } // offline: empty state
  };
  // MOTION's weekly report (text + numbers) and the review, for the same 7 days ending today.
  const [report, review] = await Promise.all([fetchJson(`/api/report/weekly?end=${phoenixToday()}`), fetchJson('/api/review')]);
  render(el, report, review);
}

// Change vs last week. `fewerIsBetter` colours a drop green and a rise
// coral; otherwise the pill stays neutral (more homework isn't "good" or "bad").
function delta(value, { fewerIsBetter = false, format = (v) => `${v}` } = {}) {
  if (!isNum(value)) return '';
  const tone = !fewerIsBetter || value === 0 ? 'neutral' : value < 0 ? 'good' : 'warn';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '=';
  const text = value === 0 ? 'same' : format(Math.abs(Math.round(value * 10) / 10));
  return `<span class="review-delta ${tone}" title="vs last week"><span aria-hidden="true">${arrow}</span> ${esc(text)}<span class="sr-only"> ${value > 0 ? 'more' : value < 0 ? 'less' : ''} than last week</span></span>`;
}

// The report text, shortened: drop the "Week 9/27-10/3:" prefix and keep the
// first two sentences; the rest is one tap away.
function summary(text) {
  const body = text.replace(/^Week [^:]*:\s*/i, '').trim();
  const sentences = body.match(/[^.!?]+(?:\.\d+[^.!?]*)*[.!?]+/g) ?? [body];
  return { short: sentences.slice(0, 2).join(' ').trim(), more: sentences.length > 2 };
}

function stat(label, value, foot = '') {
  return `<div class="week-stat"><span>${esc(label)}</span><strong>${value}</strong>${foot ? `<div>${foot}</div>` : ''}</div>`;
}

function render(el, rep, r) {
  const sec = rep?.sections ?? null;
  const from = rep?.start ?? r?.this_week?.from, to = rep?.end ?? r?.this_week?.to;
  const span = from && to ? `${fmtDate(from, { month: 'short', day: 'numeric' })} – ${fmtDate(to, { month: 'short', day: 'numeric' })}` : '';
  const logged = sec?.days_logged?.this_week ?? r?.days_logged?.this_week;
  const headHtml = `<div class="review-head"><div><p class="eyebrow">Review${span ? ` · ${esc(span)}` : ''}</p><h2>This week</h2></div>${isNum(logged) ? `<span class="review-logged">${logged}/7 days logged</span>` : ''}</div>`;
  if (!sec && !r) {
    el.innerHTML = `${headHtml}<p class="review-thin review-empty">The weekly summary isn’t available right now. MOTION’s weekly report shows up here once it’s ready.</p>`;
    return;
  }
  // Deltas only when the backend says the two weeks are comparable.
  const comparable = sec ? sec.comparable === true : false;
  const text = typeof rep?.text === 'string' ? rep.text.trim() : '';
  const sum = text ? summary(text) : null;

  const study = sec?.study?.minutes ?? r?.homework?.this_week_minutes;
  const studyDelta = sec ? sec.study?.change_minutes : r?.homework?.enough_data ? r.homework.change_minutes : null;
  const goalsMet = sec?.goals?.days_met ?? r?.homework?.goals?.hit, goalsSet = sec?.goals?.days_with_goal ?? r?.homework?.goals?.set;
  const sleep = sec?.sleep?.average_hours ?? r?.sleep?.average_hours;
  const sleepDelta = sec ? sec.sleep?.change_hours : r?.sleep?.change_hours;
  const pain = sec?.pain?.episodes ?? r?.stomach?.reports;
  const painDelta = sec ? sec.pain?.change : r?.stomach?.change_reports;
  const xp = sec?.xp?.gained ?? r?.xp?.this_week;
  const xpDelta = sec ? sec.xp?.change : r?.xp?.enough_data ? r.xp.change : null;
  const useDelta = comparable || (!sec && r);
  const d = (v, opts) => (useDelta ? delta(v, opts) : '');

  const stats = [
    stat('Study', minutes(study), d(studyDelta, { format: minutes })),
    stat('Goal days met', isNum(goalsSet) && goalsSet ? `${goalsMet ?? 0}<small>/${goalsSet}</small>` : '—', isNum(goalsSet) && goalsSet ? '' : '<span class="review-thin">no goal set</span>'),
    stat('Sleep avg', isNum(sleep) ? `${sleep}<small> h</small>` : '—', d(sleepDelta, { format: (v) => `${v} h` })),
    stat('Pain episodes', isNum(pain) ? String(pain) : '—', d(painDelta, { fewerIsBetter: true })),
    stat('XP', isNum(xp) ? `+${xp.toLocaleString()}` : '—', d(xpDelta)),
  ].join('');

  el.innerHTML = `${headHtml}
    ${sum ? `<p class="week-summary">${esc(sum.short)}</p>${sum.more ? `<details class="week-report"><summary>Full weekly report</summary><blockquote class="review-report">${esc(text)}</blockquote></details>` : ''}` : '<p class="review-thin review-empty">MOTION’s weekly report shows up here once it’s available.</p>'}
    <div class="week-stats">${stats}</div>
    <p class="review-note">${useDelta ? 'Arrows compare with last week. ' : sec ? 'Not enough of last week was logged to compare. ' : ''}Only counts what was logged; days with no entries are left out, not treated as zero.</p>`;
}
