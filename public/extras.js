// Newer MOTION cards: Today's recap, Goals & streaks, Sleep, Mood (Life tab),
// Before the pain (Stomach tab), Problems to revisit (Homework tab) and Sync
// health (Data tab). Every endpoint is optional: a 404, an error or an empty
// answer shows a friendly empty state, never made-up numbers.

import { esc, plural, isNum, getOptional, phoenixToday, shiftIso, isoLabel, clockMinutes, clockLabel, durationLabel, canonicalSubject, API_BASE, API_KEY } from './util.js';
import { getLifeDate } from './life.js';

const store = { streaks: undefined, pain: undefined, issues: undefined, revisit: undefined, recap: new Map(), days: [], filtered: [], rangeDays: null, recapDate: null, painShowAll: false, revisitShowAll: false, level: null };
const $ = (id) => document.getElementById(id);
const human = (key) => String(key ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase());
const timeOf = (at) => { const m = clockMinutes(at); return m === null ? '' : clockLabel(m); };
const dateOf = (at, fallback) => (/^\d{4}-\d{2}-\d{2}/.test(String(at ?? '')) ? String(at).slice(0, 10) : fallback);
const head = (eyebrow, title, extra = '') => `<div class="extra-head"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div>${extra}</div>`;
const empty = (icon, title, copy) => `<div class="extra-empty"><span aria-hidden="true">${icon}</span><div><strong>${title}</strong><p>${copy}</p></div></div>`;
const photoHref = (url) => (/^\/api\//.test(url) ? `${API_BASE}${url}${API_KEY ? `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(API_KEY)}` : ''}` : /^https?:\/\//.test(url) ? url : null);

// ---------- loading ----------
export async function loadExtras({ days = [] } = {}) {
  store.days = days;
  const [streaks, pain, issues, revisit, nudges, countdown, caffeine] = await Promise.all([
    getOptional('/api/streaks'),
    getOptional('/api/food/pain-timeline?hours=3'),
    getOptional('/api/sync/issues'),
    getOptional('/api/revisit'),
    getOptional('/api/nudges'),
    getOptional('/api/countdown'),
    getOptional('/api/caffeine'),
  ]);
  store.nudges = nudges.ok ? nudges.data : null;
  store.countdown = countdown.ok ? countdown.data : null;
  store.caffeine = caffeine.ok ? caffeine.data : null;
  renderNudges();
  renderCaffeine();
  store.streaks = streaks.ok ? streaks.data : null;
  store.pain = pain.ok ? pain.data : null;
  store.issues = issues.ok ? issues.data : null;
  store.revisit = revisit.ok ? revisit.data : null;
  store.recap.clear();
  renderGoals();
  renderPainTimeline();
  renderSyncHealth();
  renderRevisit();
  loadRecap(getLifeDate() || phoenixToday());
}

document.addEventListener('life-date', (event) => loadRecap(event.detail));
document.addEventListener('homework-rendered', () => renderRevisit());

// Called by app.js on every render (range changes, new data).
export function renderDayCards({ days = [], filtered = [], rangeDays = null } = {}) {
  Object.assign(store, { days, filtered, rangeDays });
  renderSleep();
  renderMood();
  renderGoals();
}

// ---------- Today's recap ----------
async function loadRecap(date) {
  const el = $('recap-card');
  if (!el || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return;
  store.recapDate = date;
  if (!store.recap.has(date)) {
    el.innerHTML = renderRecapHtml(date, undefined);
    const res = await getOptional(`/api/recap?date=${date}`);
    store.recap.set(date, res.ok ? res.data : null);
  }
  if (store.recapDate === date) el.innerHTML = renderRecapHtml(date, store.recap.get(date));
}

function renderRecapHtml(date, data) {
  const isToday = date === phoenixToday();
  const title = isToday ? 'Today’s recap' : 'Day recap';
  const eyebrow = `Recap · ${esc(isoLabel(date, { weekday: 'short', month: 'short', day: 'numeric' }))}`;
  if (data === undefined) return `${head(eyebrow, title)}<p class="extra-thin">Loading…</p>`;
  const lines = Array.isArray(data?.lines) ? data.lines.filter((l) => typeof l === 'string' && l.trim()) : [];
  const text = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!text && !lines.length) return `${head(eyebrow, title)}${empty('☾', 'No recap for this day yet', 'MOTION texts a short recap each night; it shows here too.')}`;
  const body = lines.length ? `<ul class="recap-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : `<p class="recap-text">${esc(text)}</p>`;
  return `${head(eyebrow, title)}${body}<p class="extra-thin">What MOTION texts you at night. Follows the day picked in the timeline.</p>`;
}

// ---------- Level, goals & streaks ----------
// app.js passes the XP level ({ xp, level, into, span, pct }).
export function renderLevel(info) { store.level = info; renderGoals(); }

function levelStrip() {
  const l = store.level;
  if (!l) return '';
  return `<div class="level-strip"><span class="level-badge">LVL ${l.level}</span><div><div class="level-label"><strong>${l.xp.toLocaleString()} XP</strong><span>${l.into}/${l.span} to LVL ${l.level + 1}</span></div><div class="goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${l.pct}" aria-label="Progress to the next level"><span style="width:${l.pct}%"></span></div></div></div>`;
}

function goalFromDays() {
  // Fallback while /api/streaks isn't available: today's study goals as logged.
  const today = phoenixToday();
  const day = store.days.find((d) => d.date === today);
  return (day?.goals || []).filter((g) => g && isNum(g.target_minutes) && Number(g.target_minutes) > 0);
}

function goalBar({ label, done, target, met }) {
  const pct = Math.max(0, Math.min(100, Math.round((done / target) * 100)));
  return `<div class="goal-row"><div class="goal-top"><strong>${esc(label)}</strong><span>${Math.round(done)}/${Math.round(target)} min${met ? ' · <b class="chip good">met ✓</b>' : ''}</span></div><div class="goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(label)} progress"><span style="width:${pct}%"></span></div></div>`;
}

function renderGoals() {
  const el = $('goals-card');
  if (!el) return;
  const s = store.streaks;
  const today = phoenixToday();
  const shields = new Set([...(Array.isArray(s?.shields) ? s.shields : []), ...store.days.filter((d) => d.shield).map((d) => d.date)]);
  const parts = [];

  const sg = s?.study_goal;
  if (sg && isNum(sg.target_minutes) && Number(sg.target_minutes) > 0) {
    const label = `${canonicalSubject(sg.subject)}${sg.label && !String(sg.label).toLowerCase().includes(String(sg.subject).toLowerCase()) ? ` · ${sg.label}` : ''}`;
    parts.push(`<section class="goal-block"><h3>Study goal today</h3>${goalBar({ label, done: Number(sg.today_minutes) || 0, target: Number(sg.target_minutes), met: Boolean(sg.met_today) })}${isNum(sg.current) ? `<p class="extra-thin">Goal streak: <b>${plural(sg.current, 'day')}</b>${isNum(sg.best) ? ` · best ${sg.best}` : ''}</p>` : ''}</section>`);
  } else {
    const goals = goalFromDays();
    if (goals.length) parts.push(`<section class="goal-block"><h3>Study goal today</h3>${goals.map((g) => goalBar({ label: g.label || canonicalSubject(g.subject), done: Number(g.done_minutes) || 0, target: Number(g.target_minutes), met: Number(g.done_minutes) >= Number(g.target_minutes) })).join('')}</section>`);
  }

  parts.push(countdownBlock());

  const allHabits = (Array.isArray(s?.habits) ? s.habits : []).filter((h) => h?.habit);
  const live = allHabits.filter((h) => Number(h.current) > 0).slice(0, 5);
  const lapsed = allHabits.filter((h) => !(Number(h.current) > 0) && Number(h.best) > 1);
  if (live.length || lapsed.length) {
    parts.push(`<section class="goal-block"><h3>Habit streaks</h3>${live.length ? `<ul class="streak-list">${live.map((h) => `<li class="${h.done_today ? 'done' : ''}"><span class="streak-name">${esc(human(h.habit))}${h.done_today ? ' <small>✓ today</small>' : ''}</span><span class="streak-flame" aria-label="${plural(Number(h.current), 'day')} current streak"><span aria-hidden="true">🔥</span>${Number(h.current)}</span><span class="streak-best">best ${Number(h.best) || 0}</span></li>`).join('')}</ul>` : '<p class="extra-thin">No streak running right now.</p>'}${lapsed.length ? `<p class="extra-thin">Restart: ${lapsed.slice(0, 5).map((h) => `${esc(human(h.habit))} (best ${Number(h.best)})`).join(', ')}</p>` : ''}</section>`);
  }

  if (s || shields.size) {
    const strip = Array.from({ length: 14 }, (_, i) => shiftIso(today, i - 13));
    if (shields.size) parts.push(`<section class="goal-block"><h3>Shield days <span class="extra-thin">(don’t break streaks)</span></h3><ol class="shield-strip" aria-label="Last 14 days">${strip.map((d) => `<li class="${shields.has(d) ? 'on' : ''}" title="${esc(isoLabel(d, { weekday: 'short', month: 'short', day: 'numeric' }))}${shields.has(d) ? ': shield day' : ''}"><span aria-hidden="true">${shields.has(d) ? '🛡' : ''}</span><small>${Number(d.slice(8))}</small><span class="sr-only">${esc(isoLabel(d, { month: 'short', day: 'numeric' }))}${shields.has(d) ? ', shield day' : ''}</span></li>`).join('')}</ol></section>`);
  }

  el.innerHTML = `${head('Today', 'Level, goals &amp; streaks')}${levelStrip()}${parts.filter(Boolean).length ? parts.filter(Boolean).join('') : empty('🔥', 'No goals or streaks yet', s === null ? 'Streaks show up here once MOTION starts tracking them. Set a study goal by texting MOTION something like “goal: 120 min of math today”.' : 'Set a study goal or log a habit two days in a row to start a streak.')}`;
}

// ---------- Sleep ----------
const WINDOW_START = 18 * 60; // the chart runs 6 PM -> 2 PM next day
const WINDOW = 20 * 60;
const toWindow = (m) => (m >= WINDOW_START ? m - WINDOW_START : m + (1440 - WINDOW_START));

function sleepNight(d) {
  const hours = isNum(d.sleep_hours) ? Number(d.sleep_hours) : null;
  let bed = clockMinutes(d.bedtime), wake = clockMinutes(d.wake_time), calculated = false;
  const bedLogged = bed !== null, wakeLogged = wake !== null;
  if (bed === null && wake !== null && hours) { bed = ((wake - hours * 60) % 1440 + 1440) % 1440; calculated = true; }
  if (wake === null && bed !== null && hours) { wake = (bed + hours * 60) % 1440; calculated = true; }
  return { date: d.date, hours, bed, wake, calculated, bedLogged, wakeLogged };
}

function renderSleep() {
  const el = $('sleep-card');
  if (!el) return;
  const nights = [...store.filtered].sort((a, b) => a.date.localeCompare(b.date)).filter((d) => isNum(d.sleep_hours) || d.bedtime || d.wake_time).map(sleepNight);
  const scope = store.rangeDays ? `Last ${plural(store.rangeDays, 'day')}` : 'All time';
  if (!nights.length) {
    el.innerHTML = `${head(`Sleep · ${scope}`, 'Bedtime &amp; wake-up')}${empty('☾', 'No sleep logged in this range', 'Tell MOTION when you go to bed and when you wake up, and each night shows here.')}`;
    return;
  }
  const withHours = nights.filter((n) => n.hours !== null);
  const avgHours = withHours.length ? withHours.reduce((s, n) => s + n.hours, 0) / withHours.length : null;
  // Averages use logged times only (never the calculated ones).
  const avgClock = (key) => { const v = nights.filter((n) => n[`${key}Logged`]); return v.length ? (Math.round(v.reduce((s, n) => s + toWindow(n[key]), 0) / v.length) + WINDOW_START) % 1440 : null; };
  const avgBed = avgClock('bed'), avgWake = avgClock('wake');
  const shown = nights.slice(-14);
  const ticks = [[0, '6p'], [240, '10p'], [480, '2a'], [720, '6a'], [960, '10a'], [1200, '2p']];
  el.innerHTML = `${head(`Sleep · ${scope}`, 'Bedtime &amp; wake-up', `<span class="extra-chip">${plural(nights.length, 'night')}</span>`)}
    <div class="sleep-stats"><div><span>Avg sleep</span><strong>${avgHours === null ? '—' : `${avgHours.toFixed(1)}h`}</strong></div><div><span>Avg bedtime</span><strong>${clockLabel(avgBed)}</strong></div><div><span>Avg wake-up</span><strong>${clockLabel(avgWake)}</strong></div></div>
    <div class="sleep-chart" role="img" aria-label="Sleep window per night, ${esc(isoLabel(shown[0].date))} to ${esc(isoLabel(shown.at(-1).date))}">
      <div class="sleep-axis" aria-hidden="true"><span></span><div>${ticks.map(([m, l]) => `<span style="left:${(m / WINDOW) * 100}%">${l}</span>`).join('')}</div><span></span></div>
      ${shown.map((n) => {
        let bar = '';
        if (n.bed !== null && n.wake !== null) {
          const a = toWindow(n.bed), b = toWindow(n.wake);
          if (b > a) bar = `<i class="${n.calculated ? 'calc' : ''}" style="left:${(a / WINDOW) * 100}%;width:${((b - a) / WINDOW) * 100}%" title="${clockLabel(n.bed)} → ${clockLabel(n.wake)}${n.calculated ? ' (one time calculated from hours slept)' : ''}"></i>`;
        }
        return `<div class="sleep-row"><span class="sleep-date">${esc(isoLabel(n.date, { weekday: 'short', day: 'numeric' }))}</span><div class="sleep-track">${bar || '<em>times not logged</em>'}</div><b>${n.hours !== null ? `${Math.round(n.hours * 10) / 10}h` : '—'}</b></div>`;
      }).join('')}
    </div>
    <p class="extra-thin">Each row is the night before that morning; dashed = one time calculated from hours slept.${nights.length > shown.length ? ` Latest ${shown.length} nights.` : ''}</p>`;
}

// ---------- Mood ----------
function renderMood() {
  const el = $('mood-card');
  if (!el) return;
  const checkins = store.filtered.flatMap((d) => (d.moods || []).filter(Boolean).map((m) => ({ ...m, date: dateOf(m.at, d.date), feelings: (Array.isArray(m.feelings) ? m.feelings : m.feelings ? [m.feelings] : []).map((f) => String(f).trim()).filter(Boolean) })))
    .sort((a, b) => String(b.at ?? b.date).localeCompare(String(a.at ?? a.date)));
  const scope = store.rangeDays ? `Last ${plural(store.rangeDays, 'day')}` : 'All time';
  if (!checkins.length) {
    el.innerHTML = `${head(`Mood · ${scope}`, 'How you’ve been feeling')}${empty('☺', 'No mood check-ins in this range', 'Tell MOTION how you feel (e.g. “feeling anxious and tired, 6/10, exams”) and it shows here.')}`;
    return;
  }
  const counts = new Map();
  for (const c of checkins) for (const f of new Set(c.feelings.map((x) => x.toLowerCase()))) counts.set(f, (counts.get(f) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  el.innerHTML = `${head(`Mood · ${scope}`, 'How you’ve been feeling', `<span class="extra-chip">${plural(checkins.length, 'check-in')}</span>`)}
    ${top.length ? `<div class="mood-top"><h3>Top feelings</h3><ul class="mood-chips">${top.map(([f, n]) => `<li>${esc(human(f))}<span>×${n}</span></li>`).join('')}</ul></div>` : ''}
    <ul class="mood-list">${checkins.slice(0, 5).map((c) => `<li><div class="mood-when"><strong>${esc(isoLabel(c.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong><span>${esc(timeOf(c.at))}</span></div><div class="mood-body"><p>${c.feelings.length ? esc(c.feelings.map(human).join(', ')) : 'Check-in'}${isNum(c.severity) ? ` <b class="chip">intensity ${Number(c.severity)}</b>` : ''}</p>${c.cause ? `<small>Because: ${esc(c.cause)}</small>` : ''}${c.notes ? `<small>${esc(c.notes)}</small>` : ''}</div></li>`).join('')}</ul>`;
}

// ---------- Before the pain (Stomach tab) ----------
function renderPainTimeline() {
  const el = $('pain-timeline-card');
  if (!el) return;
  const data = store.pain;
  const hours = isNum(data?.hours) ? Number(data.hours) : 3;
  const title = head(`Stomach · ${plural(hours, 'hour')} before`, 'Before the pain');
  if (data === undefined) { el.innerHTML = `${title}<p class="extra-thin">Loading…</p>`; return; }
  if (!data) { el.innerHTML = `${title}${empty('◉', 'Not available yet', `Each pain report will show what you ate in the ${plural(hours, 'hour')} before it, once MOTION’s pain timeline is live.`)}`; return; }
  const episodes = (Array.isArray(data.episodes) ? data.episodes : []).filter(Boolean).sort((a, b) => String(b.at ?? b.date ?? '').localeCompare(String(a.at ?? a.date ?? '')));
  if (!episodes.length) { el.innerHTML = `${title}${empty('✓', 'No pain reports logged', 'When you tell MOTION your stomach hurts, this shows what you ate in the hours before.')}`; return; }
  const shown = store.painShowAll ? episodes : episodes.slice(0, 6);
  const suspects = (Array.isArray(data.suspects) ? data.suspects : []).filter((s) => s?.food && Number(s.episodes) > 0).slice(0, 6);
  el.innerHTML = `${title}
    <div class="pain-layout">
      <ol class="pain-timeline">${shown.map((ep) => {
        const date = ep.date || dateOf(ep.at, '');
        const foods = (Array.isArray(ep.foods_before) ? ep.foods_before : []).filter((f) => f?.label);
        return `<li><div class="pain-when"><strong>${esc(isoLabel(date, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong><span>${esc(timeOf(ep.at) || 'time not logged')}</span></div><div class="pain-body"><p>${isNum(ep.pain) ? `<b class="chip warn">pain ${Number(ep.pain)}/10</b>` : '<b class="chip">pain (no score)</b>'}${ep.text ? ` <q>${esc(ep.text)}</q>` : ''}</p>${foods.length ? `<ul class="pain-foods">${foods.map((f) => `<li><span>${esc(human(f.label))}</span><small>${isNum(f.minutes_before) ? (Number(f.minutes_before) <= 0 ? 'logged with it' : `${durationLabel(f.minutes_before)} before`) : 'same day, untimed'}</small></li>`).join('')}</ul>` : `<p class="extra-thin">Nothing logged in the ${plural(hours, 'hour')} before.</p>`}</div></li>`;
      }).join('')}</ol>
      <aside class="pain-suspects"><h3>Eaten before pain most often</h3>${suspects.length ? `<ul>${suspects.map((s) => { const rate = isNum(s.rate) ? Math.round(Number(s.rate) * (Number(s.rate) <= 1 ? 100 : 1)) : null; return `<li><div><strong>${esc(human(s.food))}</strong><span>before ${plural(Number(s.episodes), 'episode')} · eaten ${Number(s.eaten) || 0}×${rate !== null ? ` · ${rate}% followed by pain` : ''}</span></div>${rate !== null ? `<i style="--rate:${Math.min(100, rate)}%" aria-hidden="true"></i>` : ''}</li>`; }).join('')}</ul>` : '<p class="extra-thin">No food has come before a pain report yet.</p>'}<p class="extra-thin">Associations in your own logs, not medical conclusions.</p></aside>
    </div>
    ${episodes.length > 6 ? `<button type="button" class="text-button" id="pain-more">${store.painShowAll ? 'Show fewer' : `Show all ${episodes.length} episodes`}</button>` : ''}`;
  $('pain-more')?.addEventListener('click', () => { store.painShowAll = !store.painShowAll; renderPainTimeline(); });
}

// ---------- Problems to revisit (Homework tab) ----------
const STATUS_RANK = { open: 0, revisited: 1, solved: 2, mastered: 3 };
export function renderRevisit() {
  const el = $('hw-revisit-slot');
  if (!el) return;
  const data = store.revisit;
  const titleHtml = (extra = '') => `<div class="extra-head"><div><p class="eyebrow">Math revisitor</p><h2>Problems to revisit</h2></div>${extra}</div>`;
  if (data === undefined) { el.innerHTML = `<article class="hw-card revisit-card">${titleHtml()}<p class="extra-thin">Loading…</p></article>`; return; }
  const problems = (Array.isArray(data?.problems) ? data.problems : []).filter(Boolean)
    .map((p) => ({ ...p, status: String(p.status || 'open').toLowerCase() }))
    .sort((a, b) => (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1) || String(b.date ?? '').localeCompare(String(a.date ?? '')));
  if (!problems.length) {
    el.innerHTML = `<article class="hw-card revisit-card">${titleHtml()}${empty('✎', data ? 'Nothing to revisit' : 'No saved problems yet', 'When you tell MOTION a problem stumped you, it’s saved here so you can come back to it.')}</article>`;
    return;
  }
  const open = problems.filter((p) => p.status === 'open').length;
  const done = problems.filter((p) => p.status === 'mastered' || p.status === 'solved');
  const active = problems.filter((p) => !(p.status === 'mastered' || p.status === 'solved'));
  const item = (p) => {
    const href = p.photo_url ? photoHref(String(p.photo_url)) : null;
    return `<li class="revisit-item status-${esc(p.status)}"><div class="revisit-top"><span class="chip status">${esc(p.status)}</span>${p.topic ? `<strong>${esc(p.topic)}</strong>` : ''}<small>${esc(isoLabel(p.date))}</small></div>${p.problem ? `<p>${esc(p.problem)}</p>` : ''}${p.where_stuck ? `<p class="revisit-stuck"><b>Stuck at:</b> ${esc(p.where_stuck)}</p>` : ''}<div class="revisit-meta">${p.revisited_at ? `<span>Revisited ${esc(isoLabel(p.revisited_at))}</span>` : ''}${p.mastered_at ? `<span>Mastered ${esc(isoLabel(p.mastered_at))}</span>` : ''}${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">View photo</a>` : ''}</div></li>`;
  };
  el.innerHTML = `<article class="hw-card revisit-card">${titleHtml(`<span class="extra-chip ${open ? 'warn' : ''}">${plural(open, 'open problem')}</span>`)}
    ${active.length ? `<ul class="revisit-list">${(store.revisitShowAll ? active : active.slice(0, 3)).map(item).join('')}</ul>${active.length > 3 ? `<button type="button" class="text-button" id="revisit-more">${store.revisitShowAll ? 'Show fewer' : `Show all ${active.length} to revisit`}</button>` : ''}` : '<p class="extra-thin">Everything saved has been mastered. Nice.</p>'}
    ${done.length ? `<details class="revisit-done"><summary>${plural(done.length, 'mastered problem')}</summary><ul class="revisit-list">${done.map(item).join('')}</ul></details>` : ''}
  </article>`;
  $('revisit-more')?.addEventListener('click', () => { store.revisitShowAll = !store.revisitShowAll; renderRevisit(); });
}

// ---------- Sync health (Data tab) ----------
function renderSyncHealth() {
  const el = $('sync-health-card');
  if (!el) return;
  const d = store.issues;
  const title = (extra = '') => head('Sheet sync', 'Sync health', extra);
  if (d === undefined) { el.innerHTML = `${title()}<p class="extra-thin">Loading…</p>`; return; }
  if (!d) { el.innerHTML = `${title()}${empty('↻', 'Sync check not available yet', 'Rows MOTION wrote that the dashboard couldn’t read will be listed here once the check is live.')}`; return; }
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const skipped = list(d.skipped), dupes = list(d.duplicates), unclosed = list(d.unclosed_sessions), photos = list(d.photo_errors);
  const checked = d.checked_at ? `<span class="extra-chip">Checked ${esc(isoLabel(d.checked_at, { month: 'short', day: 'numeric' }))} ${esc(timeOf(d.checked_at))}</span>` : '';
  const total = skipped.length + dupes.length + unclosed.length + photos.length + (d.last_error ? 1 : 0);
  if (!total) { el.innerHTML = `${title(checked)}${empty('✓', 'Every row was read', 'Nothing MOTION wrote was skipped, duplicated or left open.')}`; return; }
  const rowId = (r) => (r.row_id !== undefined && r.row_id !== null ? `Row ${esc(r.row_id)}` : 'Row ?');
  const section = (label, items, fmt) => (items.length ? `<section class="sync-block"><h3>${label} <span class="extra-chip warn">${items.length}</span></h3><ul>${items.slice(0, 20).map((r) => `<li>${fmt(typeof r === 'object' ? r : { reason: String(r) })}</li>`).join('')}</ul>${items.length > 20 ? `<p class="extra-thin">…and ${items.length - 20} more.</p>` : ''}</section>` : '');
  el.innerHTML = `${title(checked)}
    ${d.last_error ? `<p class="sync-error"><b>Last sync error:</b> ${esc(d.last_error)}</p>` : ''}
    ${section('Rows that couldn’t be read', skipped, (r) => `<strong>${rowId(r)}</strong>${r.tab ? ` <span class="extra-thin">· ${esc(r.tab)} tab</span>` : ''}<small>${esc(r.reason || 'Unreadable row')}</small>`)}
    ${section('Possible duplicates', dupes, (r) => `<strong>${Array.isArray(r.row_ids) ? `Rows ${r.row_ids.map(esc).join(', ')}` : rowId(r)}</strong><small>${esc(r.reason || r.text || 'Looks like the same entry twice')}</small>`)}
    ${section('Sessions started but never ended', unclosed, (r) => `<strong>${esc(r.subject ? canonicalSubject(r.subject) : human(r.activity || 'Session'))}</strong> <span class="extra-thin">· ${rowId(r)}</span><small>Started ${r.started_at ? `${esc(isoLabel(r.started_at))} ${esc(timeOf(r.started_at))}` : 'at an unknown time'}</small>`)}
    ${section('Photos that failed to load', photos, (r) => `<strong>${rowId(r)}</strong><small>${esc(r.reason || r.error || 'Photo download failed')}</small>`)}
    <p class="extra-thin">MOTION can fix these rows in the sheet; they disappear here after the next sync.</p>`;
}

// First paint: loading states until loadExtras() answers.
renderPainTimeline();
renderSyncHealth();

// ---------- Heads up (nudges) ----------
// Only shown when something is off track right now; hidden otherwise.
function renderNudges() {
  const el = $('nudges-card');
  if (!el) return;
  const list = (Array.isArray(store.nudges?.nudges) ? store.nudges.nudges : []).filter((n) => n?.text && n.for !== 'motion');
  el.hidden = !list.length;
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `${head('Right now', 'Heads up')}<ul class="nudge-list">${list.map((n) => `<li class="${n.level === 'warn' ? 'warn' : ''}"><span aria-hidden="true">${n.level === 'warn' ? '!' : '•'}</span>${esc(n.text)}</li>`).join('')}</ul>`;
}

// ---------- Exam countdown (inside Goals & streaks) ----------
function countdownBlock() {
  const c = store.countdown;
  if (c === undefined) return '';
  const exams = (Array.isArray(c?.exams) ? c.exams : []).filter((e) => e?.date && isNum(e.days_left));
  if (!exams.length) return `<section class="goal-block"><h3>Exam countdown</h3><p class="extra-thin">No exam date yet. Text MOTION something like “my math midterm is Oct 12” to start a countdown.</p></section>`;
  return `<section class="goal-block"><h3>Exam countdown</h3>${exams.slice(0, 3).map((e) => {
    const when = e.days_left === 0 ? 'today' : e.days_left === 1 ? 'tomorrow' : `in ${e.days_left} days`;
    const pace = isNum(e.avg_per_day_last_7)
      ? `${e.avg_per_day_last_7} min/day of ${esc(canonicalSubject(e.subject || 'study'))} this week${isNum(e.daily_target) ? ` · target ${e.daily_target}` : ''}`
      : '';
    const badge = e.on_pace === false ? ' · <b class="chip warn">behind pace</b>' : e.on_pace ? ' · <b class="chip good">on pace</b>' : '';
    return `<div class="countdown-row"><div class="countdown-days ${e.days_left <= 3 ? 'soon' : ''}"><strong>${e.days_left}</strong><small>${e.days_left === 1 ? 'day' : 'days'}</small></div><div><strong>${esc(e.label)}</strong> <span class="extra-thin">${esc(isoLabel(e.date, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${when}</span>${pace ? `<p class="extra-thin">${pace}${badge}</p>` : ''}</div></div>`;
  }).join('')}</section>`;
}

// ---------- Caffeine (Stomach tab) ----------
function renderCaffeine() {
  const el = $('caffeine-card');
  if (!el) return;
  const c = store.caffeine;
  const title = head('Stomach · sleep', 'Caffeine');
  if (!c) { el.innerHTML = `${title}${empty('☕', 'Not available yet', 'Coffee, energy drinks and soda you log will show here with their timing.')}`; return; }
  const days = (Array.isArray(c.days) ? c.days : []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!days.length) { el.innerHTML = `${title}${empty('☕', 'No caffeine logged', 'Coffee, Dutch Bros, Coke and energy drinks you tell MOTION about show up here.')}`; return; }
  const t = c.totals || {};
  const sl = c.sleep || {};
  const sleepLine = isNum(sl.avg_sleep_after_late) && isNum(sl.avg_sleep_without)
    ? `Sleep after caffeine past ${clockLabel((c.late_hour ?? 15) * 60)}: <b>${sl.avg_sleep_after_late}h</b> vs <b>${sl.avg_sleep_without}h</b> otherwise.`
    : `Sleep comparison needs ${plural(Number(sl.needs_more_nights) || 1, 'more night')} of data.`;
  const dayItem = (d) => {
    const items = (d.items || []).map((i) => `<li><span>${esc(String(i.label).replace(/\s*\([^)]*\)/g, ''))}</span><small>${esc(timeOf(i.at) || '')}${i.pain_after ? ' · <b class="chip warn">pain after</b>' : ''}</small></li>`).join('');
    const bed = isNum(d.hours_before_bed) ? `<p class="extra-thin">${d.hours_before_bed}h before bed${isNum(d.sleep_hours) ? ` · slept ${d.sleep_hours}h` : ''}</p>` : '';
    return `<li><div class="pain-when"><strong>${esc(isoLabel(d.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</strong><span>${d.last ? `last at ${esc(d.last)}` : 'time not logged'}</span></div><div><ul class="pain-foods">${items}</ul>${bed}</div></li>`;
  };
  el.innerHTML = `${title}
    <div class="caffeine-stats">
      <div><strong>${Number(t.servings) || 0}</strong><span>${Number(t.servings) === 1 ? 'serving' : 'servings'} on ${plural(Number(t.days_with_caffeine) || 0, 'day')}</span></div>
      <div><strong>${Number(t.followed_by_pain) || 0}</strong><span>followed by stomach pain within ${plural(Number(c.hours) || 3, 'hour')}</span></div>
    </div>
    <p class="extra-thin">${sleepLine}</p>
    <ol class="caffeine-days">${days.slice(0, 7).map(dayItem).join('')}</ol>
    <p class="extra-thin">Associations in your own logs, not medical conclusions.</p>`;
}
