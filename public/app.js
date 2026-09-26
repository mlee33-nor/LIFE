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

const state = { days:[], filtered:[], source:'sample', series:{pain:true, acne:true}, summary:null, foodInsights:null, lifestyleInsights:null, faceDate:null, faceZone:null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const maybeNum = value => value === null || value === undefined || value === '' ? null : num(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = values => { const present = values.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))); return present.length ? present.reduce((sum,value) => sum + Number(value), 0) / present.length : 0; };
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
const toDate = value => { if (!value) return null; const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; };
const shortDate = value => toDate(value)?.toLocaleDateString('en-US',{month:'short',day:'numeric'}) || '—';
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
    const [daily, summary, foodInsights, lifestyleInsights] = await Promise.all([
      getJson('/api/daily'), getJson('/api/summary?days=30').catch(() => null),
      getJson('/api/insights/foods?min_days=3').catch(() => null), getJson('/api/insights/lifestyle').catch(() => null)
    ]);
    state.days = (daily.days || []).map(normalizeDay).sort((a,b) => b.date.localeCompare(a.date));
    state.summary = summary; state.foodInsights = foodInsights; state.lifestyleInsights = lifestyleInsights; state.source = 'api';
    setSyncState('connected');
  } catch {
    state.days = sampleDays.map(normalizeDay).sort((a,b) => b.date.localeCompare(a.date));
    state.summary = null; state.foodInsights = null; state.lifestyleInsights = null; state.source = 'sample';
    setSyncState('sample');
  }
  applyRange(); updateDataStatus();
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

function renderAll() { renderLifeAnalytics(state.days, state.source); renderMetrics(); renderQuests(); renderSignalsChart(); renderConnections(); renderFaceMap(); renderRecent(); renderJournal($('#journal-search')?.value || ''); renderPatterns(); }

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
  const initial=location.hash.slice(1);showPanel(['overview','acne','stomach','journal','patterns','data'].includes(initial)?initial:'overview');
}

wireInteractions();renderAll();loadData();watchForUpdates();
