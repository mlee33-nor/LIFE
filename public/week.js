// One selected day for the whole Life tab. The week strip at the top of the
// tab is the only date control: the timeline, recap, to-dos, goals and the
// Heads-up card all follow it. Changes are announced with a 'life-date'
// event (detail = YYYY-MM-DD). Never past today (America/Phoenix).

import { esc, plural, phoenixToday, shiftIso, isoLabel, durationLabel } from './util.js';

const state = { date: null, days: [], rest: new Set(), refocus: false };

export const getSelectedDay = () => state.date || phoenixToday();

export function setSelectedDay(iso, { refocus = false } = {}) {
  const today = phoenixToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return;
  const next = iso > today ? today : iso;
  state.refocus = refocus;
  if (next === getSelectedDay()) { render(); return; }
  state.date = next;
  render();
  document.dispatchEvent(new CustomEvent('life-date', { detail: next }));
}

// app.js passes every loaded day on each render.
export function renderWeekStrip(days = []) { state.days = days; render(); }
// Rest days (MOTION's recovery shield) from /api/streaks, on top of day.shield.
export function setRestDays(dates = []) { state.rest = new Set(dates); render(); }

// Monday of the week that contains `iso`.
const weekStart = (iso) => shiftIso(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
// Study fill: fixed minute bands so weeks compare with each other.
const LEVELS = [[150, 4], [90, 3], [30, 2], [1, 1]];
const levelFor = (minutes) => (LEVELS.find(([min]) => minutes >= min) ?? [0, 0])[1];
const painEpisode = (d) => (d?.pain_reports ?? []).some((r) => r && (r.pain === null || r.pain === undefined || Number(r.pain) > 0)) || Number(d?.stomach_pain) > 0;

function render() {
  const el = document.getElementById('week-strip');
  if (!el) return;
  const today = phoenixToday();
  const selected = getSelectedDay();
  const start = weekStart(selected);
  const week = Array.from({ length: 7 }, (_, i) => shiftIso(start, i));
  const byDate = new Map(state.days.map((d) => [d.date, d]));
  const earliest = state.days.length ? state.days.reduce((min, d) => (d.date < min ? d.date : min), state.days[0].date) : today;
  const canBack = start > earliest;
  const canForward = week[6] < today;
  const long = (iso) => isoLabel(iso, { weekday: 'long', month: 'long', day: 'numeric' });

  const cells = week.map((iso) => {
    const d = byDate.get(iso);
    const future = iso > today;
    const minutes = Number(d?.hmwk_minutes) || 0;
    const pain = painEpisode(d);
    const mb = Number(d?.mb) > 0;
    const rest = Boolean(d?.shield) || state.rest.has(iso);
    const on = iso === selected;
    const facts = [
      iso === today ? 'today' : '',
      future ? 'not yet' : minutes ? `${durationLabel(minutes)} homework` : d ? 'no homework logged' : 'nothing logged',
      pain ? 'stomach pain reported' : '',
      mb ? `MB${Number(d.mb) > 1 ? ` ×${Number(d.mb)}` : ''}` : '',
      rest ? 'rest day, doesn’t break your streaks' : '',
    ].filter(Boolean).join(', ');
    return `<button type="button" role="radio" class="week-day level-${future ? 0 : levelFor(minutes)}${iso === today ? ' is-today' : ''}${on ? ' is-selected' : ''}${future ? ' is-future' : ''}" data-date="${iso}" aria-checked="${on}" tabindex="${on ? 0 : -1}" ${future ? 'disabled' : ''} aria-label="${esc(`${long(iso)}: ${facts}`)}">
      <span class="wk-letter" aria-hidden="true">${esc(isoLabel(iso, { weekday: 'narrow' }))}</span>
      <span class="wk-circle" aria-hidden="true">${Number(iso.slice(8))}</span>
      <span class="wk-marks" aria-hidden="true">${pain ? '<i class="wk-pain" title="Stomach pain"></i>' : ''}${mb ? '<i class="wk-mb" title="MB"></i>' : ''}${rest ? '<i class="wk-rest" title="Rest day — doesn’t break your streaks">🛌</i>' : ''}</span>
    </button>`;
  }).join('');

  el.innerHTML = `
    <div class="week-head">
      <button type="button" class="week-shift" data-week="-7" aria-label="Previous week" ${canBack ? '' : 'disabled'}>‹</button>
      <p class="week-range"><strong>${esc(isoLabel(week[0]))} – ${esc(isoLabel(week[6]))}</strong><span>${selected === today ? 'Today' : esc(isoLabel(selected, { weekday: 'long', month: 'short', day: 'numeric' }))}</span></p>
      <button type="button" class="week-shift" data-week="7" aria-label="Next week" ${canForward ? '' : 'disabled'}>›</button>
      ${selected !== today ? '<button type="button" class="week-today">Back to today</button>' : ''}
    </div>
    <div class="week-days" role="radiogroup" aria-label="Day shown on the Life tab">${cells}</div>
    <p class="week-legend" aria-hidden="true"><span class="wk-scale"><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i></span>more study <span><i class="wk-pain"></i>stomach pain</span><span><i class="wk-mb"></i>MB</span><span>🛌 rest day</span></p>`;

  el.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => setSelectedDay(shiftIso(selected, Number(b.dataset.week)))));
  el.querySelector('.week-today')?.addEventListener('click', () => setSelectedDay(today));
  el.querySelectorAll('.week-day').forEach((b) => b.addEventListener('click', () => setSelectedDay(b.dataset.date, { refocus: true })));
  el.querySelector('.week-days').addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, PageUp: -7, PageDown: 7 }[e.key];
    const next = step ? shiftIso(selected, step) : e.key === 'Home' ? week[0] : e.key === 'End' ? (week[6] > today ? today : week[6]) : null;
    if (!next) return;
    e.preventDefault();
    setSelectedDay(next, { refocus: true });
  });
  if (state.refocus) { state.refocus = false; el.querySelector('.week-day.is-selected')?.focus(); }
}
