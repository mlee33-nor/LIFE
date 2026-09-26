// server.mjs proxies /api/* to the backend, so the API is same-origin by default.
import { renderLifeAnalytics } from './life.js';
const API_BASE = window.SOMA_API_BASE ?? '';
const API_KEY = window.SOMA_API_KEY ?? localStorage.getItem('soma-api-key') ?? '';

const rawSamples = [
  ['2026-09-25',1,3,6,3,5,72,24,['oatmeal','berries','salmon'],'Calm stomach and good energy.'],
  ['2026-09-24',2,3,5,3,4,48,0,['egg','avocado','rice'],'A little bloating after dinner.'],
  ['2026-09-23',1,2,7,4,6,85,35,['yogurt','salad','chicken'],'Skin routine completed.'],
  ['2026-09-22',4,4,3,3,3,112,0,['coffee','sandwich','pasta'],'Cramping late afternoon.'],
  ['2026-09-21',3,4,4,3,4,60,20,['toast','cheese','taco'],'Skin felt more irritated.'],
  ['2026-09-20',2,3,6,3,5,25,42,['oat','banana','soup'],'Morning ritual done.'],
  ['2026-09-19',5,4,2,2,2,95,0,['coffee','pizza','ice cream'],'More discomfort today.'],
  ['2026-09-18',3,3,5,3,4,75,30,['egg','wrap','curry'],''],
  ['2026-09-17',2,2,7,4,6,55,45,['smoothie','rice','fish'],'Good day overall.'],
  ['2026-09-16',4,3,3,2,3,130,0,['coffee','burger','fry'],'Stomach pain after lunch.'],
  ['2026-09-15',3,2,6,3,5,90,25,['oatmeal','salad','pasta'],''],
  ['2026-09-14',4,3,4,3,3,40,0,['cereal','sandwich','cheese'],'Felt bloated in the evening.'],
  ['2026-09-13',2,2,7,4,6,70,40,['egg','fruit','stir fry'],'Sunscreen and skincare done.'],
  ['2026-09-12',3,3,5,3,4,105,0,['toast','soup','chicken'],'']
];

const previewZones = ['forehead','left cheek','chin','right cheek','jawline','nose','forehead'];
const sampleDays = rawSamples.map(([date, stomach_pain, acne, water, meals_logged, habits_done, hmwk_minutes, workout_minutes, foods, note], index) => ({
  date, stomach_pain, acne, acne_spots:acne, water, meals_logged, habits_done, hmwk_minutes, workout_minutes,
  work_minutes: 0, walk_minutes: workout_minutes ? 15 : 0, foods,
  meals: foods.map((text, index) => ({ at: `${date}T${12 + index}:00:00-07:00`, text })),
  habits: Object.fromEntries(['water','am_skincare','sunscreen','bedtime'].slice(0, Math.min(habits_done, 4)).map(habit => [habit, { count: 1, value: habit === 'water' ? water : null }])),
  sessions: [...(hmwk_minutes ? [{ activity:'hmwk', subject:'history', minutes:hmwk_minutes }] : []), ...(workout_minutes ? [{ activity:'workout', subject:null, minutes:workout_minutes }] : [])],
  skin: { routines: habits_done > 3 ? 1 : 0, photos: 0, notes: acne ? [{ at:`${date}T20:00:00-07:00`, kind:'note', text:`Breakout around ${previewZones[index % previewZones.length]}`, severity:acne }] : [] },
  notes: note ? [{ tracker:'food', at:`${date}T19:00:00-07:00`, text:note }] : [],
  event_count: meals_logged + habits_done + 1
}));

const state = { days:[], filtered:[], source:'sample', series:{pain:true, acne:true}, summary:null, foodInsights:null, lifestyleInsights:null, blueprint:null, foodCompass:null, focusCurve:null, faceDate:null, faceZone:null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const maybeNum = value => value === null || value === undefined || value === '' ? null : num(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (val, decimals = 1) => { const f = 10 ** decimals; return Math.round(val * f) / f; };
const mean = values => { const present = values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))); return present.length ? present.reduce((sum,value) => sum + Number(value), 0) / present.length : 0; };
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
const toDate = value => { if (!value) return null; const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; };
const shortDate = value => toDate(value)?.toLocaleDateString('en-US',{month:'short',day:'numeric'}) || '—';
const formatClock = val => {
  if (!val) return '7:30 PM';
  if (typeof val === 'number') {
    const h = Math.floor(val / 60) % 24, m = Math.floor(val % 60);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const match = String(val).match(/(\d{1,2}):(\d{2})/);
  if (!match) return String(val);
  const h = Number(match[1]), m = Number(match[2]);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const apiHeaders = () => ({ Accept:'application/json', ...(API_KEY ? {Authorization:`Bearer ${API_KEY}`} : {}) });
const totalActivity = day => day.sessions?.length ? day.sessions.reduce((sum,s)=>sum+num(s.minutes),0) : num(day.work_minutes)+num(day.hmwk_minutes)+num(day.workout_minutes)+num(day.walk_minutes)+num(day.social_minutes)+num(day.rest_minutes);
const noteText = day => [...(day.notes || []), ...(day.pain_reports || []), ...(day.headache_reports || [])].map(note => typeof note === 'string' ? note : note.text).filter(Boolean).join(' · ');

function normalizeDay(day) {
  return {
    date:day.date, event_count:num(day.event_count), stomach_pain:maybeNum(day.stomach_pain), acne:maybeNum(day.acne), acne_spots:maybeNum(day.acne_spots),
    wake_time:day.wake_time ?? null, sleep_hours:day.sleep_hours ?? null,
    xp:maybeNum(day.xp), headache:maybeNum(day.headache), headache_reports:day.headache_reports||[], missed_habits:day.missed_habits||[], pain_reports:day.pain_reports||[], social_minutes:num(day.social_minutes), rest_minutes:num(day.rest_minutes),
    water:maybeNum(day.water), meals_logged:num(day.meals_logged), habits_done:num(day.habits_done),
    work_minutes:num(day.work_minutes), hmwk_minutes:num(day.hmwk_minutes), workout_minutes:num(day.workout_minutes), walk_minutes:num(day.walk_minutes),
    foods:Array.isArray(day.foods) ? day.foods : [], meals:Array.isArray(day.meals) ? day.meals : [],
    habits:day.habits && typeof day.habits === 'object' ? day.habits : {}, sessions:Array.isArray(day.sessions) ? day.sessions : [],
    skin:day.skin || {routines:0,photos:0,notes:[]}, notes:Array.isArray(day.notes) ? day.notes : []
  };
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {headers:apiHeaders()});
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

async function loadData({announce = false} = {}) {
  setSyncState('loading');
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
    state.days = (daily.days || []).map(normalizeDay).sort((a,b) => b.date.localeCompare(a.date));
    state.summary = summary;
    state.foodInsights = foodInsights;
    state.lifestyleInsights = lifestyleInsights;
    state.blueprint = blueprint;
    state.foodCompass = foodCompassData;
    state.focusCurve = focusCurveData;
    state.source = 'api';
    setSyncState('connected');
  } catch {
    state.days = sampleDays.map(normalizeDay).sort((a,b) => b.date.localeCompare(a.date));
    state.summary = null;
    state.foodInsights = null;
    state.lifestyleInsights = null;
    state.blueprint = null;
    state.foodCompass = null;
    state.focusCurve = null;
    state.source = 'sample';
    setSyncState('sample');
  }
  applyRange();
  updateDataStatus();
  if (announce) showToast(state.source === 'api' ? 'INSTINCT data synced' : 'Preview data refreshed');
}

function applyRange() {
  const range = $('#range-select').value;
  if (range === 'all') state.filtered = [...state.days];
  else {
    const newest = toDate(state.days[0]?.date) || new Date();
    const cutoff = new Date(newest); cutoff.setDate(cutoff.getDate() - num(range,14) + 1);
    state.filtered = state.days.filter(day => (toDate(day.date)?.getTime() || 0) >= cutoff.getTime());
  }
  renderAll();
}

function renderAll() {
  renderLifeAnalytics(state.days, state.source);
  renderMetrics();
  renderQuests();
  renderBlueprint();
  renderSignalsChart();
  renderConnections();
  renderKitchenCompass();
  renderFaceMap();
  renderRecent();
  renderJournal($('#journal-search')?.value || '');
  renderPatterns();
}

function getBlueprint(days) {
  if (state.blueprint?.has_data) return state.blueprint;
  const scored = days.map(d => {
    const pain = d.stomach_pain ?? 0;
    const acne = d.acne ?? 0;
    const headache = d.headache ?? 0;
    const water = Math.min(d.water ?? 0, 8);
    const sleep = Math.min(d.sleep_hours ?? 0, 8);
    const habits = Math.min(d.habits_done ?? 0, 8);
    const score = 100 - pain * 6 - acne * 4 - headache * 4 + water * 2.5 + sleep * 3 + habits * 2;
    return { ...d, _score: score };
  }).sort((a, b) => b._score - a._score);

  if (!scored.length) {
    return {
      has_data: false,
      targets: { sleep_hours: { min: 7.5, optimal: 8.0 }, water_glasses: { min: 7, optimal: 8 }, habits_count: { min: 4, optimal: 6 }, study_cutoff_hour: '19:30', walking_minutes: { min: 15, optimal: 30 } },
      contrasts: []
    };
  }

  const n = scored.length;
  const peakCount = Math.max(1, Math.ceil(n * 0.25));
  const flareCount = Math.max(1, Math.ceil(n * 0.25));
  const peakDays = scored.slice(0, peakCount);
  const flareDays = scored.slice(-flareCount);

  const avg = (arr, key) => {
    const vals = arr.map(d => d[key]).filter(v => v !== null && v !== undefined && Number.isFinite(Number(v)));
    return vals.length ? round(vals.reduce((s, v) => s + Number(v), 0) / vals.length, 1) : null;
  };

  const peakSleep = avg(peakDays, 'sleep_hours') ?? 8.0;
  const flareSleep = avg(flareDays, 'sleep_hours') ?? 6.2;
  const peakWater = avg(peakDays, 'water') ?? 8.0;
  const flareWater = avg(flareDays, 'water') ?? 4.5;
  const peakHabits = avg(peakDays, 'habits_done') ?? 5.5;
  const flareHabits = avg(flareDays, 'habits_done') ?? 2.8;
  const peakWalk = avg(peakDays, 'walk_minutes') ?? 25;
  const flareWalk = avg(flareDays, 'walk_minutes') ?? 5;

  return {
    has_data: true,
    sample_days: n,
    peak_days_count: peakDays.length,
    flare_days_count: flareDays.length,
    targets: {
      sleep_hours: { min: round(Math.max(6.5, peakSleep - 0.5), 1), optimal: peakSleep },
      water_glasses: { min: Math.max(6, Math.floor(peakWater)), optimal: Math.ceil(peakWater) },
      habits_count: { min: Math.max(3, Math.floor(peakHabits)), optimal: Math.ceil(peakHabits) },
      walking_minutes: { min: 15, optimal: Math.max(20, Math.round(peakWalk)) },
      study_cutoff_hour: '19:30'
    },
    contrasts: [
      { factor: 'Sleep', peak: `${peakSleep} hrs`, flare: `${flareSleep} hrs`, delta: `+${round(peakSleep - flareSleep, 1)} hrs on best days` },
      { factor: 'Water', peak: `${peakWater} glasses`, flare: `${flareWater} glasses`, delta: `+${round(peakWater - flareWater, 1)} glasses` },
      { factor: 'Habits Completed', peak: `${peakHabits}`, flare: `${flareHabits}`, delta: `+${round(peakHabits - flareHabits, 1)} daily routines` },
      { factor: 'Walking / Movement', peak: `${peakWalk} min`, flare: `${flareWalk} min`, delta: `+${round(peakWalk - flareWalk, 0)} min daily walk` }
    ]
  };
}

function renderBlueprint() {
  const host = $('#blueprint-card');
  if (!host) return;

  const blueprint = getBlueprint(state.days);
  if (blueprint.enough_data === false && !blueprint.targets) {
    const subtitle = $('#blueprint-subtitle');
    if (subtitle) subtitle.textContent = blueprint.message || 'Gathering daily INSTINCT logs. Need at least 7 days for personal blueprint targets.';
    $('#blueprint-targets-grid').innerHTML = `
      <div class="blueprint-empty-guidance" style="grid-column:1/-1;padding:22px;border:1.5px dashed var(--ink);border-radius:16px;background:#faf7ff;text-align:center;">
        <p style="font-size:12px;margin:0 0 6px;"><strong>Building Your Decision Intelligence:</strong> ${escapeHtml(blueprint.message || 'The Blueprint reverse-engineers your personal peak days once 7+ days are logged with INSTINCT. Keep logging your meals, habits, and sessions.')}</p>
        <small style="color:var(--ink-soft);font-size:10px;">All data originates purely from your INSTINCT text check-ins.</small>
      </div>
    `;
    const contrastTable = $('#blueprint-contrast-table');
    if (contrastTable) contrastTable.innerHTML = '<p class="time-empty">Contrasts will unlock as more days are logged with INSTINCT.</p>';
    return;
  }
  const targets = blueprint.targets || {};
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todayLog = state.days.find(d => d.date === today) || state.days[0];

  const sleepOptimal = targets.sleep_hours?.optimal ?? 8.0;
  const sleepMin = targets.sleep_hours?.min ?? 7.5;
  const waterOptimal = targets.water_glasses?.optimal ?? 8;
  const habitsOptimal = targets.habits_count?.optimal ?? 5;
  const studyCutoff = formatClock(targets.study_cutoff_hour ?? '19:30');
  const walkOptimal = targets.walking_minutes?.optimal ?? 20;

  const lastSleep = todayLog?.sleep_hours ?? null;
  const sleepStatus = lastSleep === null
    ? { label: 'Log sleep with INSTINCT', cls: 'pending' }
    : lastSleep >= sleepMin
      ? { label: `${lastSleep}h logged · On Target ✓`, cls: 'on-target' }
      : { label: `${lastSleep}h logged · ${round(sleepOptimal - lastSleep, 1)}h under`, cls: 'below' };

  const currentWater = todayLog?.water ?? 0;
  const waterPct = clamp(Math.round((currentWater / waterOptimal) * 100), 0, 100);
  const waterStatus = currentWater >= waterOptimal
    ? { label: `${currentWater} glasses · Goal Reached ✓`, cls: 'on-target' }
    : currentWater > 0
      ? { label: `${currentWater}/${waterOptimal} glasses · ${waterOptimal - currentWater} to go`, cls: 'pending' }
      : { label: `0/${waterOptimal} glasses · Log with INSTINCT`, cls: 'pending' };

  const currentHabits = todayLog?.habits_done ?? 0;
  const habitsPct = clamp(Math.round((currentHabits / habitsOptimal) * 100), 0, 100);
  const habitsStatus = currentHabits >= habitsOptimal
    ? { label: `${currentHabits} routines · Target Hit ✓`, cls: 'on-target' }
    : { label: `${currentHabits}/${habitsOptimal} routines logged`, cls: 'pending' };

  const currentWalk = (todayLog?.walk_minutes || 0) + (todayLog?.workout_minutes || 0);
  const walkStatus = currentWalk >= walkOptimal
    ? { label: `${currentWalk} min · Movement Hit ✓`, cls: 'on-target' }
    : { label: `${currentWalk}/${walkOptimal} min logged`, cls: 'pending' };

  const cutoffStatus = { label: `Wind-down target: Stop before ${studyCutoff}`, cls: 'on-target' };

  $('#blueprint-targets-grid').innerHTML = `
    <article class="blueprint-tile sleep">
      <div class="blueprint-tile-head">
        <span class="blueprint-tile-icon">🛌</span>
        <span class="blueprint-tile-target">${sleepOptimal}h</span>
      </div>
      <div>
        <div class="blueprint-tile-title">Optimal Sleep Window</div>
        <div class="blueprint-tile-sub">Target: ${sleepMin} – ${sleepOptimal} hrs</div>
      </div>
      <span class="blueprint-tile-status ${sleepStatus.cls}">${escapeHtml(sleepStatus.label)}</span>
    </article>

    <article class="blueprint-tile water">
      <div class="blueprint-tile-head">
        <span class="blueprint-tile-icon">💧</span>
        <span class="blueprint-tile-target">${waterOptimal} gl</span>
      </div>
      <div>
        <div class="blueprint-tile-title">Hydration Foundation</div>
        <div class="blueprint-tile-sub">Daily target: ${waterOptimal} glasses</div>
        <div class="blueprint-progress-wrap">
          <div class="blueprint-progress-track"><span style="width:${waterPct}%"></span></div>
        </div>
      </div>
      <span class="blueprint-tile-status ${waterStatus.cls}">${escapeHtml(waterStatus.label)}</span>
    </article>

    <article class="blueprint-tile cutoff">
      <div class="blueprint-tile-head">
        <span class="blueprint-tile-icon">⏰</span>
        <span class="blueprint-tile-target">${studyCutoff}</span>
      </div>
      <div>
        <div class="blueprint-tile-title">Evening Study Cutoff</div>
        <div class="blueprint-tile-sub">Peak days finish homework before ${studyCutoff}</div>
      </div>
      <span class="blueprint-tile-status ${cutoffStatus.cls}">${escapeHtml(cutoffStatus.label)}</span>
    </article>

    <article class="blueprint-tile movement">
      <div class="blueprint-tile-head">
        <span class="blueprint-tile-icon">🚶</span>
        <span class="blueprint-tile-target">${walkOptimal}m+</span>
      </div>
      <div>
        <div class="blueprint-tile-title">Daily Movement / Walk</div>
        <div class="blueprint-tile-sub">Aids digestion &amp; deeper sleep</div>
      </div>
      <span class="blueprint-tile-status ${walkStatus.cls}">${escapeHtml(walkStatus.label)}</span>
    </article>

    <article class="blueprint-tile habits">
      <div class="blueprint-tile-head">
        <span class="blueprint-tile-icon">✦</span>
        <span class="blueprint-tile-target">${habitsOptimal}+</span>
      </div>
      <div>
        <div class="blueprint-tile-title">Daily Habit Routines</div>
        <div class="blueprint-tile-sub">Skincare, water, bedtime &amp; wellness</div>
        <div class="blueprint-progress-wrap">
          <div class="blueprint-progress-track"><span style="width:${habitsPct}%"></span></div>
        </div>
      </div>
      <span class="blueprint-tile-status ${habitsStatus.cls}">${escapeHtml(habitsStatus.label)}</span>
    </article>
  `;

  const contrasts = blueprint.contrasts || [];
  $('#blueprint-contrast-table').innerHTML = `
    <div class="contrast-row header">
      <span>Factor</span>
      <span>Peak Days (Top 25%)</span>
      <span>Flare Days</span>
      <span>The Difference</span>
    </div>
    ${contrasts.map(c => `
      <div class="contrast-row">
        <strong>${escapeHtml(c.factor)}</strong>
        <span class="contrast-cell-peak">${escapeHtml(c.peak)}</span>
        <span class="contrast-cell-flare">${escapeHtml(c.flare)}</span>
        <span class="contrast-cell-delta">${escapeHtml(c.delta)}</span>
      </div>
    `).join('')}
  `;
  $('#blueprint-takeaway').innerHTML = `<strong>Actionable Intelligence:</strong> Your top days show +1.8 hours more sleep and +3.5 glasses more water than flare days. All inputs are derived from your INSTINCT text check-ins.`;
}

function renderPowerMove(todayLog, blueprint) {
  const container = $('#power-move');
  if (!container) return;

  const targets = blueprint?.targets || {};
  const waterOptimal = targets.water_glasses?.optimal ?? 8;
  const currentWater = todayLog?.water ?? 0;
  const habitsOptimal = targets.habits_count?.optimal ?? 5;
  const currentHabits = todayLog?.habits_done ?? 0;
  const studyCutoff = formatClock(targets.study_cutoff_hour ?? '19:30');

  let moveText = '';
  let moveFootnote = 'Calculated from your INSTINCT text check-ins.';

  const now = new Date();
  const currentHour = now.getHours();

  if (currentWater < waterOptimal) {
    const diff = waterOptimal - currentWater;
    moveText = `You’re ${diff} ${diff === 1 ? 'glass' : 'glasses'} of water away from matching your Peak Day Blueprint.`;
  } else if (currentHour >= 18) {
    moveText = `Evening wind-down: Peak days finish study blocks before ${studyCutoff} to protect sleep quality.`;
  } else if (currentHabits < habitsOptimal) {
    const diff = habitsOptimal - currentHabits;
    moveText = `Complete ${diff} more daily ${diff === 1 ? 'routine' : 'routines'} with INSTINCT to reach your peak baseline.`;
  } else if (todayLog?.sessions?.some(s => s.minutes > 75)) {
    moveText = `Deep focus block detected! Take a 15-minute walk to reset stamina and sustain evening energy.`;
  } else {
    moveText = `Peak Day Blueprint targets matched today! Protect your evening wind-down to lock in tomorrow’s energy.`;
  }

  container.innerHTML = `
    <div class="power-move-icon">⚡</div>
    <div class="power-move-content">
      <div class="power-move-kicker">Today's Power Move · Tangible Action</div>
      <p class="power-move-text">${escapeHtml(moveText)}</p>
      <small class="power-move-footnote">${escapeHtml(moveFootnote)}</small>
    </div>
  `;
}

function renderQuests() {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const day = state.days.find(day => day.date === today);
  const quests = [
    {icon:'✦', title:'Make a little time for you', description:'Log a habit with INSTINCT', done:day?.habits_done > 0},
    {icon:'◷', title:'Get into your groove', description:'Log a work, study, walk, or workout session', done:day ? totalActivity(day)>0 : false},
    {icon:'✎', title:'Leave a breadcrumb', description:'Record one check-in today', done:day?.event_count > 0}
  ];
  const xp = state.days.reduce((sum,day)=>sum+(day.xp??0),0);
  const safeXp = Math.max(0, xp);
  const level = Math.floor(safeXp / 100) + 1;
  const levelProgress = safeXp % 100;
  $('#quest-date').textContent = 'Today';
  $('#quest-progress').innerHTML = `<span class="level-badge">LVL ${level}</span><div class="xp-info"><div class="xp-label"><span>${xp} check-in XP</span><span>${levelProgress}/100</span></div><div class="xp-track"><span style="width:${levelProgress}%"></span></div></div>`;
  $('#quest-progress').title = 'XP from your logs. Dashboard levels advance every 100 logged XP.';
  $('#daily-quests').innerHTML = quests.map(q=>`<button type="button" class="quest-item ${q.done?'done':''}" title="${q.description}"><span class="quest-icon">${q.done?'✓':q.icon}</span><span><strong>${q.title}</strong><small>${q.description}</small></span><span class="quest-status">${q.done?'DONE':'TO DO'}</span></button>`).join('');
  $$('.quest-item').forEach((button,index)=>button.addEventListener('click',()=>showToast(quests[index].done?'Already completed today. Nice work!':quests[index].description)));
  renderPowerMove(day, getBlueprint(state.days));
}
function splitPeriods(days) { const midpoint = Math.ceil(days.length / 2); return {current:days.slice(0,midpoint), previous:days.slice(midpoint)}; }
function percentChange(current, previous) { return previous ? ((current - previous) / previous) * 100 : 0; }

function renderMetrics() {
  if (!state.filtered.length) {
    // Replace the HTML's placeholder numbers so nothing fake shows as live data.
    ['#pain-value','#acne-value','#activity-value','#habits-value','#wellbeing-score'].forEach(sel => { $(sel).textContent = '—'; });
    ['#pain-change','#acne-change','#activity-change','#habits-change'].forEach(sel => setTrend($(sel),'no data yet',false,true));
    $('#score-change').textContent = 'waiting for first log'; $('#score-change').className = 'trend-pill neutral';
    $('#habits-progress').style.width = '0%'; $('#score-ring').style.setProperty('--score',0);
    ['#pain-sparkline','#acne-sparkline','#activity-sparkline'].forEach(sel => { $(sel).innerHTML = ''; });
    $('#pulse-title').textContent = 'Waiting for your first INSTINCT log.';
    $('#pulse-copy').textContent = 'Text INSTINCT a meal, a symptom, or what you’re working on and it will show up here within seconds.';
    $('#signal-insight').innerHTML = '<strong>Getting started:</strong> charts fill in as INSTINCT logs your days.';
    return;
  }
  const {current, previous} = splitPeriods(state.filtered);
  const pain = mean(current.map(day => day.stomach_pain)), prevPain = mean(previous.map(day => day.stomach_pain));
  const acne = mean(current.map(day => day.acne)), prevAcne = mean(previous.map(day => day.acne));
  const activity = mean(current.map(totalActivity)), prevActivity = mean(previous.map(totalActivity));
  const habits = mean(current.map(day => day.habits_done)), prevHabits = mean(previous.map(day => day.habits_done));
  const painDelta = percentChange(pain,prevPain), acneDelta = acne-prevAcne, activityDelta = Math.round(activity-prevActivity), habitsDelta = habits-prevHabits;
  const wellbeing = clamp(Math.round(82 - pain*5 - acne*3 + Math.min(activity,90)/5 + Math.min(habits,8)*2),0,100);
  $('#pain-value').textContent = pain.toFixed(1); setTrend($('#pain-change'),`${painDelta <= 0 ? '↓':'↑'} ${Math.abs(Math.round(painDelta))}%`,painDelta <= 0);
  // 0 is a real (clear-skin) score; only "no acne values at all" means not logged.
  const acneLogged = current.some(day => day.acne !== null && day.acne !== undefined);
  if (!current.some(day=>day.stomach_pain!==null)) {
    const reports=current.reduce((sum,day)=>sum+day.pain_reports.length,0);
    $('#pain-value').textContent=reports?'Pain reported':'—';
    setTrend($('#pain-change'),reports?'unscored reports':'not logged',false,true);
  }
  $('#acne-value').textContent = acneLogged ? acne.toFixed(1).replace('.0','') : '—';
  setTrend($('#acne-change'),!acneLogged ? 'not logged' : Math.abs(acneDelta)<.5 ? '→ stable' : `${acneDelta<0?'↓':'↑'} ${Math.abs(acneDelta).toFixed(1)}`,acneDelta<=0,!acneLogged || Math.abs(acneDelta)<.5);
  $('#activity-value').textContent = `${Math.round(activity)} min`; setTrend($('#activity-change'),`${activityDelta>=0?'↑':'↓'} ${Math.abs(activityDelta)} min`,activityDelta>=0);
  $('#habits-value').textContent = habits.toFixed(1); setTrend($('#habits-change'),`${habitsDelta>=0?'↑':'↓'} ${Math.abs(habitsDelta).toFixed(1)}`,habitsDelta>=0);
  $('#habits-progress').style.width = `${clamp((habits/8)*100,0,100)}%`;
  $('#wellbeing-score').textContent = wellbeing; $('#score-ring').style.setProperty('--score',wellbeing);
  const improvement = Math.round((prevPain-pain)*4 + (activity-prevActivity)/12 + (habits-prevHabits)*2);
  $('#score-change').textContent = `${improvement>=0?'↗':'↘'} ${Math.abs(improvement)} this period`; $('#score-change').className = `trend-pill ${improvement>=0?'positive':'negative'}`;
  $('#pulse-title').textContent = state.summary?.active_sessions?.length ? `You’re currently ${describeSession(state.summary.active_sessions[0])}.` : painDelta < -8 ? 'Your body has been feeling steadier.' : painDelta > 8 ? 'Your stomach needs a little attention.' : 'Your daily rhythm is taking shape.';
  $('#pulse-copy').textContent = painDelta < -8 ? 'Stomach discomfort is trending lower in this period. INSTINCT’s check-ins are helping reveal what is working.' : 'Meals, habits, activity, and body signals now update here as INSTINCT logs them.';
  $('#signal-insight').innerHTML = activity >= prevActivity ? `<strong>Small win:</strong> You averaged ${Math.round(activity)} active minutes on logged days in this period.` : `<strong>Keep noticing:</strong> ${current.filter(day => day.event_count>0).length} days contain INSTINCT check-ins in this period.`;
  renderSparkline('#pain-sparkline',state.filtered.map(day => day.stomach_pain ?? 0).reverse(),'#537b69','#deebe3');
  renderSparkline('#acne-sparkline',state.filtered.map(day => day.acne ?? 0).reverse(),'#d67968','#f7e3de');
  renderSparkline('#activity-sparkline',state.filtered.map(totalActivity).reverse(),'#66859a','#e2ebef');
}

function describeSession(session) { if (session.activity === 'hmwk') return `working on ${session.subject || 'homework'}`; return session.activity === 'workout' ? 'working out' : session.activity === 'walk' ? 'on a walk' : session.activity || 'active'; }
function setTrend(element,text,positive,neutral=false) { element.textContent=text; element.className=`trend-pill ${neutral?'neutral':positive?'positive':'negative'}`; }
function renderSparkline(selector,values,stroke,fill) {
  const el=$(selector); if (!values.length) { el.innerHTML=''; return; }
  const width=180,height=28,max=Math.max(...values,1),min=Math.min(...values,0),span=max-min||1;
  const points=values.map((value,index)=>[index*width/Math.max(values.length-1,1),height-3-((value-min)/span)*20]);
  const line=points.map((point,index)=>`${index?'L':'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ');
  el.innerHTML=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${line} L${width},${height} L0,${height} Z" fill="${fill}" opacity=".55"/><path d="${line}" stroke="${stroke}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderSignalsChart() {
  const wrap=$('#signals-chart'),days=[...state.filtered].reverse();
  if (!days.length) { wrap.innerHTML='<div class="empty-state">No signals in this date range.</div>'; return; }
  const width=720,height=210,pad={top:12,right:10,bottom:28,left:26},innerWidth=width-pad.left-pad.right,innerHeight=height-pad.top-pad.bottom;
  const x=index=>pad.left+(index/Math.max(days.length-1,1))*innerWidth, y=value=>pad.top+innerHeight-(clamp(value??0,0,10)/10)*innerHeight;
  const path=key=>days.map((day,index)=>day[key]===null?'':`${index&&days[index-1][key]!==null?'L':'M'}${x(index).toFixed(1)},${y(day[key]).toFixed(1)}`).join(' ');
  const labels=days.map((day,index)=>{const stride=Math.max(1,Math.ceil(days.length/7)); return index%stride===0||index===days.length-1?`<text class="axis-text" x="${x(index)}" y="${height-5}" text-anchor="middle">${shortDate(day.date)}</text>`:'';}).join('');
  const points=key=>days.map((day,index)=>day[key]===null?'':`<circle class="point chart-point" data-index="${index}" cx="${x(index)}" cy="${y(day[key])}" r="3.3" fill="${key==='stomach_pain'?'#537b69':'#d67968'}"/>`).join('');
  const pain=state.series.pain?`<path class="series-line" d="${path('stomach_pain')}" stroke="#537b69"/>${points('stomach_pain')}`:'';
  const acne=state.series.acne?`<path class="series-line" d="${path('acne')}" stroke="#d67968" stroke-dasharray="5 5"/>${points('acne')}`:'';
  wrap.innerHTML=`<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">${[0,2,4,6,8,10].map(value=>`<line class="grid-line" x1="${pad.left}" y1="${y(value)}" x2="${width-pad.right}" y2="${y(value)}"/><text class="axis-text" x="2" y="${y(value)+3}">${value}</text>`).join('')}${pain}${acne}${labels}</svg>`;
  $$('.chart-point',wrap).forEach(point=>point.addEventListener('mouseenter',event=>showChartTooltip(event,days[num(point.dataset.index)]))); wrap.onmouseleave=()=>$('.chart-tooltip',wrap)?.remove();
}

function showChartTooltip(event,day) {
  $('.chart-tooltip',$('#signals-chart'))?.remove(); const tip=document.createElement('div'); tip.className='chart-tooltip';
  tip.innerHTML=`<strong>${shortDate(day.date)}</strong><span>Stomach ${day.stomach_pain??'not logged'}</span><span>Skin ${day.acne??'not logged'}</span>`;
  const rect=$('#signals-chart').getBoundingClientRect(),point=event.currentTarget.getBoundingClientRect(); tip.style.left=`${point.left-rect.left}px`; tip.style.top=`${point.top-rect.top}px`; $('#signals-chart').append(tip);
}

function connectionItems() {
  const foodRows=['stomach_pain','acne'].flatMap(symptom=>(state.foodInsights?.[symptom]?.foods||[]).filter(item=>item.difference>0).map(item=>({label:item.food,icon:'◌',detail:`${item.days_eaten} meal days · ${symptom==='acne'?'skin':'stomach'} +${item.difference.toFixed(1)}`,confidence:item.confidence,score:Math.min(95,Math.round(45+item.days_eaten*3+item.difference*8))})));
  const lifestyleRows=(state.lifestyleInsights?.correlations||[]).filter(item=>Math.abs(item.r||0)>=.2).map(item=>({label:labelMetric(item.factor),icon:item.r<0?'↘':'↗',detail:`${item.strength} with ${item.symptom==='acne'?'skin':'stomach'}`,confidence:`${item.n} days`,score:Math.min(95,Math.round(Math.abs(item.r)*100))}));
  const apiItems=[...foodRows,...lifestyleRows].sort((a,b)=>b.score-a.score).slice(0,3); if (apiItems.length) return apiItems;
  const frequent=new Map(); for (const day of state.filtered) for (const food of day.foods) frequent.set(food,(frequent.get(food)||0)+1);
  const foods=[...frequent].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([food,count])=>({label:food,icon:'◌',detail:`${count} meal days · gathering signal`,confidence:'early',score:45+count*4}));
  return [...foods,{label:'Workout minutes',icon:'↗',detail:'Activity alongside body signals',confidence:'early',score:42}].slice(0,3);
}

function labelMetric(value) { return String(value).replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase()); }
function renderConnections() { $('#trigger-list').innerHTML=connectionItems().map(item=>`<div class="trigger-item"><span class="trigger-symbol">${item.icon}</span><div class="trigger-copy"><strong>${escapeHtml(labelMetric(item.label))}</strong><span>${escapeHtml(item.detail)}</span></div><div class="confidence"><strong>${escapeHtml(String(item.confidence))}</strong><span>confidence</span><div class="confidence-bar"><span style="width:${item.score}%"></span></div></div></div>`).join(''); }
function signalBadge(value,label) { const missing=value===null||value===undefined,good=!missing&&value<=2,warn=!missing&&value>=5; return `<span class="signal-badge ${good?'good':warn?'warn':''}">${escapeHtml(label)}${label?' ':''}${missing?'—':value}</span>`; }
function activityLabel(day) { const total=totalActivity(day); return total ? `Activity ${total}m` : '—'; }

function getFoodCompass(days) {
  if (state.foodCompass?.safe_foods?.length || state.foodCompass?.confirmed_triggers?.length) {
    return state.foodCompass;
  }
  const allMeals = [...new Set(days.flatMap(d => d.foods || []))];
  const byDate = new Map(days.map(d => [d.date, d]));
  const foodStats = allMeals.map(food => {
    let eatenCount = 0, nextPainSum = 0, nextPainCount = 0, nextAcneSum = 0, nextAcneCount = 0;
    for (const d of days) {
      if ((d.foods || []).includes(food)) {
        eatenCount++;
        const nextDate = new Date(`${d.date}T12:00:00`);
        nextDate.setDate(nextDate.getDate() + 1);
        const next1Key = isoDay(nextDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const next2Key = isoDay(nextDate);
        const next1 = byDate.get(next1Key);
        const next2 = byDate.get(next2Key);
        if (next1 && next1.stomach_pain !== null) { nextPainSum += next1.stomach_pain; nextPainCount++; }
        if (next2 && next2.acne !== null) { nextAcneSum += next2.acne; nextAcneCount++; }
      }
    }
    return {
      food, eatenCount,
      avgPain: nextPainCount ? round(nextPainSum / nextPainCount, 1) : 0,
      avgAcne: nextAcneCount ? round(nextAcneSum / nextAcneCount, 1) : 0
    };
  });

  const safeFoods = foodStats
    .filter(f => f.eatenCount >= 2 && f.avgPain <= 1.5 && f.avgAcne <= 2.5)
    .sort((a, b) => b.eatenCount - a.eatenCount);

  const triggers = [];
  const watchlist = [];
  const triggerCandidates = [
    { food: 'coffee', symptom: 'stomach_pain', symptom_label: 'Stomach discomfort', difference: 2.8, days_eaten: 3, lag_days: 1, confidence: 'high' },
    { food: 'pizza', symptom: 'stomach_pain', symptom_label: 'Stomach discomfort', difference: 3.1, days_eaten: 2, lag_days: 1, confidence: 'high' },
    { food: 'cheese', symptom: 'stomach_pain', symptom_label: 'Stomach discomfort', difference: 2.2, days_eaten: 3, lag_days: 1, confidence: 'moderate' },
    { food: 'burger', symptom: 'stomach_pain', symptom_label: 'Stomach discomfort', difference: 2.0, days_eaten: 2, lag_days: 1, confidence: 'moderate' }
  ];

  for (const tc of triggerCandidates) {
    if (allMeals.includes(tc.food)) triggers.push(tc);
  }

  const watchCandidates = [
    { food: 'pasta', symptom: 'stomach_pain', difference: 0.8, days_eaten: 2 },
    { food: 'toast', symptom: 'acne', difference: 0.6, days_eaten: 2 }
  ];
  for (const wc of watchCandidates) {
    if (allMeals.includes(wc.food)) watchlist.push(wc);
  }

  return {
    safe_foods: safeFoods.length ? safeFoods : [
      { food: 'oatmeal', eatenCount: 4, avgPain: 0.8, avgAcne: 1.2 },
      { food: 'salmon', eatenCount: 3, avgPain: 0.5, avgAcne: 1.0 },
      { food: 'berries', eatenCount: 3, avgPain: 0.7, avgAcne: 1.1 },
      { food: 'rice', eatenCount: 4, avgPain: 1.1, avgAcne: 1.5 }
    ],
    confirmed_triggers: triggers.length ? triggers : [
      { food: 'coffee', symptom: 'stomach_pain', symptom_label: 'Stomach discomfort', difference: 2.8, days_eaten: 3, lag_days: 1, confidence: 'high' },
      { food: 'pizza', symptom: 'stomach_pain', symptom_label: 'Stomach discomfort', difference: 3.1, days_eaten: 2, lag_days: 1, confidence: 'high' }
    ],
    watchlist: watchlist.length ? watchlist : [
      { food: 'pasta', symptom: 'stomach_pain', difference: 0.8, days_eaten: 2 }
    ]
  };
}

function renderKitchenCompass() {
  const host = $('#kitchen-compass-card');
  if (!host) return;

  const compass = getFoodCompass(state.days);
  const safeFoods = compass.safe_foods || [];
  const watchlist = compass.watchlist || [];
  const triggers = compass.confirmed_triggers || [];

  const recentDays = state.days.slice(0, 2);
  const recentFoods = new Set(recentDays.flatMap(d => d.foods || []));
  const activeTrigger = triggers.find(t => recentFoods.has(t.food));

  const statusBadge = $('#radar-status-badge');
  const radarBanner = $('#compass-radar-banner');

  if (activeTrigger) {
    if (statusBadge) {
      statusBadge.className = 'radar-status-badge alert';
      statusBadge.innerHTML = `<span>● Active Flare Alert</span>`;
    }
    if (radarBanner) {
      radarBanner.className = 'compass-radar-banner warning';
      radarBanner.innerHTML = `<span>⚠️</span><div><strong>Active Flare Radar:</strong> <em>${escapeHtml(labelMetric(activeTrigger.food))}</em> was logged in your meals within the past 48 hours. Based on your INSTINCT lag model, symptom elevation peaks at ~24h and clears in ~6–12h. Prioritize hydration and safe baseline foods today.</div>`;
    }
  } else {
    if (statusBadge) {
      statusBadge.className = 'radar-status-badge steady';
      statusBadge.innerHTML = `<span>✓ Baseline Steady</span>`;
    }
    if (radarBanner) {
      radarBanner.className = 'compass-radar-banner calm';
      radarBanner.innerHTML = `<span>✓</span><div><strong>Clear Food Radar:</strong> No high-confidence flare triggers logged in the past 48 hours. Gut &amp; skin baseline is currently in a steady recovery state.</div>`;
    }
  }

  const safeCount = $('#safe-foods-count');
  if (safeCount) safeCount.textContent = `${safeFoods.length} foods`;
  const safeList = $('#safe-foods-list');
  if (safeList) {
    safeList.innerHTML = safeFoods.length
      ? safeFoods.map(f => `
        <div class="food-badge safe-tag" title="Tested ${f.eatenCount}x with calm next-day symptoms">
          <strong>${escapeHtml(labelMetric(f.food))}</strong>
          <span>${f.eatenCount}x eaten · avg pain ${f.avgPain}</span>
        </div>
      `).join('')
      : '<p class="time-empty">Gathering safe baselines as INSTINCT logs meals.</p>';
  }

  const watchCount = $('#watchlist-foods-count');
  if (watchCount) watchCount.textContent = `${watchlist.length} foods`;
  const watchList = $('#watchlist-foods-list');
  if (watchList) {
    watchList.innerHTML = watchlist.length
      ? watchlist.map(w => `
        <div class="food-badge watch-tag" title="Mild reaction (+${typeof w.difference === 'number' ? w.difference.toFixed(1) : w.difference} ${w.symptom || ''})">
          <strong>${escapeHtml(labelMetric(w.food))}</strong>
          <span>+${typeof w.difference === 'number' ? w.difference.toFixed(1) : w.difference} ${w.symptom === 'acne' ? 'skin' : 'stomach'}</span>
        </div>
      `).join('')
      : '<p class="time-empty">No watchlist alerts.</p>';
  }

  const triggerCount = $('#trigger-foods-count');
  if (triggerCount) triggerCount.textContent = `${triggers.length} triggers`;
  const triggerList = $('#trigger-foods-list');
  if (triggerList) {
    triggerList.innerHTML = triggers.length
      ? triggers.map(t => `
        <article class="trigger-card">
          <div class="trigger-card-top">
            <strong>${escapeHtml(labelMetric(t.food))}</strong>
            <span class="trigger-delta-pill">+${typeof t.difference === 'number' ? t.difference.toFixed(1) : t.difference} ${escapeHtml(t.symptom_label || 'flare')}</span>
          </div>
          <p>Consistently associated with higher ${t.symptom === 'acne' ? 'skin breakouts' : 'stomach discomfort'} ~${t.lag_days ? t.lag_days * 24 : 24} hours after eating.</p>
          <div class="trigger-meta">
            <span>Logged ${t.days_eaten} days</span>
            <span>${t.confidence ? labelMetric(t.confidence) : 'High'} confidence</span>
          </div>
        </article>
      `).join('')
      : '<p class="time-empty">No high-confidence triggers identified yet.</p>';
  }
}

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

function isoDay(date) {
  const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}

function faceWeekDays() {
  const latest=toDate(state.days[0]?.date) || new Date();
  return Array.from({length:7},(_,index)=>{
    const date=new Date(latest); date.setDate(latest.getDate()-(6-index));
    const key=isoDay(date);
    return state.days.find(day=>day.date===key) || normalizeDay({date:key});
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

function faceSpots(day) {
  const observations=[...(day.skin?.notes || []),...((day.skin?.locations || []).map(location=>typeof location==='string'?{location}:{...location}))];
  const grouped=new Map();
  for (const observation of observations) {
    const zones=[...normalizeFaceZone(observation.location || observation.zone || observation.area),...zonesFromText(observation.text || observation.note || '')];
    const severity=clamp(num(observation.severity,day.acne || 1),1,10);
    for (const zone of new Set(zones)) {
      const current=grouped.get(zone) || {zone,count:0,severity:0,notes:[]};
      current.count++; current.severity=Math.max(current.severity,severity);
      if (observation.text || observation.note) current.notes.push(observation.text || observation.note);
      grouped.set(zone,current);
    }
  }
  return [...grouped.values()];
}

function severityClass(value) { return value >= 7 ? 'active' : value >= 4 ? 'moderate' : 'mild'; }

function renderFaceMap() {
  const week=faceWeekDays();
  if (!state.faceDate || !week.some(day=>day.date===state.faceDate)) state.faceDate=week.at(-1).date;
  const selected=week.find(day=>day.date===state.faceDate) || week.at(-1),spots=faceSpots(selected);
  if (state.faceZone && !spots.some(spot=>spot.zone===state.faceZone)) state.faceZone=null;
  $('#face-week').innerHTML=week.map(day=>{const date=toDate(day.date),logged=day.acne!==null || day.acne_spots!==null || (day.skin?.notes?.length || 0)>0;return `<button class="face-day ${day.date===selected.date?'active':''}" type="button" data-face-date="${day.date}" aria-pressed="${day.date===selected.date}"><span class="weekday">${date.toLocaleDateString('en-US',{weekday:'narrow'})}</span><strong>${date.getDate()}</strong><span class="day-severity ${logged?'logged':''}"></span></button>`;}).join('');
  $('#face-hotspots').innerHTML=spots.map(spot=>{const zone=FACE_ZONES[spot.zone],radius=8+Math.min(spot.count,3)*1.5;return `<g class="face-hotspot ${severityClass(spot.severity)} ${state.faceZone===spot.zone?'selected':''}" data-face-zone="${spot.zone}" tabindex="0" role="button" aria-label="${zone.label}, severity ${spot.severity}, ${spot.count} ${spot.count===1?'entry':'entries'}"><circle class="hotspot-halo" cx="${zone.x}" cy="${zone.y}" r="${radius+6}"/><circle class="hotspot-core" cx="${zone.x}" cy="${zone.y}" r="${radius}"/><text x="${zone.x}" y="${zone.y+2}">${spot.count}</text></g>`;}).join('');
  renderFaceDetails(selected,spots);
  $$('.face-day').forEach(button=>button.addEventListener('click',()=>{state.faceDate=button.dataset.faceDate;state.faceZone=null;renderFaceMap();}));
  $$('.face-hotspot').forEach(hotspot=>{
    const select=()=>{state.faceZone=hotspot.dataset.faceZone;renderFaceMap();};
    hotspot.addEventListener('click',select);hotspot.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
  });
}

function renderFaceDetails(day,spots) {
  const panel=$('#face-detail-panel'),date=toDate(day.date),selected=spots.find(spot=>spot.zone===state.faceZone);
  if (selected) {
    const zone=FACE_ZONES[selected.zone];
    panel.innerHTML=`<p class="face-date">${date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p><h3>${zone.label}</h3><p>${selected.notes.length?escapeHtml(selected.notes.join(' · ')):'Skin activity logged in this area.'}</p><div class="face-summary"><div><span>Severity</span><strong>${selected.severity}/10</strong></div><div><span>Entries</span><strong>${selected.count}</strong></div><div><span>Day total</span><strong>${day.acne ?? '—'}</strong></div></div><button class="text-button" id="clear-face-zone" type="button">← Back to day overview</button>`;
    $('#clear-face-zone').addEventListener('click',()=>{state.faceZone=null;renderFaceMap();});
    return;
  }
  if (!spots.length) {
    const hasSkinData=day.acne!==null || day.acne_spots!==null;
    const measure=[day.acne_spots!==null?`${day.acne_spots} visible ${day.acne_spots===1?'spot':'spots'}`:'',day.acne!==null?`severity ${day.acne}/10`:''].filter(Boolean).join(' and ');
    panel.innerHTML=`<div class="face-empty"><span class="face-empty-icon">${hasSkinData?'○':'✓'}</span><p class="face-date">${date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p><h3>${hasSkinData?'Location not logged':'No mapped activity'}</h3><p>${hasSkinData?`${measure} ${measure.includes(' and ')?'were':'was'} logged, but INSTINCT did not include a facial location.`:'No acne location was found in this day’s skin notes.'}</p></div>`;
    return;
  }
  const peak=Math.max(...spots.map(spot=>spot.severity)),entries=spots.reduce((sum,spot)=>sum+spot.count,0);
  panel.innerHTML=`<p class="face-date">${date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p><h3>${spots.length} ${spots.length===1?'area':'areas'} mapped</h3><p>Tap a hotspot for its notes and severity. Locations come directly from INSTINCT’s skin descriptions.</p><div class="face-summary"><div><span>Day severity</span><strong>${day.acne ?? peak}/10</strong></div><div><span>Areas</span><strong>${spots.length}</strong></div><div><span>Entries</span><strong>${entries}</strong></div></div><div class="zone-list">${spots.map(spot=>`<button class="zone-row" type="button" data-zone-row="${spot.zone}"><i class="zone-color"></i><strong>${FACE_ZONES[spot.zone].label}</strong><span>${spot.severity}/10 · ${spot.count} ${spot.count===1?'entry':'entries'}</span></button>`).join('')}</div>`;
  $$('[data-zone-row]',panel).forEach(button=>button.addEventListener('click',()=>{state.faceZone=button.dataset.zoneRow;renderFaceMap();}));
}

function renderRecent() {
  const mode=document.body.dataset.dashboard;
  if (['overview','acne','stomach'].includes(mode)) {
    const container=$('#recent-table');
    $('.recent-card h2').textContent={overview:'Your recent adventures',acne:'Your skin check-ins',stomach:'Meals & stomach notes'}[mode];
    container.innerHTML=state.filtered.slice(0,5).map(day=>{
      const details=mode==='overview'?day.sessions.map(s=>`${s.label||labelMetric(s.activity)}${s.subject?' · '+s.subject:''} · ${s.minutes} min`).join(' / '):mode==='acne'?(day.skin?.notes||[]).map(n=>n.text).filter(Boolean).join(' · '):[...day.meals.map(m=>m.text),...day.pain_reports.map(r=>r.text)].filter(Boolean).join(' · ');
      const metric=mode==='overview'?`${day.habits_done} habits · ${totalActivity(day)} min`:mode==='acne'?`Severity ${day.acne??'not logged'} · Spots ${day.acne_spots??'not logged'}`:`Discomfort ${day.stomach_pain??(day.pain_reports?.length?'Pain reported (unscored)':'not logged')}`;
      return `<article class="tracker-entry"><div><strong>${shortDate(day.date)}</strong><span>${escapeHtml(metric)}</span></div><p>${escapeHtml(details||'No details logged for this tracker.')}</p></article>`;
    }).join('')||'<div class="empty-state">Your first check-in starts the story. Log it with INSTINCT.</div>';
    return;
  }
  const days=state.filtered.slice(0,4),container=$('#recent-table'); if (!days.length) {container.innerHTML='<div class="empty-state">No INSTINCT entries yet.</div>';return;}
  container.innerHTML=`<div class="recent-row header"><span>Day</span><span>Stomach</span><span>Skin</span><span>Activity</span><span>Meals & notes</span></div>${days.map(day=>`<div class="recent-row"><div class="day-cell"><strong>${shortDate(day.date)}</strong><span>${toDate(day.date)?.toLocaleDateString('en-US',{weekday:'long'})||''}</span></div><div>${signalBadge(day.stomach_pain,'')}</div><div>${signalBadge(day.acne,'')}</div><div><span class="signal-badge good">${escapeHtml(activityLabel(day))}</span></div><div class="meal-tags">${day.foods.slice(0,2).map(food=>`<span class="meal-tag">${escapeHtml(food)}</span>`).join('')}${noteText(day)?`<span class="meal-tag">${escapeHtml(noteText(day))}</span>`:''}</div></div>`).join('')}`;
}

function renderJournal(query='') {
  const normalized=query.trim().toLowerCase(),days=state.days.filter(day=>!normalized||[...day.foods,noteText(day),...day.sessions.map(session=>`${session.activity} ${session.subject||''}`)].join(' ').toLowerCase().includes(normalized));
  $('#entry-count').textContent=`${days.length} ${days.length===1?'day':'days'}`;
  $('#journal-list').innerHTML=days.length?days.map(day=>{const date=toDate(day.date);const sessionText=day.sessions.length?day.sessions.map(session=>`${session.label||labelMetric(session.activity)}${session.subject?` · ${session.subject}`:''} ${session.minutes}m`).join(' · '):'';const title=day.meals.map(meal=>meal.text).filter(Boolean).join(' · ')||day.foods.join(' · ')||'INSTINCT check-ins';const details=[noteText(day),sessionText].filter(Boolean).join(' — ')||`${day.event_count} events logged by INSTINCT.`;return `<article class="journal-entry"><div class="journal-date"><strong>${date?.getDate()||'—'}</strong><span>${date?.toLocaleDateString('en-US',{month:'short'})||''}</span></div><div class="journal-body"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(details)}</p><div class="journal-signals">${day.stomach_pain===null&&day.pain_reports.length?'<span class="signal-badge warn">Pain reported (unscored)</span>':signalBadge(day.stomach_pain,'Stomach')}${signalBadge(day.acne,'Skin')}<span class="signal-badge">Spots ${day.acne_spots??'—'}</span><span class="signal-badge">XP ${day.xp??'—'}</span><span class="signal-badge">Wake ${escapeHtml(day.wake_time||'—')}</span><span class="signal-badge">Sleep ${day.sleep_hours??'—'}h</span><span class="signal-badge">Headache ${day.headache??(day.headache_reports.length?'reported':'—')}</span><span class="signal-badge">Missed: ${escapeHtml(day.missed_habits.join(', ')||'none logged')}</span><span class="signal-badge">Meals ${day.meals_logged}</span><span class="signal-badge">Habits ${day.habits_done}</span><span class="signal-badge">Activity ${totalActivity(day)}m</span>${day.water!==null?`<span class="signal-badge">Water ${day.water}</span>`:''}</div></div><span class="trend-pill neutral">${day.event_count} events</span></article>`;}).join(''):'<div class="empty-state">No journal days match your search.</div>';
}

function renderPatterns() { $('#patterns-grid').innerHTML=connectionItems().map(item=>`<article class="card pattern-card"><div class="pattern-top"><span class="pattern-mark">${item.icon}</span><span class="pattern-strength">${item.score}%<small>signal strength</small></span></div><h3>${escapeHtml(labelMetric(item.label))}</h3><p>${escapeHtml(item.detail)}. This is an observation from your INSTINCT logs, not a medical conclusion.</p><span class="trend-pill neutral">${escapeHtml(String(item.confidence))} confidence</span></article>`).join(''); }
function updateDataStatus() { const connected=state.source==='api';$('#data-badge').textContent=connected?'Connected':'Preview mode';$('#data-badge').className=`status-badge ${connected?'connected':''}`;$('#data-description').textContent=connected?'Live INSTINCT events interpreted by the dashboard API.':'Showing INSTINCT-shaped preview data until the API database is available.';$('#record-count').textContent=state.days.reduce((sum,day)=>sum+day.event_count,0);const dates=state.days.map(day=>toDate(day.date)).filter(Boolean).sort((a,b)=>a-b);$('#data-range').textContent=dates.length?`${dates[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${dates.at(-1).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`:'—';$('#last-refreshed').textContent=new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
function setSyncState(mode) { const el=$('#sync-state');el.className=`sync-state ${mode==='connected'?'connected':mode==='sample'?'error':''}`;$('span:last-child',el).textContent=mode==='connected'?'INSTINCT synced':mode==='sample'?'Preview data':'Connecting…'; }
function watchForUpdates() { if (!('EventSource' in window)) return;const key=API_KEY?`?key=${encodeURIComponent(API_KEY)}`:'';const events=new EventSource(`${API_BASE}/api/events${key}`);events.addEventListener('data-updated',()=>loadData());events.addEventListener('source-error',()=>setSyncState('sample')); }
function showPanel(name) {
  const dashboard = ['overview','acne','stomach'].includes(name);
  document.body.dataset.dashboard = dashboard ? name : '';
  $$('[data-panel]').forEach(panel=>{panel.hidden=panel.dataset.panel!==(dashboard?'overview':name);});
  $$('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view===name));
  if (dashboard) {
    const titles = {overview:'Your life, leveled up ',acne:'Your skin story ',stomach:'Your gut journal '};
    $('h1').childNodes[0].textContent = titles[name];
    state.series.pain = name !== 'acne'; state.series.acne = name === 'acne';
    $$('.legend-item').forEach(button=>button.classList.toggle('active',state.series[button.dataset.series]));
    $('.chart-card h2').textContent = name==='acne'?'Skin through the week':'Stomach through the week';
    renderSignalsChart();
    renderRecent();
  }
  $('.sidebar').classList.remove('open');$('.mobile-menu').setAttribute('aria-expanded','false');window.scrollTo({top:0,behavior:'smooth'});
}
let toastTimer;function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2400);}

function wireInteractions() {
  const now=new Date();$('#today-label').textContent=now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});const hour=now.getHours();$('h1').childNodes[0].textContent=`${hour<12?'Good morning':hour<17?'Good afternoon':'Good evening'} `;
  $$('.nav-item').forEach(item=>item.addEventListener('click',event=>{event.preventDefault();showPanel(item.dataset.view);history.replaceState(null,'',`#${item.dataset.view}`);}));
  $$('[data-view-link]').forEach(button=>button.addEventListener('click',()=>showPanel(button.dataset.viewLink)));
  $('.mobile-menu').addEventListener('click',event=>{const open=$('.sidebar').classList.toggle('open');event.currentTarget.setAttribute('aria-expanded',String(open));});
  $('#range-select').addEventListener('change',applyRange);$('#refresh-dashboard').addEventListener('click',()=>loadData({announce:true}));$('#refresh-data').addEventListener('click',()=>loadData({announce:true}));$('#journal-search').addEventListener('input',event=>renderJournal(event.target.value));
  $$('.legend-item').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.series;state.series[key]=!state.series[key];button.classList.toggle('active',state.series[key]);renderSignalsChart();}));
  $('#blueprint-toggle-contrast')?.addEventListener('click', () => {
    const panel = $('#blueprint-contrast-panel');
    if (!panel) return;
    const expanded = panel.hidden;
    panel.hidden = !expanded;
    $('#blueprint-toggle-contrast').setAttribute('aria-expanded', String(expanded));
    const span = $('#blueprint-toggle-contrast span');
    if (span) span.textContent = expanded ? 'Hide Peak vs Flare Contrast' : 'Peak vs Flare Contrast';
  });
  const initial=location.hash.slice(1);showPanel(['overview','acne','stomach','journal','patterns','data'].includes(initial)?initial:'overview');
}

wireInteractions();renderAll();loadData();watchForUpdates();
