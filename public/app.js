// server.mjs proxies /api/* to the backend, so the API is same-origin by default.
import { renderLifeAnalytics } from './life.js';
import { renderHomeworkAnalytics } from './homework.js';
import { loadSkinPhotos, setPhotosVisible } from './photos.js';
import { loadTodos } from './todos.js';
import { getKey, showLock } from './auth.js';
import { startSyncStatus, refreshSyncStatus, reportDataLoad, reportLoading } from './status.js';
import { loadReview } from './review.js';
import { loadExtras, renderDayCards, renderRevisit, renderLevel } from './extras.js';
import { loadDoorDash } from './doordash.js';
import { renderWeekStrip } from './week.js';
import { renderSkincare } from './skincare.js';
import { phoenixToday, phoenixLabel, greeting, shiftIso, isoLabel, plural, isNum, sameText, canonicalSubject, isProductive, clockMinutes, clockLabel, daysBetween } from './util.js';
const API_BASE = window.SOMA_API_BASE ?? '';
const API_KEY = getKey();
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

// Local-dev-only sample days (never shown on the live site; see loadData).
const rawSamples = [
  ['2026-09-25',1,3,6,3,5,72,24,['oatmeal','berries','salmon'],'Calm stomach and good energy.'],
  ['2026-09-24',2,3,5,3,4,48,0,['egg','avocado','rice'],'A little bloating after dinner.'],
  ['2026-09-23',1,2,7,4,6,85,35,['yogurt','salad','chicken'],'Skin routine completed.'],
  ['2026-09-22',4,4,3,3,3,112,0,['coffee','sandwich','pasta'],'Cramping late afternoon.'],
  ['2026-09-21',3,4,4,3,4,60,20,['toast','cheese','taco'],'Skin felt more irritated.'],
  ['2026-09-20',2,3,6,3,5,25,42,['oat','banana','soup'],'Morning ritual done.'],
  ['2026-09-19',5,4,2,2,2,95,0,['coffee','pizza','ice cream'],'More discomfort today.']
];
const previewZones = ['forehead','left cheek','chin','right cheek','jawline','nose','forehead'];
const sampleDays = rawSamples.map(([date, stomach_pain, acne, water, meals_logged, habits_done, hmwk_minutes, workout_minutes, foods, note], index) => ({
  date, stomach_pain, acne, acne_spots:acne, water, meals_logged, habits_done, hmwk_minutes, workout_minutes,
  work_minutes: 0, walk_minutes: workout_minutes ? 15 : 0, foods,
  meals: foods.map((text, i) => ({ at: `${date}T${12 + i}:00:00-07:00`, text })),
  habits: Object.fromEntries(['water','am_skincare','sunscreen','bedtime'].slice(0, Math.min(habits_done, 4)).map(habit => [habit, { count: 1, value: habit === 'water' ? water : null }])),
  sessions: [...(hmwk_minutes ? [{ activity:'hmwk', subject:'history', minutes:hmwk_minutes }] : []), ...(workout_minutes ? [{ activity:'workout', subject:null, minutes:workout_minutes }] : [])],
  skin: { routines: habits_done > 3 ? 1 : 0, photos: 0, notes: acne ? [{ at:`${date}T20:00:00-07:00`, kind:'note', text:`Breakout around ${previewZones[index % previewZones.length]}`, severity:acne }] : [] },
  notes: note ? [{ tracker:'food', at:`${date}T19:00:00-07:00`, text:note }] : [],
  event_count: meals_logged + habits_done + 1
}));

const state = { days:[], filtered:[], previous:[], rangeDays:14, source:'sample', series:{pain:true, acne:true}, summary:null, foodInsights:null, lifestyleInsights:null, blueprint:null, foodCompass:null, focusCurve:null, faceDate:null, faceZone:null, faceWeekEnd:null, panel:'overview', bodyTab:'stomach' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const maybeNum = value => value === null || value === undefined || value === '' ? null : num(value, null);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (val, decimals = 1) => { const f = 10 ** decimals; return Math.round(val * f) / f; };
// Mean of the values that were actually logged; null when nothing was.
const meanOrNull = values => { const present = values.filter(isNum).map(Number); return present.length ? present.reduce((sum,value) => sum + value, 0) / present.length : null; };
const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
const toDate = value => { if (!value) return null; const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; };
const shortDate = value => isoLabel(value);
const formatClock = val => {
  if (!val) return null;
  const match = String(val).match(/(\d{1,2}):(\d{2})/);
  if (!match) return String(val);
  const h = Number(match[1]), m = Number(match[2]);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const apiHeaders = () => ({ Accept:'application/json', ...(API_KEY ? {Authorization:`Bearer ${API_KEY}`} : {}) });
// Productive minutes only (work, homework, workout, walk, chores). Rest, naps,
// sleep and social time are not "activity".
const totalActivity = day => day.sessions?.length
  ? day.sessions.filter(isProductive).reduce((sum,s)=>sum+num(s.minutes),0)
  : num(day.work_minutes)+num(day.hmwk_minutes)+num(day.workout_minutes)+num(day.walk_minutes)+num(day.chores_minutes);
const socialMinutes = day => day.sessions?.length ? day.sessions.filter(s => s.activity === 'social').reduce((sum,s)=>sum+num(s.minutes),0) : num(day.social_minutes);
const noteText = day => [...(day.notes || []), ...(day.pain_reports || []), ...(day.headache_reports || []), ...(day.life_notes || [])].map(note => typeof note === 'string' ? note : note?.text).filter(Boolean).join(' · ');
const sessionName = s => s.label || labelMetric(s.activity || 'session');
// "Math · math" -> "Math": only add the subject when it says something new.
const sessionText = s => { const name = sessionName(s), subject = s.subject ? canonicalSubject(s.subject) : ''; return subject && !sameText(subject, name) ? `${name} · ${subject}` : name; };

function normalizeDay(day) {
  return {
    date:day.date, event_count:num(day.event_count), stomach_pain:maybeNum(day.stomach_pain), acne:maybeNum(day.acne), acne_spots:maybeNum(day.acne_spots),
    wake_time:day.wake_time ?? null, bedtime:day.bedtime ?? null, mb:num(day.mb), mb_events:Array.isArray(day.mb_events) ? day.mb_events : [], sleep_hours:maybeNum(day.sleep_hours), sleep_segments:Array.isArray(day.sleep_segments) ? day.sleep_segments.filter(s => s && typeof s === 'object') : [],
    xp:maybeNum(day.xp), headache:maybeNum(day.headache), headache_reports:day.headache_reports||[], missed_habits:day.missed_habits||[], pain_reports:day.pain_reports||[], social_minutes:num(day.social_minutes), rest_minutes:num(day.rest_minutes),
    water:maybeNum(day.water), meals_logged:num(day.meals_logged), habits_done:num(day.habits_done),
    work_minutes:num(day.work_minutes), hmwk_minutes:num(day.hmwk_minutes), workout_minutes:num(day.workout_minutes), walk_minutes:num(day.walk_minutes), chores_minutes:num(day.chores_minutes), hmwk_by_subject:day.hmwk_by_subject||{},
    foods:Array.isArray(day.foods) ? day.foods : [], meals:Array.isArray(day.meals) ? day.meals : [],
    habits:day.habits && typeof day.habits === 'object' ? day.habits : {}, sessions:Array.isArray(day.sessions) ? day.sessions : [],
    skin:day.skin || {routines:0,photos:0,notes:[]}, notes:Array.isArray(day.notes) ? day.notes : [],
    doordash:day.doordash && typeof day.doordash === 'object' ? day.doordash : null,
    moods:Array.isArray(day.moods) ? day.moods : [], shield:Boolean(day.shield),
    life_notes:Array.isArray(day.life_notes) ? day.life_notes : [], goals:Array.isArray(day.goals) ? day.goals : []
  };
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {headers:apiHeaders()});
  // Locked: ask for the password instead of falling back to sample data.
  if (response.status === 401) { showLock(); throw Object.assign(new Error('locked'), { locked: true }); }
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function loadData({announce = false} = {}) {
  reportLoading();
  try {
    const [daily, summary, foodInsights, lifestyleInsights, blueprint, foodCompassData, focusCurveData] = await Promise.all([
      getJson('/api/daily'),
      getJson('/api/summary?days=30').catch(() => null),
      getJson('/api/insights/foods?min_days=3').catch(() => null),
      getJson('/api/insights/lifestyle').catch(() => null),
      getJson('/api/analytics/blueprint').catch(() => null),
      getJson('/api/analytics/food-compass').catch(() => null),
      getJson('/api/analytics/focus-curve').catch(() => null)
    ]);
    state.days = (daily.days || []).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day?.date || '')).map(normalizeDay).sort((a,b) => b.date.localeCompare(a.date));
    Object.assign(state, { summary, foodInsights, lifestyleInsights, blueprint, foodCompass:foodCompassData, focusCurve:focusCurveData, source:'api' });
    reportDataLoad({ ok:true, hasData:true });
  } catch (err) {
    if (err?.locked) return; // unlock screen is showing; don't render sample data
    // On the real site never show sample data as if it were real (e.g. when the
    // phone app opens offline): keep what was last loaded and say so.
    if (!LOCAL) {
      reportDataLoad({ ok:false, hasData:state.days.length > 0 });
      if (!state.days.length) applyRange();
      return;
    }
    state.days = sampleDays.map(normalizeDay).sort((a,b) => b.date.localeCompare(a.date));
    Object.assign(state, { summary:null, foodInsights:null, lifestyleInsights:null, blueprint:null, foodCompass:null, focusCurve:null, source:'sample' });
    reportDataLoad({ ok:false, sample:true, hasData:true });
  }
  applyRange();
  // First load: the #tab hash jump plus cards filling in above can leave the
  // page scrolled down; start at the top.
  if (!state.loadedOnce) { state.loadedOnce = true; requestAnimationFrame(() => window.scrollTo(0, 0)); }
  updateDataStatus();
  loadSkinPhotos();
  loadTodos();
  refreshSyncStatus();
  loadReview();
  loadExtras({ days: state.days });
  loadDoorDash();
  // MOTION syncs on its own; this only re-reads what the server already has.
  if (announce) showToast(state.source === 'api' ? 'Refreshed just now · MOTION syncs automatically' : 'Local sample data reloaded');
}

// Calendar periods: "this period" is the last N days ending today (Phoenix);
// "previous" is the N days right before it.
function applyRange() {
  const range = $('#range-select').value;
  const today = phoenixToday();
  if (range === 'all') {
    state.rangeDays = null;
    state.filtered = state.days.filter(day => day.date <= today);
    state.previous = [];
  } else {
    const n = Math.max(1, num(range, 14));
    state.rangeDays = n;
    const start = shiftIso(today, -(n - 1)), prevStart = shiftIso(today, -(2 * n - 1)), prevEnd = shiftIso(today, -n);
    state.filtered = state.days.filter(day => day.date >= start && day.date <= today);
    state.previous = state.days.filter(day => day.date >= prevStart && day.date <= prevEnd);
  }
  renderAll();
}

// Only a session that started in the last 16 hours counts as "current".
function activeSession() {
  return (state.summary?.active_sessions || []).find(s => { const t = Date.parse(s.started_at ?? s.start ?? ''); return Number.isFinite(t) && Date.now() - t >= 0 && Date.now() - t < 16 * 3600000; }) || null;
}

function renderAll() {
  const active = activeSession();
  renderWeekStrip(state.days);
  updatePatternsNav();
  renderLifeAnalytics(state.days, state.source, { now: active ? describeSession(active) : null, since: active?.started_at ?? null });
  renderHomeworkAnalytics(state.days, state.source, { range: $('#range-select').value });
  renderRevisit();
  renderDayCards({ days: state.days, filtered: state.filtered, rangeDays: state.rangeDays });
  renderLevel(levelInfo());
  renderMetrics();
  renderStomachHeadline();
  renderSkincare({ days: state.days, rangeDays: state.rangeDays });
  renderBlueprint();
  renderSignalsChart();
  renderKitchenCompass();
  renderFaceMap();
  renderRecent();
  renderJournal($('#journal-search')?.value || '');
  renderPatterns();
}

// ---------- Optimal Day Blueprint ----------
const MIN_BLUEPRINT_DAYS = 7;
function getBlueprint(days) {
  if (state.blueprint && typeof state.blueprint === 'object' && 'has_data' in state.blueprint) return state.blueprint;
  // Local fallback (only when the API gave nothing): targets are the plain
  // averages of the best days, with no invented minimums.
  const scored = days.map(d => ({ ...d, _score: 100 - num(d.stomach_pain) * 6 - num(d.acne) * 4 - num(d.headache) * 4 + Math.min(num(d.water), 8) * 2.5 + Math.min(num(d.sleep_hours), 8) * 3 + Math.min(d.habits_done, 8) * 2 })).sort((a, b) => b._score - a._score);
  if (!scored.length) return { has_data:false, enough_data:false, sample_days:0, targets:null, contrasts:[] };
  const n = scored.length, quarter = Math.max(1, Math.ceil(n * 0.25));
  const peakDays = scored.slice(0, quarter), flareDays = scored.slice(-quarter);
  const avg = (arr, key) => { const v = meanOrNull(arr.map(d => d[key])); return v === null ? null : round(v, 1); };
  const pick = key => [avg(peakDays, key), avg(flareDays, key)];
  const [peakSleep, flareSleep] = pick('sleep_hours'), [peakWater, flareWater] = pick('water'), [peakHabits, flareHabits] = pick('habits_done'), [peakWalk, flareWalk] = pick('walk_minutes');
  const enough = n >= MIN_BLUEPRINT_DAYS;
  const contrast = (factor, peak, flare, unit) => peak === null || flare === null ? null : { factor, peak: `${peak} ${unit}`.trim(), flare: `${flare} ${unit}`.trim() };
  return {
    has_data: true, enough_data: enough, sample_days: n, peak_days_count: peakDays.length, flare_days_count: flareDays.length,
    targets: enough ? {
      sleep_hours: peakSleep === null ? null : { optimal: peakSleep },
      water_glasses: peakWater === null ? null : { optimal: peakWater },
      habits_count: peakHabits === null ? null : { optimal: peakHabits },
      walking_minutes: peakWalk ? { optimal: peakWalk } : null
    } : null,
    contrasts: enough ? [contrast('Sleep', peakSleep, flareSleep, 'hrs'), contrast('Water', peakWater, flareWater, 'glasses'), contrast('Habits Completed', peakHabits, flareHabits, ''), contrast('Walking / Movement', peakWalk, flareWalk, 'min')].filter(Boolean) : []
  };
}

// Only targets that come from real logged values. Movement and water are only
// offered when something was ever logged for them.
function usableTargets(blueprint) {
  const t = blueprint?.targets || {};
  const valid = obj => obj && isNum(obj.optimal) && Number(obj.optimal) > 0 ? obj : null;
  const loggedWalk = state.days.some(d => d.walk_minutes > 0 || d.workout_minutes > 0);
  const loggedWater = state.days.some(d => isNum(d.water));
  const loggedSleep = state.days.some(d => isNum(d.sleep_hours));
  return {
    sleep: loggedSleep ? valid(t.sleep_hours) : null,
    water: loggedWater ? valid(t.water_glasses) : null,
    habits: valid(t.habits_count),
    walk: loggedWalk ? valid(t.walking_minutes) : null,
    cutoff: t.study_cutoff_hour ? formatClock(t.study_cutoff_hour) : null
  };
}

// Contrast rows whose peak and flare values actually differ.
function differingContrasts(contrasts) {
  return (contrasts || []).map(c => ({ ...c, p: parseFloat(c.peak), f: parseFloat(c.flare) }))
    .filter(c => Number.isFinite(c.p) && Number.isFinite(c.f) ? Math.abs(c.p - c.f) >= 0.1 : String(c.peak) !== String(c.flare));
}

function renderBlueprint() {
  const host = $('#blueprint-card');
  if (!host) return;
  const blueprint = getBlueprint(state.days);
  const logged = num(blueprint.sample_days, state.days.length);
  const targets = usableTargets(blueprint);
  const ready = blueprint.has_data && blueprint.enough_data !== false && blueprint.targets && Object.values(targets).some(Boolean);
  const subtitle = $('#blueprint-subtitle');
  const contrastTable = $('#blueprint-contrast-table'), takeaway = $('#blueprint-takeaway');
  if (!ready) {
    const need = Math.max(1, MIN_BLUEPRINT_DAYS - logged);
    if (subtitle) subtitle.textContent = `Needs ${plural(need, 'more day')} of data.`;
    const note = $('#blueprint-summary-note'); if (note) note.textContent = `Needs ${plural(need, 'more day')} of data`;
    $('#blueprint-targets-grid').innerHTML = `<div class="needs-data" style="grid-column:1/-1"><strong>Needs ${plural(need, 'more day')} of data</strong><span>The blueprint compares your best and hardest days once ${MIN_BLUEPRINT_DAYS}+ days are logged with MOTION. ${plural(logged, 'day')} logged so far.</span></div>`;
    if (contrastTable) contrastTable.innerHTML = '<p class="time-empty">Contrasts unlock as more days are logged with MOTION.</p>';
    if (takeaway) { takeaway.innerHTML = ''; takeaway.hidden = true; }
    return;
  }
  if (subtitle) subtitle.textContent = `Targets from your ${plural(num(blueprint.peak_days_count, 1), 'best day')} out of ${plural(logged, 'logged day')}. Early days: these shift as you log more.`;
  const note = $('#blueprint-summary-note'); if (note) note.textContent = `From your ${plural(num(blueprint.peak_days_count, 1), 'best day')} of ${plural(logged, 'logged day')}`;
  const today = phoenixToday();
  const todayLog = state.days.find(d => d.date === today) || null;
  const nothingToday = { label: 'Nothing logged today yet', cls: 'pending' };
  const tiles = [];

  if (targets.sleep) {
    const opt = targets.sleep.optimal, min = isNum(targets.sleep.min) && targets.sleep.min <= opt ? targets.sleep.min : null;
    const last = todayLog?.sleep_hours ?? null;
    const status = !todayLog ? nothingToday : last === null ? { label: 'Sleep not logged today', cls: 'pending' } : last >= (min ?? opt) ? { label: `${last}h logged · On target ✓`, cls: 'on-target' } : { label: `${last}h logged · ${round(opt - last, 1)}h under`, cls: 'below' };
    tiles.push({ cls:'sleep', icon:'🛌', target:`${opt}h`, title:'Sleep on your best days', sub: min !== null ? `Target: ${min}–${opt} hrs` : `Average: ${opt} hrs`, status });
  }
  if (targets.water) {
    const opt = Math.round(targets.water.optimal), cur = todayLog?.water ?? null;
    const status = !todayLog ? nothingToday : cur === null ? { label: 'Water not logged today', cls: 'pending' } : cur >= opt ? { label: `${plural(cur, 'glass', 'glasses')} · Goal reached ✓`, cls: 'on-target' } : { label: `${cur}/${opt} glasses · ${opt - cur} to go`, cls: 'pending' };
    tiles.push({ cls:'water', icon:'💧', target:`${opt} gl`, title:'Water on your best days', sub:`Average: ${plural(opt, 'glass', 'glasses')}`, status, pct: cur === null ? null : clamp(Math.round(cur / opt * 100), 0, 100) });
  }
  if (targets.cutoff) {
    tiles.push({ cls:'cutoff', icon:'⏰', target:targets.cutoff, title:'Homework wrap-up', sub:`Best days finished homework around ${targets.cutoff}`, status:{ label:'From your best days', cls:'pending' } });
  }
  if (targets.walk) {
    const opt = Math.round(targets.walk.optimal), cur = todayLog ? todayLog.walk_minutes + todayLog.workout_minutes : null;
    const status = !todayLog ? nothingToday : cur >= opt ? { label: `${cur} min · Movement hit ✓`, cls: 'on-target' } : { label: `${cur}/${opt} min logged`, cls: 'pending' };
    tiles.push({ cls:'movement', icon:'🚶', target:`${opt}m`, title:'Movement on your best days', sub:`Average: ${opt} min walking / workout`, status });
  }
  if (targets.habits) {
    const opt = Math.round(targets.habits.optimal), cur = todayLog?.habits_done ?? null;
    const status = !todayLog ? nothingToday : cur >= opt ? { label: `${plural(cur, 'habit')} · Target hit ✓`, cls: 'on-target' } : { label: `${cur}/${opt} habits logged`, cls: 'pending' };
    tiles.push({ cls:'habits', icon:'✦', target:`${opt}`, title:'Habits on your best days', sub:`Average: ${plural(opt, 'habit')}`, status, pct: cur === null ? null : clamp(Math.round(cur / opt * 100), 0, 100) });
  }
  $('#blueprint-targets-grid').innerHTML = tiles.map(t => `
    <article class="blueprint-tile ${t.cls}">
      <div class="blueprint-tile-head"><span class="blueprint-tile-icon" aria-hidden="true">${t.icon}</span><span class="blueprint-tile-target">${escapeHtml(t.target)}</span></div>
      <div><div class="blueprint-tile-title">${escapeHtml(t.title)}</div><div class="blueprint-tile-sub">${escapeHtml(t.sub)}</div>${t.pct !== undefined && t.pct !== null ? `<div class="blueprint-progress-wrap"><div class="blueprint-progress-track"><span style="width:${t.pct}%"></span></div></div>` : ''}</div>
      <span class="blueprint-tile-status ${t.status.cls}">${escapeHtml(t.status.label)}</span>
    </article>`).join('');

  const differing = differingContrasts(blueprint.contrasts);
  const hiddenCount = (blueprint.contrasts || []).length - differing.length;
  if (contrastTable) {
    contrastTable.innerHTML = differing.length ? `
      <div class="contrast-row header"><span>Factor</span><span>Best days</span><span>Hardest days</span><span>The difference</span></div>
      ${differing.map(c => `<div class="contrast-row"><strong>${escapeHtml(c.factor)}</strong><span class="contrast-cell-peak">${escapeHtml(c.peak)}</span><span class="contrast-cell-flare">${escapeHtml(c.flare)}</span><span class="contrast-cell-delta">${Number.isFinite(c.p) && Number.isFinite(c.f) ? `${c.p - c.f >= 0 ? '+' : '−'}${round(Math.abs(c.p - c.f), 1)} on best days` : 'differs'}</span></div>`).join('')}
      ${hiddenCount > 0 ? `<p class="time-empty">${plural(hiddenCount, 'factor')} looked the same on best and hardest days, so ${hiddenCount === 1 ? 'it is' : 'they are'} not shown.</p>` : ''}`
      : '<p class="time-empty">No clear differences between your best and hardest days yet.</p>';
  }
  if (takeaway) {
    const top = [...differing].sort((a, b) => Math.abs(b.p - b.f) / Math.max(Math.abs(b.f), 1) - Math.abs(a.p - a.f) / Math.max(Math.abs(a.f), 1)).slice(0, 2);
    takeaway.hidden = !top.length;
    takeaway.innerHTML = top.length ? `<strong>What stands out:</strong> ${top.map(c => `${escapeHtml(c.factor)} was ${escapeHtml(c.peak)} on best days vs ${escapeHtml(c.flare)} on hardest days`).join('; ')}. Based on ${plural(logged, 'logged day')} from MOTION.` : '';
  }
}

// Level: the backend's level when available, else MOTION's rule
// level = 1 + floor(sqrt(xp / 150)).
function levelInfo() {
  const lvl = state.summary?.level;
  const summedXp = state.days.reduce((sum, day) => sum + (day.xp ?? 0), 0);
  const xp = Math.max(0, isNum(lvl?.xp) ? Number(lvl.xp) : isNum(state.summary?.xp?.all_time_total) ? Number(state.summary.xp.all_time_total) : summedXp);
  let level, start, next, pct;
  if (lvl && isNum(lvl.level)) {
    level = Number(lvl.level);
    start = isNum(lvl.level_start_xp) ? Number(lvl.level_start_xp) : 150 * (level - 1) ** 2;
    next = isNum(lvl.next_level_xp) ? Number(lvl.next_level_xp) : 150 * level ** 2;
    pct = isNum(lvl.progress) ? (Number(lvl.progress) <= 1 ? Number(lvl.progress) * 100 : Number(lvl.progress)) : null;
  } else {
    level = 1 + Math.floor(Math.sqrt(xp / 150));
    start = 150 * (level - 1) ** 2;
    next = 150 * level ** 2;
  }
  const span = Math.max(1, next - start);
  if (pct === null || pct === undefined) pct = (xp - start) / span * 100;
  return { xp, level, into: Math.max(0, Math.round(xp - start)), span: Math.round(span), pct: clamp(Math.round(pct), 0, 100) };
}

// ---------- Metric cards ----------
function compareLabel() { return state.rangeDays ? `vs previous ${plural(state.rangeDays, 'day')}` : ''; }
// Sets a trend pill comparing this period with the previous equal-length one.
function setPeriodTrend(el, current, previous, { lowerIsBetter = false, format = v => v.toFixed(1), unit = '', stable = 0 } = {}) {
  if (!el) return;
  if (current === null) { setTrend(el, 'not logged', false, true); el.title = ''; return; }
  if (!state.rangeDays) { setTrend(el, 'all time', false, true); el.title = 'Pick a 7, 14 or 30 day range to compare periods.'; return; }
  if (previous === null) { setTrend(el, `no data ${compareLabel()}`, false, true); el.title = `Nothing logged in the previous ${plural(state.rangeDays, 'day')}.`; return; }
  const delta = current - previous;
  if (Math.abs(delta) <= stable) { setTrend(el, `→ same ${compareLabel()}`, false, true); el.title = ''; return; }
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  setTrend(el, `${delta > 0 ? '↑' : '↓'} ${format(Math.abs(delta))}${unit} ${compareLabel()}`, better);
  el.title = `This period ${format(current)}${unit}, previous ${format(previous)}${unit}`;
}

function renderMetrics() {
  const caption = $('#metric-compare-note');
  if (!state.filtered.length) {
    ['#acne-value','#activity-value','#habits-value'].forEach(sel => { $(sel).textContent = '—'; });
    ['#acne-change','#activity-change','#habits-change'].forEach(sel => setTrend($(sel),'no data yet',false,true));
    $('#habits-progress').style.width = '0%';
    ['#acne-sparkline','#activity-sparkline'].forEach(sel => { $(sel).innerHTML = ''; });
    if (caption) caption.textContent = state.rangeDays ? `Nothing logged in the last ${plural(state.rangeDays, 'day')}.` : 'Nothing logged yet.';
    return;
  }
  const cur = state.filtered, prev = state.previous;
  if (caption) caption.textContent = state.rangeDays ? `Arrows compare the last ${plural(state.rangeDays, 'day')} with the ${plural(state.rangeDays, 'day')} before. Averages use logged days only.` : 'All time. Averages use logged days only.';

  // Stomach has its own headline (renderStomachHeadline).

  // Skin: severity when logged, otherwise the spot count.
  const skin = skinMeasure(cur);
  const skinNow = meanOrNull(cur.map(d => d[skin.key])), skinPrev = meanOrNull(prev.map(d => d[skin.key]));
  $('#acne-value').textContent = skinNow === null ? '—' : skin.key === 'acne_spots' ? String(Math.round(skinNow)) : skinNow.toFixed(1).replace('.0','');
  $('#acne-value').nextElementSibling.textContent = skin.key === 'acne_spots' ? 'spots (avg count)' : 'severity average';
  setPeriodTrend($('#acne-change'), skinNow, skinPrev, { lowerIsBetter:true, stable: skin.key === 'acne_spots' ? 0.5 : 0.3, format: v => skin.key === 'acne_spots' ? String(Math.round(v)) : v.toFixed(1), unit: skin.key === 'acne_spots' ? ' spots' : '' });

  // Productive activity (rest/naps/sleep/social excluded); social shown separately.
  const activity = meanOrNull(cur.map(totalActivity)), prevActivity = prev.length ? meanOrNull(prev.map(totalActivity)) : null;
  const social = meanOrNull(cur.map(socialMinutes));
  $('#activity-value').textContent = `${Math.round(activity ?? 0)} min`;
  $('#activity-value').nextElementSibling.textContent = `productive avg${social ? ` · social ${Math.round(social)} min` : ''}`;
  setPeriodTrend($('#activity-change'), activity, prevActivity, { format: v => String(Math.round(v)), unit:' min', stable:0.5 });

  const habits = meanOrNull(cur.map(d => d.habits_done)), prevHabits = prev.length ? meanOrNull(prev.map(d => d.habits_done)) : null;
  $('#habits-value').textContent = (habits ?? 0).toFixed(1);
  setPeriodTrend($('#habits-change'), habits, prevHabits, { stable:0.05 });
  $('#habits-progress').style.width = `${clamp(((habits ?? 0)/8)*100,0,100)}%`;

  const series = key => [...cur].reverse().map(d => d[key]).filter(isNum).map(Number);
  renderSparkline('#acne-sparkline', series(skin.key), 'var(--spark-skin)', 'var(--spark-skin-fill)');
  renderSparkline('#activity-sparkline', [...cur].reverse().map(totalActivity), 'var(--spark-activity)', 'var(--spark-activity-fill)');
}

// Which skin number to show: severity (0-10) if any is logged, else spot count.
function skinMeasure(days) {
  if (days.some(d => d.acne !== null)) return { key:'acne', label:'Skin severity', max:10 };
  if (days.some(d => d.acne_spots !== null)) return { key:'acne_spots', label:'Spots', max:Math.max(5, Math.ceil(Math.max(...days.map(d => num(d.acne_spots))) / 5) * 5) };
  return { key:'acne', label:'Skin severity', max:10 };
}

// ---------- Stomach headline ----------
// A pain episode is any pain report with no score or a score above 0 (most
// reports are unscored, so an average alone would read as "no problems").
// A scored day with no report counts as one episode.
const isEpisode = r => r && (!isNum(r.pain) || Number(r.pain) > 0);
const unscoredCount = day => day.pain_reports.filter(r => r && !isNum(r.pain)).length;
function painEpisodes(days) {
  return days.flatMap(d => {
    const list = d.pain_reports.filter(isEpisode).map(r => ({ date:d.date, at:r.at ?? null, pain:isNum(r.pain) ? Number(r.pain) : null, text:r.text || '' }));
    if (!list.length && Number(d.stomach_pain) > 0) list.push({ date:d.date, at:null, pain:Number(d.stomach_pain), text:'' });
    return list;
  }).sort((a, b) => String(b.at ?? b.date).localeCompare(String(a.at ?? a.date)));
}

function renderStomachHeadline() {
  const el = $('#stomach-headline');
  if (!el) return;
  const today = phoenixToday();
  const scope = state.rangeDays ? `Last ${plural(state.rangeDays, 'day')}` : 'All time';
  const inRange = painEpisodes(state.filtered), all = painEpisodes(state.days.filter(d => d.date <= today));
  const last = all[0] || null;
  const scored = inRange.filter(e => e.pain !== null);
  const sinceDays = last ? daysBetween(last.date, today) : null;
  const when = last ? `${isoLabel(last.date, { weekday:'short', month:'short', day:'numeric' })}${clockMinutes(last.at) !== null ? ` · ${clockLabel(clockMinutes(last.at))}` : ''}` : '';
  const prev = state.rangeDays && state.previous.length ? painEpisodes(state.previous).length : null;
  el.innerHTML = `<div class="extra-head"><div><p class="eyebrow">Stomach · ${escapeHtml(scope)}</p><h2>${inRange.length ? plural(inRange.length, 'pain episode') : 'No pain episodes'}</h2></div>${prev !== null ? `<span class="extra-chip">previous ${plural(state.rangeDays, 'day')}: ${prev}</span>` : ''}</div>
    <div class="stomach-stats">
      <div><span>Days since last episode</span><strong>${sinceDays === null ? '—' : sinceDays === 0 ? 'Today' : plural(sinceDays, 'day')}</strong><small>${last ? '' : 'no pain reported yet'}</small></div>
      <div class="wide"><span>Last episode</span><strong>${last ? escapeHtml(when) : '—'}</strong><small>${last?.text ? `“${escapeHtml(last.text)}”` : last ? (last.pain !== null ? `pain ${last.pain}/10` : 'no note') : 'Tell MOTION when your stomach hurts and what you ate.'}</small></div>
      <div><span>Scores</span><strong>${scored.length ? `avg ${(scored.reduce((sum, e) => sum + e.pain, 0) / scored.length).toFixed(1)}<small>/10</small>` : '—'}</strong><small>${inRange.length ? (scored.length ? `${scored.length} of ${inRange.length} scored` : 'none of these were given a 0–10 score') : 'nothing to score'}</small></div>
    </div>`;
}

function describeSession(session) {
  if (session.activity === 'hmwk') return `working on ${session.subject ? canonicalSubject(session.subject) : 'homework'}`;
  return session.activity === 'workout' ? 'working out' : session.activity === 'walk' ? 'on a walk' : session.label ? `on ${session.label}` : session.activity || 'active';
}
function setTrend(element,text,positive,neutral=false) { if (!element) return; element.textContent=text; element.className=`trend-pill ${neutral?'neutral':positive?'positive':'negative'}`; }
function renderSparkline(selector,values,stroke,fill) {
  const el=$(selector); if (values.length < 2) { el.innerHTML=''; return; }
  const width=180,height=28,max=Math.max(...values,1),min=Math.min(...values,0),span=max-min||1;
  const points=values.map((value,index)=>[index*width/Math.max(values.length-1,1),height-3-((value-min)/span)*20]);
  const line=points.map((point,index)=>`${index?'L':'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${line} L${width},${height} L0,${height} Z" style="fill:${fill}" opacity=".55"/><path d="${line}" style="stroke:${stroke}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}

// ---------- Body signals chart ----------
// Drawn at the container's real pixel size (no stretched text), with fewer
// date labels on narrow screens. Points open a tooltip on hover, tap or focus.
function renderSignalsChart() {
  const wrap = $('#signals-chart'), days = [...state.filtered].reverse();
  if (!wrap) return;
  const skin = skinMeasure(days);
  const series = [
    state.series.pain && { key:'stomach_pain', label:'Stomach', unit:'/10', color:'var(--chart-pain)', dash:'' },
    state.series.acne && { key:skin.key, label:skin.key === 'acne_spots' ? 'Spots' : 'Skin', unit:skin.key === 'acne_spots' ? ' spots' : '/10', color:'var(--chart-skin)', dash:'5 5' }
  ].filter(Boolean);
  // Unscored pain reports still show: hollow dots on a "no score" row on top.
  const hollow = state.series.pain && days.some(d => unscoredCount(d));
  const hasValues = hollow || series.some(s => days.some(d => d[s.key] !== null));
  if (!days.length || !hasValues) {
    const msg = !days.length ? 'No signals in this date range.' : 'Nothing logged for this signal in this date range yet.';
    wrap.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
    return;
  }
  const yMax = series.some(s => s.key === 'acne_spots') ? skin.max : 10;
  const width = Math.max(260, Math.round(wrap.clientWidth || 720)), narrow = width < 520;
  const height = (narrow ? 190 : 220) + (hollow ? 22 : 0), pad = { top:hollow ? 36 : 14, right:14, bottom:30, left:hollow ? 58 : 30 };
  const rowY = 14;
  const innerWidth = width - pad.left - pad.right, innerHeight = height - pad.top - pad.bottom;
  const x = i => pad.left + (days.length === 1 ? innerWidth / 2 : (i / (days.length - 1)) * innerWidth);
  const y = v => pad.top + innerHeight - (clamp(v ?? 0, 0, yMax) / yMax) * innerHeight;
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round(yMax * i / 5));
  // Label from the newest day backwards so the last date is always shown and labels never collide.
  const maxLabels = Math.max(2, Math.floor(innerWidth / (narrow ? 62 : 70)));
  const stride = Math.max(1, Math.ceil(days.length / maxLabels));
  const labelled = new Set(); for (let i = days.length - 1; i >= 0; i -= stride) labelled.add(i);
  const labels = days.map((day, i) => labelled.has(i) ? `<text class="axis-text" x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${shortDate(day.date)}</text>` : '').join('');
  const path = key => days.map((d, i) => d[key] === null ? '' : `${i && days[i-1][key] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const points = s => days.map((d, i) => d[s.key] === null ? '' : `<g class="chart-point" tabindex="0" role="button" data-index="${i}" aria-label="${escapeHtml(`${shortDate(d.date)}: ${s.label} ${d[s.key]}${s.unit}`)}"><circle class="hit" cx="${x(i).toFixed(1)}" cy="${y(d[s.key]).toFixed(1)}" r="14"/><circle class="point" cx="${x(i).toFixed(1)}" cy="${y(d[s.key]).toFixed(1)}" r="4" style="fill:${s.color}"/></g>`).join('');
  const hollowRow = !hollow ? '' : `<text class="axis-text" x="${pad.left - 12}" y="${rowY + 4}" text-anchor="end">no score</text><line class="grid-line dashed" x1="${pad.left}" y1="${rowY}" x2="${width - pad.right}" y2="${rowY}"/>${days.map((d, i) => { const n = unscoredCount(d); return n ? `<g class="chart-point" tabindex="0" role="button" data-index="${i}" aria-label="${escapeHtml(`${shortDate(d.date)}: pain reported${n > 1 ? ` ${n} times` : ''}, no score`)}"><circle class="hit" cx="${x(i).toFixed(1)}" cy="${rowY}" r="14"/><circle class="point hollow" cx="${x(i).toFixed(1)}" cy="${rowY}" r="5"/>${n > 1 ? `<text class="axis-text" x="${(x(i) + 8).toFixed(1)}" y="${rowY - 6}">×${n}</text>` : ''}</g>` : ''; }).join('')}`;
  const title = `${series.map(s => s.label).join(' and ')} by day, ${shortDate(days[0].date)} to ${shortDate(days.at(-1).date)}`;
  wrap.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="signals-title"><title id="signals-title">${escapeHtml(title)}</title>${ticks.map(v => `<line class="grid-line" x1="${pad.left}" y1="${y(v).toFixed(1)}" x2="${width - pad.right}" y2="${y(v).toFixed(1)}"/><text class="axis-text" x="${pad.left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}${series.map(s => `<path class="series-line" d="${path(s.key)}" style="stroke:${s.color}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`).join('')}${series.map(points).join('')}${hollowRow}${labels}</svg>${hollow ? '<p class="chart-note">Hollow dots on the top row: pain was reported without a 0–10 score.</p>' : ''}`;
  const hide = () => $('.chart-tooltip', wrap)?.remove();
  $$('.chart-point', wrap).forEach(point => {
    const show = () => showChartTooltip(point, days[num(point.dataset.index)], series);
    point.addEventListener('mouseenter', show);
    point.addEventListener('focus', show);
    point.addEventListener('click', event => { event.stopPropagation(); show(); });
    point.addEventListener('blur', hide);
    point.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); } });
  });
  wrap.onmouseleave = hide;
  wrap.onclick = hide;
}

function showChartTooltip(point, day, series) {
  const wrap = $('#signals-chart');
  $('.chart-tooltip', wrap)?.remove();
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  tip.setAttribute('role', 'status');
  const unscored = state.series.pain ? day.pain_reports.filter(r => r && !isNum(r.pain)) : [];
  tip.innerHTML = `<strong>${shortDate(day.date)}</strong>${series.map(s => `<span>${s.label} ${day[s.key] ?? 'not scored'}${day[s.key] !== null ? s.unit : ''}</span>`).join('')}${unscored.length ? `<span>Pain reported${unscored.length > 1 ? ` ×${unscored.length}` : ''}, no score</span>${unscored[0].text ? `<span>“${escapeHtml(unscored[0].text)}”</span>` : ''}` : ''}`;
  const rect = wrap.getBoundingClientRect(), box = point.querySelector('.point').getBoundingClientRect();
  tip.style.left = `${clamp(box.left + box.width / 2 - rect.left, 55, rect.width - 55)}px`;
  tip.style.top = `${box.top - rect.top}px`;
  wrap.append(tip);
}

// ---------- Possible connections / Discoveries ----------
// Only real statistics from the API. No filler rows and no invented scores.
const MIN_PATTERN_DAYS = 14;
function connectionItems() {
  const foodRows = ['stomach_pain','acne'].flatMap(symptom => (state.foodInsights?.[symptom]?.foods || []).filter(item => isNum(item.difference) && item.difference > 0).map(item => ({ label:item.food, icon:'◌', detail:`${plural(num(item.days_eaten), 'day')} eaten · ${symptom === 'acne' ? 'skin' : 'stomach'} +${Number(item.difference).toFixed(1)} after`, stat:`+${Number(item.difference).toFixed(1)}`, statLabel:'difference', confidence:item.confidence || null, rank:Number(item.difference) / 10 })));
  const lifestyleRows = (state.lifestyleInsights?.correlations || []).filter(item => isNum(item.r) && Math.abs(item.r) >= .2).map(item => ({ label:labelMetric(item.factor), icon:item.r < 0 ? '↘' : '↗', detail:`${item.strength} ${item.r < 0 ? 'negative' : 'positive'} link with ${item.symptom === 'acne' ? 'skin' : item.symptom === 'headache' ? 'headaches' : 'stomach'}${item.lag_days ? ` (${plural(item.lag_days, 'day')} later)` : ''}`, stat:`r ${Number(item.r).toFixed(2)}`, statLabel:`${plural(num(item.n), 'day')}`, confidence:null, rank:Math.abs(item.r), bar:Math.round(Math.abs(item.r) * 100) }));
  return [...foodRows, ...lifestyleRows].sort((a, b) => b.rank - a.rank).slice(0, 4);
}
function patternsNeed() { return Math.max(1, MIN_PATTERN_DAYS - state.days.length); }
function needsDataCard(extra = '') { return `<div class="needs-data"><strong>Needs ${plural(patternsNeed(), 'more day')} of data</strong><span>Connections appear once there is enough history to compare (about ${MIN_PATTERN_DAYS} logged days; ${plural(state.days.length, 'day')} so far). ${extra}</span></div>`; }

function labelMetric(value) { return String(value).replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase()); }
function signalBadge(value,label) { const missing=value===null||value===undefined,good=!missing&&value<=2,warn=!missing&&value>=5; return `<span class="signal-badge ${good?'good':warn?'warn':''}">${escapeHtml(label)}${label?' ':''}${missing?'—':value}</span>`; }

// ---------- Kitchen Compass ----------
// API results only (no local guesses). A food eaten on a day with a pain
// report is never shown as "safe", scored or not.
function getFoodCompass() {
  const api = state.foodCompass || {};
  const painDays = new Set(state.days.filter(d => d.pain_reports.length || (d.stomach_pain ?? 0) > 0).map(d => d.date));
  const eatenOnPainDay = food => state.days.some(d => painDays.has(d.date) && d.foods.some(f => sameText(f, food)));
  return {
    safe_foods: (api.safe_foods || []).filter(f => f?.food && !eatenOnPainDay(f.food)),
    confirmed_triggers: (api.confirmed_triggers || []).filter(t => t?.food),
    watchlist: (api.watchlist || []).filter(w => w?.food),
    available: Boolean(state.foodCompass)
  };
}

function renderKitchenCompass() {
  if (!$('#kitchen-compass-card')) return;
  const compass = getFoodCompass();
  const safeFoods = compass.safe_foods, watchlist = compass.watchlist, triggers = compass.confirmed_triggers;
  const recentDates = new Set([phoenixToday(), shiftIso(phoenixToday(), -1)]);
  const recentFoods = new Set(state.days.filter(d => recentDates.has(d.date)).flatMap(d => d.foods.map(f => f.toLowerCase())));
  const activeTrigger = triggers.find(t => recentFoods.has(String(t.food).toLowerCase()));
  const statusBadge = $('#radar-status-badge'), radarBanner = $('#compass-radar-banner');
  if (activeTrigger) {
    statusBadge.className = 'radar-status-badge alert';
    statusBadge.innerHTML = '<span>● Trigger eaten recently</span>';
    radarBanner.className = 'compass-radar-banner warning';
    radarBanner.innerHTML = `<span aria-hidden="true">⚠️</span><div><strong>Heads up:</strong> <em>${escapeHtml(labelMetric(activeTrigger.food))}</em> was logged in the past 48 hours and has been followed by higher symptoms before.</div>`;
  } else if (!compass.available || (!safeFoods.length && !triggers.length && !watchlist.length)) {
    statusBadge.className = 'radar-status-badge';
    statusBadge.innerHTML = '<span>Gathering data</span>';
    radarBanner.className = 'compass-radar-banner calm';
    radarBanner.innerHTML = `<span aria-hidden="true">…</span><div><strong>Needs more meals and symptom check-ins.</strong> Foods are sorted here once each one has been eaten a few times with symptoms logged after.</div>`;
  } else {
    statusBadge.className = 'radar-status-badge steady';
    statusBadge.innerHTML = '<span>✓ No triggers eaten</span>';
    radarBanner.className = 'compass-radar-banner calm';
    radarBanner.innerHTML = `<span aria-hidden="true">✓</span><div><strong>Clear:</strong> none of your flagged foods were logged in the past 48 hours.</div>`;
  }
  $('#safe-foods-count').textContent = plural(safeFoods.length, 'food');
  $('#safe-foods-list').innerHTML = safeFoods.length ? safeFoods.map(f => { const n = num(f.eatenCount ?? f.days_eaten, null); return `<div class="food-badge safe-tag"><strong>${escapeHtml(labelMetric(f.food))}</strong>${n !== null ? `<span>${n}× eaten${isNum(f.avgPain) ? ` · avg pain ${f.avgPain}` : ''}</span>` : ''}</div>`; }).join('') : '<p class="time-empty">No safe baselines yet. Foods appear after 2+ calm days with them.</p>';
  $('#watchlist-foods-count').textContent = plural(watchlist.length, 'food');
  $('#watchlist-foods-list').innerHTML = watchlist.length ? watchlist.map(w => `<div class="food-badge watch-tag"><strong>${escapeHtml(labelMetric(w.food))}</strong>${isNum(w.difference) ? `<span>+${Number(w.difference).toFixed(1)} ${w.symptom === 'acne' ? 'skin' : 'stomach'}</span>` : ''}</div>`).join('') : '<p class="time-empty">No watchlist foods.</p>';
  $('#trigger-foods-count').textContent = plural(triggers.length, 'trigger');
  $('#trigger-foods-list').innerHTML = triggers.length ? triggers.map(t => `
    <article class="trigger-card">
      <div class="trigger-card-top"><strong>${escapeHtml(labelMetric(t.food))}</strong>${isNum(t.difference) ? `<span class="trigger-delta-pill">+${Number(t.difference).toFixed(1)} ${escapeHtml(t.symptom_label || (t.symptom === 'acne' ? 'skin' : 'stomach'))}</span>` : ''}</div>
      <p>Followed by higher ${t.symptom === 'acne' ? 'skin breakouts' : 'stomach discomfort'}${isNum(t.lag_days) ? ` about ${plural(t.lag_days, 'day')} after eating` : ''}.</p>
      <div class="trigger-meta">${isNum(t.days_eaten) ? `<span>Logged ${plural(t.days_eaten, 'day')}</span>` : ''}${t.confidence ? `<span>${escapeHtml(labelMetric(t.confidence))} confidence</span>` : ''}</div>
    </article>`).join('') : '<p class="time-empty">No high-confidence triggers identified yet.</p>';
}

// ---------- Acne face map ----------
const FACE_ZONES = {
  forehead: { label:'Forehead', x:100, y:65 },
  left_cheek: { label:'Left cheek', x:68, y:122 },
  right_cheek: { label:'Right cheek', x:132, y:122 },
  nose: { label:'Nose', x:100, y:112 },
  chin: { label:'Chin', x:100, y:171 },
  left_jaw: { label:'Left jaw', x:73, y:157 },
  right_jaw: { label:'Right jaw', x:127, y:157 },
  left_temple: { label:'Left temple', x:61, y:88 },
  right_temple: { label:'Right temple', x:139, y:88 }
};

function faceWeekDays() {
  const end = state.faceWeekEnd || phoenixToday();
  return Array.from({length:7}, (_, index) => {
    const key = shiftIso(end, -(6 - index));
    return state.days.find(day => day.date === key) || normalizeDay({date:key});
  });
}

function normalizeFaceZone(value='') {
  const text=String(value).toLowerCase().replace(/[-\s]+/g,'_');
  const direct={brow:'forehead',t_zone:'forehead',left_jawline:'left_jaw',right_jawline:'right_jaw'};
  if (FACE_ZONES[text]) return [text];
  if (direct[text]) return [direct[text]];
  return [];
}

function zonesFromText(value='') {
  const text=String(value).toLowerCase(),zones=[];
  if (/forehead|brow|t-zone|t zone/.test(text)) zones.push('forehead');
  if (/left\s+(?:side\s+)?cheek/.test(text)) zones.push('left_cheek');
  if (/right\s+(?:side\s+)?cheek/.test(text)) zones.push('right_cheek');
  if (!/left\s+(?:side\s+)?cheek|right\s+(?:side\s+)?cheek/.test(text) && /cheeks/.test(text)) zones.push('left_cheek','right_cheek');
  else if (!/left\s+(?:side\s+)?cheek|right\s+(?:side\s+)?cheek/.test(text) && /\bcheek\b/.test(text)) zones.push('left_cheek');
  if (/\bnose\b|nostril/.test(text)) zones.push('nose');
  if (/\bchin\b/.test(text)) zones.push('chin');
  if (/left\s+(?:side\s+)?(?:jaw|jawline)/.test(text)) zones.push('left_jaw');
  if (/right\s+(?:side\s+)?(?:jaw|jawline)/.test(text)) zones.push('right_jaw');
  if (!/left\s+(?:side\s+)?(?:jaw|jawline)|right\s+(?:side\s+)?(?:jaw|jawline)/.test(text) && /jaw|jawline/.test(text)) zones.push('left_jaw','right_jaw');
  if (/left\s+temple/.test(text)) zones.push('left_temple');
  if (/right\s+temple/.test(text)) zones.push('right_temple');
  if (!/left\s+temple|right\s+temple/.test(text) && /temples/.test(text)) zones.push('left_temple','right_temple');
  return [...new Set(zones)];
}

// Hotspots per zone. Structured locations (zone + spot count) win; notes
// only add their text, and only count as entries for zones with no location.
function faceSpots(day) {
  const grouped = new Map();
  const zoneOf = zone => { if (!grouped.has(zone)) grouped.set(zone, { zone, count:0, spots:null, severity:null, estimated:false, notes:[] }); return grouped.get(zone); };
  const located = new Set();
  for (const raw of day.skin?.locations || []) {
    const loc = typeof raw === 'string' ? { location:raw } : (raw || {});
    for (const zone of new Set([...normalizeFaceZone(loc.zone || loc.location || loc.area), ...zonesFromText(loc.text || '')])) {
      const g = zoneOf(zone); located.add(zone); g.count++;
      if (isNum(loc.spots)) g.spots = (g.spots ?? 0) + Number(loc.spots);
      if (isNum(loc.severity)) { g.severity = Math.max(g.severity ?? 0, clamp(Number(loc.severity), 0, 10)); g.estimated = g.estimated || Boolean(loc.severity_estimated); }
      if (loc.text || loc.note) g.notes.push(loc.text || loc.note);
    }
  }
  for (const note of day.skin?.notes || []) {
    const zones = new Set([...normalizeFaceZone(note.location || note.zone || note.area), ...zonesFromText(note.text || note.note || '')]);
    for (const zone of zones) {
      const g = zoneOf(zone);
      if (!located.has(zone)) { g.count++; if (isNum(note.severity)) g.severity = Math.max(g.severity ?? 0, clamp(Number(note.severity), 0, 10)); }
      if (note.text || note.note) g.notes.push(note.text || note.note);
    }
  }
  return [...grouped.values()];
}

function severityClass(value) { return value === null ? 'unknown' : value >= 7 ? 'active' : value >= 4 ? 'moderate' : 'mild'; }
const severityText = spot => spot.severity === null ? 'not logged' : `${spot.estimated ? '~' : ''}${spot.severity}/10${spot.estimated ? ' (estimated)' : ''}`;
const spotCountText = spot => spot.spots !== null ? plural(spot.spots, 'spot') : plural(spot.count, 'entry', 'entries');

function renderFaceMap() {
  const today = phoenixToday();
  if (!state.faceWeekEnd || state.faceWeekEnd > today) state.faceWeekEnd = today;
  const week = faceWeekDays();
  const hasSkin = day => day.acne !== null || day.acne_spots !== null || (day.skin?.notes?.length || 0) > 0 || (day.skin?.locations?.length || 0) > 0;
  if (!state.faceDate || !week.some(day => day.date === state.faceDate)) state.faceDate = ([...week].reverse().find(hasSkin) || week.at(-1)).date;
  const selected = week.find(day => day.date === state.faceDate) || week.at(-1), spots = faceSpots(selected);
  if (state.faceZone && !spots.some(spot => spot.zone === state.faceZone)) state.faceZone = null;
  const earliest = state.days.at(-1)?.date;
  const nav = $('#face-week-nav');
  if (nav) {
    const start = week[0].date, end = week.at(-1).date;
    nav.innerHTML = `<button type="button" class="face-week-shift" data-face-shift="-7" ${!earliest || start <= earliest ? 'disabled' : ''} aria-label="Earlier week">← Earlier</button><span>${shortDate(start)} – ${shortDate(end)}</span><button type="button" class="face-week-shift" data-face-shift="7" ${end >= today ? 'disabled' : ''} aria-label="Later week">Later →</button>`;
    $$('[data-face-shift]', nav).forEach(button => button.addEventListener('click', () => {
      const next = shiftIso(state.faceWeekEnd, Number(button.dataset.faceShift));
      state.faceWeekEnd = next > today ? today : next; state.faceDate = null; state.faceZone = null; renderFaceMap();
    }));
  }
  $('#face-week').innerHTML = week.map(day => { const logged = hasSkin(day); return `<button class="face-day ${day.date===selected.date?'active':''}" type="button" data-face-date="${day.date}" aria-pressed="${day.date===selected.date}" aria-label="${isoLabel(day.date,{weekday:'long',month:'long',day:'numeric'})}${logged ? ', skin logged' : ''}"><span class="weekday" aria-hidden="true">${isoLabel(day.date,{weekday:'narrow'})}</span><strong aria-hidden="true">${Number(day.date.slice(8))}</strong><span class="day-severity ${logged?'logged':''}"></span></button>`; }).join('');
  $('#face-hotspots').innerHTML = spots.map(spot => { const zone = FACE_ZONES[spot.zone], shown = spot.spots ?? spot.count, radius = 8 + Math.min(shown, 6) * 0.9; return `<g class="face-hotspot ${severityClass(spot.severity)} ${state.faceZone===spot.zone?'selected':''}" data-face-zone="${spot.zone}" tabindex="0" role="button" aria-label="${zone.label}, ${spotCountText(spot)}, severity ${severityText(spot)}"><circle class="hotspot-halo" cx="${zone.x}" cy="${zone.y}" r="${radius+6}"/><circle class="hotspot-core" cx="${zone.x}" cy="${zone.y}" r="${radius}"/><text x="${zone.x}" y="${zone.y+2}">${shown}</text></g>`; }).join('');
  renderFaceDetails(selected, spots);
  $$('.face-day').forEach(button => button.addEventListener('click', () => { state.faceDate = button.dataset.faceDate; state.faceZone = null; renderFaceMap(); }));
  $$('.face-hotspot').forEach(hotspot => {
    const select = () => { state.faceZone = hotspot.dataset.faceZone; renderFaceMap(); };
    hotspot.addEventListener('click', select); hotspot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
  });
}

function renderFaceDetails(day, spots) {
  const panel = $('#face-detail-panel'), longDate = isoLabel(day.date, {weekday:'long',month:'long',day:'numeric'}), selected = spots.find(spot => spot.zone === state.faceZone);
  const dayMeasure = day.acne !== null ? `${day.acne}/10` : day.acne_spots !== null ? plural(day.acne_spots, 'spot') : '—';
  if (selected) {
    const zone = FACE_ZONES[selected.zone];
    panel.innerHTML = `<p class="face-date">${longDate}</p><h3>${zone.label}</h3><p>${selected.notes.length ? escapeHtml([...new Set(selected.notes)].join(' · ')) : 'Skin activity logged in this area.'}</p><div class="face-summary"><div><span>Severity</span><strong>${escapeHtml(severityText(selected))}</strong></div><div><span>${selected.spots !== null ? 'Spots' : 'Entries'}</span><strong>${selected.spots ?? selected.count}</strong></div><div><span>Day total</span><strong>${escapeHtml(dayMeasure)}</strong></div></div><button class="text-button" id="clear-face-zone" type="button">← Back to day overview</button>`;
    $('#clear-face-zone').addEventListener('click', () => { state.faceZone = null; renderFaceMap(); });
    return;
  }
  if (!spots.length) {
    const hasSkinData = day.acne !== null || day.acne_spots !== null;
    const measure = [day.acne_spots !== null ? `${plural(day.acne_spots, 'visible spot')}` : '', day.acne !== null ? `severity ${day.acne}/10` : ''].filter(Boolean).join(' and ');
    panel.innerHTML = `<div class="face-empty"><span class="face-empty-icon" aria-hidden="true">${hasSkinData?'○':'✓'}</span><p class="face-date">${longDate}</p><h3>${hasSkinData?'Location not logged':'No mapped activity'}</h3><p>${hasSkinData?`${measure} ${measure.includes(' and ')?'were':'was'} logged, but MOTION did not include a facial location.`:'No acne location was found in this day’s skin notes.'}</p></div>`;
    return;
  }
  const severities = spots.map(s => s.severity).filter(v => v !== null);
  const totalSpots = spots.some(s => s.spots !== null) ? spots.reduce((sum, s) => sum + (s.spots ?? 0), 0) : null;
  panel.innerHTML = `<p class="face-date">${longDate}</p><h3>${plural(spots.length, 'area')} mapped</h3><p>Tap a hotspot for its notes and severity. Locations come from MOTION’s skin descriptions.</p><div class="face-summary"><div><span>Day total</span><strong>${escapeHtml(dayMeasure)}</strong></div><div><span>Areas</span><strong>${spots.length}</strong></div><div><span>${totalSpots !== null ? 'Mapped spots' : 'Peak severity'}</span><strong>${totalSpots !== null ? totalSpots : severities.length ? `${Math.max(...severities)}/10` : '—'}</strong></div></div><div class="zone-list">${spots.map(spot => `<button class="zone-row" type="button" data-zone-row="${spot.zone}"><i class="zone-color"></i><strong>${FACE_ZONES[spot.zone].label}</strong><span>${escapeHtml(spotCountText(spot))} · ${escapeHtml(severityText(spot))}</span></button>`).join('')}</div>`;
  $$('[data-zone-row]', panel).forEach(button => button.addEventListener('click', () => { state.faceZone = button.dataset.zoneRow; renderFaceMap(); }));
}

// ---------- Recent days & journal ----------
function renderRecent() {
  const mode = ['acne','stomach'].includes(document.body.dataset.dashboard) ? document.body.dataset.dashboard : 'overview';
  const container = $('#recent-table');
  $('.recent-card h2').textContent = {overview:'Recent days',acne:'Your skin check-ins',stomach:'Meals & stomach notes'}[mode];
  // Only days with something logged for this tab; never a list of "nothing" rows.
  const rows = state.filtered.map(day => {
    const details = mode==='overview' ? day.sessions.map(s => `${sessionText(s)} · ${num(s.minutes)} min`).join(' / ') : mode==='acne' ? (day.skin?.notes||[]).map(n => n.text).filter(Boolean).join(' · ') : [...day.meals.map(m => m.text), ...day.pain_reports.map(r => r.text), ...day.life_notes.map(n => n.text)].filter(Boolean).join(' · ');
    const metric = mode==='overview' ? `${plural(day.habits_done, 'habit')} · ${totalActivity(day)} productive min` : mode==='acne' ? [day.acne !== null ? `Severity ${day.acne}/10` : '', day.acne_spots !== null ? plural(day.acne_spots, 'spot') : ''].filter(Boolean).join(' · ') || 'Skin not scored' : day.stomach_pain !== null ? `Discomfort ${day.stomach_pain}/10` : day.pain_reports.length ? 'Pain reported (no score)' : 'No pain logged';
    if (!details && /not scored|^0 habits/.test(metric)) return '';
    return `<article class="tracker-entry"><div><strong>${shortDate(day.date)}</strong><span>${escapeHtml(metric)}</span></div>${details ? `<p>${escapeHtml(details)}</p>` : ''}</article>`;
  }).filter(Boolean);
  container.innerHTML = rows.slice(0, 5).join('') || '<div class="empty-state">Nothing logged in this range yet.</div>';
}

const moodText = m => [Array.isArray(m.feelings) ? m.feelings.join(', ') : m.feelings, isNum(m.severity) ? `${m.severity}/10` : '', m.cause ? `because ${m.cause}` : '', m.notes].filter(Boolean).join(' · ');
function journalSearchText(day) {
  return [...day.foods, noteText(day), ...day.sessions.map(s => `${s.activity} ${s.subject || ''} ${s.label || ''}`), ...day.moods.map(moodText), ...day.life_notes.map(n => `${n.kind || ''} ${n.text || ''}`)].join(' ').toLowerCase();
}

function renderJournal(query='') {
  const normalized = query.trim().toLowerCase(), days = state.days.filter(day => !normalized || journalSearchText(day).includes(normalized));
  $('#entry-count').textContent = plural(days.length, 'day');
  $('#journal-list').innerHTML = days.length ? days.map(day => {
    const sessions = day.sessions.length ? day.sessions.map(s => `${sessionText(s)} ${num(s.minutes)}m`).join(' · ') : '';
    const title = day.meals.map(meal => meal.text).filter(Boolean).join(' · ') || day.foods.join(' · ') || 'MOTION check-ins';
    const details = [[...day.notes, ...day.pain_reports, ...day.headache_reports].map(n => typeof n === 'string' ? n : n?.text).filter(Boolean).join(' · '), sessions].filter(Boolean).join(' — ') || `${plural(day.event_count, 'event')} logged by MOTION.`;
    const lifeNotes = day.life_notes.filter(n => n?.text).map(n => `<li><span class="journal-note-kind">${escapeHtml(labelMetric(n.kind || 'note'))}</span>${n.at ? `<time>${escapeHtml(formatClock(n.at) || '')}</time>` : ''}${escapeHtml(n.text)}</li>`).join('');
    const moods = day.moods.map(m => `<li><span class="journal-note-kind mood">Mood</span>${m.at ? `<time>${escapeHtml(formatClock(m.at) || '')}</time>` : ''}${escapeHtml(moodText(m) || 'Check-in')}</li>`).join('');
    const dash = day.doordash;
    const badges = [
      day.stomach_pain === null && day.pain_reports.length ? '<span class="signal-badge warn">Pain reported (no score)</span>' : day.stomach_pain !== null ? signalBadge(day.stomach_pain, 'Stomach') : '',
      day.acne !== null ? signalBadge(day.acne, 'Skin') : '',
      day.acne_spots !== null ? `<span class="signal-badge">${plural(day.acne_spots, 'spot')}</span>` : '',
      day.xp !== null ? `<span class="signal-badge">XP ${day.xp}</span>` : '',
      day.bedtime ? `<span class="signal-badge">Bed ${escapeHtml(formatClock(day.bedtime) || day.bedtime)}</span>` : '',
      day.wake_time ? `<span class="signal-badge">Wake ${escapeHtml(formatClock(day.wake_time) || day.wake_time)}</span>` : '',
      day.sleep_hours !== null ? `<span class="signal-badge">Sleep ${day.sleep_hours}h</span>` : '',
      day.headache !== null || day.headache_reports.length ? `<span class="signal-badge">Headache ${day.headache ?? 'reported'}</span>` : '',
      day.mb ? `<span class="signal-badge warn">MB${day.mb > 1 ? ` ×${day.mb}` : ''}${day.mb_events[0]?.at ? ` ${escapeHtml(formatClock(day.mb_events[0].at) || '')}` : ''}</span>` : '',
      day.missed_habits.length ? `<span class="signal-badge">Missed:${escapeHtml(day.missed_habits.map(labelMetric).join(', '))}</span>` : '',
      day.meals_logged ? `<span class="signal-badge">${plural(day.meals_logged, 'meal')}</span>` : '',
      day.habits_done ? `<span class="signal-badge">${plural(day.habits_done, 'habit')}</span>` : '',
      totalActivity(day) ? `<span class="signal-badge">Active ${totalActivity(day)}m</span>` : '',
      day.water !== null ? `<span class="signal-badge">Water ${day.water}</span>` : '',
      dash && (isNum(dash.pay) || isNum(dash.net_profit)) ? `<span class="signal-badge">DoorDash ${isNum(dash.pay) ? `$${Number(dash.pay).toFixed(2)}` : ''}${isNum(dash.net_profit) ? ` · net $${Number(dash.net_profit).toFixed(2)}` : ''}</span>` : '',
      day.shield ? '<span class="signal-badge good" title="Rest day: a sick or recovery day that doesn’t break your streaks">🛌 Rest day · doesn’t break streaks</span>' : ''
    ].filter(Boolean).join('');
    return `<article class="journal-entry"><div class="journal-date"><strong>${Number(day.date.slice(8))}</strong><span>${isoLabel(day.date,{month:'short'})}</span></div><div class="journal-body"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(details)}</p>${lifeNotes || moods ? `<ul class="journal-notes">${moods}${lifeNotes}</ul>` : ''}<div class="journal-signals">${badges}</div></div><span class="trend-pill neutral">${plural(day.event_count, 'event')}</span></article>`;
  }).join('') : '<div class="empty-state">No journal days match your search.</div>';
}

function renderPatterns() {
  const items = connectionItems();
  $('#patterns-grid').innerHTML = items.length ? items.map(item => `<article class="card pattern-card"><div class="pattern-top"><span class="pattern-mark" aria-hidden="true">${item.icon}</span><span class="pattern-strength">${escapeHtml(item.stat)}<small>${escapeHtml(item.statLabel)}</small></span></div><h3>${escapeHtml(labelMetric(item.label))}</h3><p>${escapeHtml(item.detail)}. This is an observation from your MOTION logs, not a medical conclusion.</p>${item.confidence ? `<span class="trend-pill neutral">${escapeHtml(String(item.confidence))} confidence</span>` : ''}</article>`).join('') : `<article class="card pattern-card">${needsDataCard('Keep logging meals, symptoms, sleep and habits.')}</article>`;
}

function updateDataStatus() {
  const connected = state.source === 'api';
  $('#data-badge').textContent = connected ? 'Connected' : LOCAL ? 'Local sample' : 'Offline';
  $('#data-badge').className = `status-badge ${connected ? 'connected' : ''}`;
  $('#data-description').textContent = connected ? 'Live MOTION events interpreted by the dashboard API.' : LOCAL ? 'Local sample days: the dev server could not reach the API.' : 'Could not reach the API.';
  $('#record-count').textContent = state.days.reduce((sum, day) => sum + day.event_count, 0).toLocaleString();
  const dates = state.days.map(day => day.date).sort();
  $('#data-range').textContent = dates.length ? `${shortDate(dates[0])} – ${shortDate(dates.at(-1))}` : '—';
  $('#last-refreshed').textContent = new Date().toLocaleTimeString('en-US', { timeZone:'America/Phoenix', hour:'numeric', minute:'2-digit' });
}

function watchForUpdates() {
  if (!('EventSource' in window)) return;
  const key = API_KEY ? `?key=${encodeURIComponent(API_KEY)}` : '';
  const events = new EventSource(`${API_BASE}/api/events${key}`);
  events.addEventListener('data-updated', () => loadData());
  events.addEventListener('source-error', () => refreshSyncStatus());
  // Free the connection when the page goes away (it reopens on return).
  addEventListener('pagehide', () => events.close());
}

const PANELS = ['overview','homework','acne','stomach','journal','patterns','doordash'];
const TITLES = { homework:'Your study lab', acne:'Your skin story', stomach:'Your gut journal', journal:'Your journal', patterns:'Your patterns', doordash:'Your DoorDash shifts' };
const DOC_TITLES = { overview:'Life', homework:'Study lab', acne:'Acne', stomach:'Stomach', journal:'Journal', patterns:'Patterns', doordash:'DoorDash' };
// Patterns needs about two weeks of history; until then it stays out of the nav.
function updatePatternsNav() {
  const ready = state.days.length >= MIN_PATTERN_DAYS;
  $$('[data-view="patterns"], [data-view-go="patterns"]').forEach(el => { el.hidden = !ready; });
}
function setTitle(name) {
  const h1 = $('.topbar h1');
  h1.childNodes[0].textContent = `${name === 'overview' ? greeting() : TITLES[name] || 'Soma'} `;
  document.title = `${DOC_TITLES[name] || 'Soma'} · Soma`;
}
function showPanel(name) {
  // The old Data tab now lives at the bottom of the journal.
  if (name === 'data') { showPanel('journal'); const details = $('#data-details'); if (details) { details.open = true; setTimeout(() => details.scrollIntoView({ block:'start' }), 50); } return; }
  state.panel = name;
  const dashboard = ['overview','acne','stomach'].includes(name);
  document.body.dataset.dashboard = name;
  $$('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== (dashboard ? 'overview' : name); });
  $$('.nav-item').forEach(item => { const on = item.dataset.view === name; item.classList.toggle('active', on); if (on) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  // Phone tab bar: Body covers Stomach + Acne, More covers Journal + Patterns.
  if (name === 'acne' || name === 'stomach') state.bodyTab = name;
  const tab = name === 'acne' || name === 'stomach' ? 'body' : name === 'journal' || name === 'patterns' ? 'more' : name;
  $$('.tab-item').forEach(item => { const on = item.dataset.tab === tab; item.classList.toggle('active', on); if (on && item.tagName === 'A') item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  const bodyLink = $('.tab-item[data-tab="body"]'); if (bodyLink) bodyLink.href = `#${state.bodyTab}`;
  $$('[data-body]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.body === name)));
  $$('[data-view-go]').forEach(link => { if (link.dataset.viewGo === name) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  closeMoreMenu();
  setTitle(name);
  setPhotosVisible(name === 'acne');
  if (dashboard) {
    state.series.pain = name !== 'acne'; state.series.acne = name === 'acne';
    $$('.legend-item').forEach(button => button.classList.toggle('active', state.series[button.dataset.series]));
    $('.chart-card h2').textContent = name === 'acne' ? 'Skin day by day' : 'Stomach day by day';
    renderSignalsChart();
    renderRecent();
  }
  $('.sidebar').classList.remove('open'); $('.mobile-menu').setAttribute('aria-expanded','false'); window.scrollTo({top:0,behavior:'smooth'});
}
let toastTimer; function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }

function closeMoreMenu() {
  const menu = $('#more-menu'), toggle = $('.tab-item[data-tab="more"]');
  if (menu) menu.hidden = true;
  toggle?.setAttribute('aria-expanded', 'false');
}
function go(name) { showPanel(name); history.replaceState(null, '', `#${name}`); }


function wireInteractions() {
  $$('.tab-item[href]').forEach(item => item.addEventListener('click', event => { event.preventDefault(); go(item.dataset.tab === 'body' ? state.bodyTab : item.dataset.tab); }));
  $('.tab-item[data-tab="more"]')?.addEventListener('click', event => {
    const menu = $('#more-menu'); const open = menu.hidden;
    menu.hidden = !open; event.currentTarget.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('a:not([hidden])')?.focus();
  });
  $$('[data-view-go]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); go(link.dataset.viewGo); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#more-menu')?.hidden) { closeMoreMenu(); $('.tab-item[data-tab="more"]')?.focus(); } });
  document.addEventListener('click', event => { if (!event.target.closest('#more-menu, .tab-item[data-tab="more"]')) closeMoreMenu(); });
  $$('[data-body]').forEach(button => button.addEventListener('click', () => go(button.dataset.body)));
  $('#today-label').textContent = phoenixLabel({ weekday:'long', month:'long', day:'numeric' });
  $$('.nav-item').forEach(item => item.addEventListener('click', event => { event.preventDefault(); showPanel(item.dataset.view); history.replaceState(null, '', `#${item.dataset.view}`); }));
  $$('[data-view-link]').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.viewLink)));
  $('.mobile-menu').addEventListener('click', event => { const open = $('.sidebar').classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); });
  $('#range-select').addEventListener('change', applyRange); $('#refresh-dashboard').addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { await loadData({announce:true}); } finally { button.disabled = false; } }); $('#refresh-data').addEventListener('click', () => loadData({announce:true})); $('#journal-search').addEventListener('input', event => renderJournal(event.target.value));
  $$('.legend-item').forEach(button => button.addEventListener('click', () => { const key = button.dataset.series; state.series[key] = !state.series[key]; button.classList.toggle('active', state.series[key]); renderSignalsChart(); }));
  $('#blueprint-toggle-contrast')?.addEventListener('click', () => {
    const panel = $('#blueprint-contrast-panel');
    if (!panel) return;
    const expanded = panel.hidden;
    panel.hidden = !expanded;
    $('#blueprint-toggle-contrast').setAttribute('aria-expanded', String(expanded));
    const span = $('#blueprint-toggle-contrast span');
    if (span) span.textContent = expanded ? 'Hide best vs hardest days' : 'Best vs hardest days';
  });
  let resizeTimer; let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth === lastWidth) return; lastWidth = window.innerWidth; clearTimeout(resizeTimer); resizeTimer = setTimeout(renderSignalsChart, 150); });
  const initial = location.hash.slice(1); showPanel(PANELS.includes(initial) || initial === 'data' ? initial : 'overview');
}

wireInteractions(); renderAll(); loadData(); watchForUpdates(); startSyncStatus();
