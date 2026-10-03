import { colorFor as getColor, activityNames as names, canonicalSubject, sameText, phoenixToday, shiftIso, plural } from './util.js';
import { getSelectedDay } from './week.js';
const filters = { activity:'all', subject:'all', period:'all', query:'', sort:'time' };
// Colours and names are shared with the Homework tab (util.js).
function getTaskKey(s) {
  return (s.activity === 'hmwk' && s.subject && s.subject !== 'General') ? s.subject : s.activity;
}
// Second line for a session: its subject, unless that just repeats the label.
const subLabel = s => { const name = s.label || names[s.activity] || s.activity; return s.subject && !sameText(s.subject, name) ? s.subject : (names[s.activity] || s.activity); };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duration = minutes => `${Math.floor(minutes/60) ? Math.floor(minutes/60)+'h ' : ''}${Math.round(minutes%60)}m`;
const time = minutes => { const h=Math.floor(minutes/60)%24; return `${h%12||12}:${String(Math.floor(minutes%60)).padStart(2,'0')} ${h<12?'AM':'PM'}`; };
function clock(value) {
  if (!value) return null;
  const date=new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Phoenix',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
}
// Moments on a day's timeline: wake-up, bedtime (after midnight it belongs to
// this calendar day; an evening bedtime comes from the next day's record) and MB.
const hhmm = value => { const m=/^(\d{1,2}):(\d{2})/.exec(value||''); return m ? Number(m[1])*60+Number(m[2]) : null; };
const MOMENTS = { wake:{icon:'☀', name:'Woke up', key:'Wake'}, bed:{icon:'☾', name:'Went to sleep', key:'Sleep'}, mb:{icon:'•', name:'MB', key:'MB'} };
export function dayMoments(days, date) {
  const day = days.find(d=>d.date===date);
  const next = days.find(d=>d.date===shiftIso(date,1));
  const out = [];
  const bed = hhmm(day?.bedtime);
  if (bed !== null && bed < 720) out.push({ min:bed, kind:'bed' });
  const wake = hhmm(day?.wake_time);
  if (wake !== null) out.push({ min:wake, kind:'wake' });
  const late = hhmm(next?.bedtime);
  if (late !== null && late >= 720) out.push({ min:late, kind:'bed' });
  for (const e of day?.mb_events || []) { const m = clock(e.at); if (m !== null) out.push({ min:m, kind:'mb' }); }
  return out.sort((a,b)=>a.min-b.min);
}
// Sleep stretches (day.sleep_segments, each credited to its wake day) drawn on
// this calendar day: this day's own stretches, plus the evening part of the
// next day's first stretch when it started before midnight. Clipped to 12 AM.
export function sleepBlocks(days, date) {
  const startOfDay = Date.parse(`${date}T00:00:00-07:00`), endOfDay = startOfDay + 86400000;
  const own = days.find(d=>d.date===date), next = days.find(d=>d.date===shiftIso(date,1));
  return [...(own?.sleep_segments||[]), ...(next?.sleep_segments||[])].map(seg => {
    const end = Date.parse(seg?.end ?? '');
    if (!Number.isFinite(end)) return null;
    let start = Date.parse(seg.start ?? '');
    if (!Number.isFinite(start) && Number(seg.minutes) > 0) start = end - Number(seg.minutes)*60000;
    if (!Number.isFinite(start) || end <= startOfDay || start >= endOfDay || end <= start) return null;
    return { from:Math.max(0,(start-startOfDay)/60000), to:Math.min(1440,(end-startOfDay)/60000), startMin:clock(seg.start ?? start), endMin:clock(seg.end), minutes:Math.round((end-start)/60000), nap:Boolean(seg.nap), before:start<startOfDay, after:end>endOfDay };
  }).filter(Boolean).sort((a,b)=>a.from-b.from);
}
// Minutes slept credited to the day (its own stretches only).
export function sleptOn(day) {
  const segs = (day?.sleep_segments||[]).filter(s => Number(s?.minutes) > 0);
  return { minutes: segs.reduce((n,s)=>n+Number(s.minutes),0), stretches: segs.filter(s=>!s.nap).length, naps: segs.filter(s=>s.nap).length };
}
const sleepName = b => b.nap ? 'Nap' : 'Sleep';
const sleepSegment = b => `<span class="replay-segment sleep${b.nap?' nap':''}" style="left:${b.from/14.4}%;width:${(b.to-b.from)/14.4}%;top:${b.lane*38+8}px" title="${sleepName(b)}: ${time(b.startMin ?? b.from)}–${time(b.endMin ?? b.to)} (${duration(b.minutes)})"></span>`;
const sleepEvent = b => `<article class="replay-event sleep${b.nap?' nap':''}"><div class="replay-clock"><strong>${time(b.startMin ?? b.from)}</strong><small>${time(b.endMin ?? b.to)}</small></div><div class="replay-spine"><i></i></div><div class="replay-event-body sleep-body"><div class="replay-event-title"><strong><span aria-hidden="true">☾</span> ${sleepName(b)} ${time(b.startMin ?? b.from)} – ${time(b.endMin ?? b.to)}</strong><span>${duration(b.minutes)}</span></div>${b.before?'<p>Started the evening before</p>':b.after?'<p>Continues past midnight</p>':''}</div></article>`;
const awakeEvent = (from, to) => `<article class="replay-event awake"><div class="replay-clock"><strong>${time(from)}</strong></div><div class="replay-spine"><i></i></div><div class="replay-event-body awake-body"><span>Awake ${time(from)} – ${time(to)} · ${duration(to-from)}</span></div></article>`;
// Slim one-line notes for sleep, naps, bedtime and MB (no cards, no icons on the strip).
const note = (cls, when, text) => `<div class="replay-note ${cls}"><span class="note-time">${when}</span><span class="note-text">${text}</span></div>`;
const range = b => `${time(b.startMin ?? b.from)}–${time(b.endMin ?? b.to)}`;
function nightNote(blocks, wakeMin) {
  if (blocks.length) {
    const total = blocks.reduce((n, b) => n + b.minutes, 0);
    const end = blocks.at(-1);
    return note('sleep', '', `<span aria-hidden="true">☾</span> Slept ${blocks.map(range).join(' · ')} · <b>${duration(total)}</b> · up ${time(end.endMin ?? end.to)}`);
  }
  return wakeMin !== null && wakeMin !== undefined ? note('sleep', '', `<span aria-hidden="true">☀</span> Up at ${time(wakeMin)}`) : '';
}
const mbDot = m => `<span class="replay-mb" style="left:${m.min/14.4}%" title="MB at ${time(m.min)}"></span>`;
const momentMarker = m => `<span class="replay-moment ${m.kind}" style="left:${m.min/14.4}%" title="${MOMENTS[m.kind].name} at ${time(m.min)}"><b aria-hidden="true">${MOMENTS[m.kind].icon}</b></span>`;
const momentEvent = m => `<article class="replay-event moment ${m.kind}"><div class="replay-clock"><strong>${time(m.min)}</strong></div><div class="replay-spine"><i></i></div><div class="replay-event-body moment-body"><span aria-hidden="true">${MOMENTS[m.kind].icon}</span><strong>${MOMENTS[m.kind].name}</strong></div></article>`;

export function sessionsForDay(day) {
  return (day?.sessions||[]).map((s,index)=>{
    const minutes=Number(s.minutes);
    if (!Number.isFinite(minutes)||minutes<0) return null;
    const start=clock(s.start), end=clock(s.end);
    // Duration-only records remain unscheduled; an end timestamp is an anchor, not a guessed start.
    const activity=s.activity||'other';
    return {...s,index,minutes,startMinute:start,endMinute:end,subject:activity==='hmwk'?canonicalSubject(s.subject):(s.subject?canonicalSubject(s.subject):null),activity};
  }).filter(Boolean);
}
export function selectSessions(sessions,f) {
  const bounds={morning:[0,720],afternoon:[720,1080],evening:[1080,1440]};
  return sessions.filter(s=>{
    const anchor=s.startMinute??s.endMinute;
    return (f.activity==='all'||s.activity===f.activity) && (f.subject==='all'||(s.activity==='hmwk'&&s.subject===f.subject)) &&
      (f.period==='all'||(anchor!==null&&anchor>=bounds[f.period][0]&&anchor<bounds[f.period][1])) &&
      `${s.label||''} ${s.subject||''} ${names[s.activity]||s.activity}`.toLowerCase().includes(f.query.toLowerCase());
  });
}
function bars(sessions,field) {
  const groups=new Map();
  sessions.forEach(s=>{const key=s[field];groups.set(key,(groups.get(key)||0)+s.minutes);});
  const sorted=[...groups].sort((a,b)=>b[1]-a[1]),total=sorted.reduce((n,[,m])=>n+m,0);
  return sorted.map(([key,minutes])=>`<div class="time-bar"><div><strong>${esc(field==='activity'?(names[key]||key):key)}</strong><span>${duration(minutes)} · ${total?Math.round(minutes/total*100):0}%</span></div><div class="time-track"><span style="width:${total?minutes/total*100:0}%;background:${getColor(key)}"></span></div></div>`).join('')||'<p class="time-empty">No matching sessions logged.</p>';
}
let currentDays=[],currentSource='';
export function replayIntervals(days, date) {
  const startOfDay = Date.parse(date+'T00:00:00-07:00');
  return days.flatMap(day=>sessionsForDay(day).map(s=>{
    let start=Date.parse(s.start), end=Date.parse(s.end);
    const estimated=!Number.isFinite(start)||!Number.isFinite(end);
    if (!Number.isFinite(start)&&Number.isFinite(end)) start=end-s.minutes*60000;
    if (!Number.isFinite(end)&&Number.isFinite(start)) end=start+s.minutes*60000;
    if (!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end<=startOfDay||start>=startOfDay+86400000) return null;
    return {...s,originDate:day.date,estimated,from:Math.max(0,(start-startOfDay)/60000),to:Math.min(1440,(end-startOfDay)/60000)};
  })).filter(Boolean).sort((a,b)=>a.from-b.from);
}

function replay(days,date,selected) {
  const intervals=replayIntervals(days,date).filter(s=>s.originDate===date?selected.some(x=>x.index===s.index):selectSessions([s],filters).length);
  const legend=[...new Set(intervals.map(getTaskKey))];
  // A nap already logged as a Rest session isn't drawn a second time as sleep.
  const sleeps=sleepBlocks(days,date).filter(b=>!(b.nap&&intervals.some(s=>s.activity==='rest'&&s.from<b.to&&s.to>b.from)));
  const lanes=[];
  [...intervals,...sleeps].sort((a,b)=>a.from-b.from).forEach(s=>{let lane=lanes.findIndex(end=>end<=s.from);if(lane<0)lane=lanes.length;s.lane=lane;lanes[lane]=s.to;});

  // Calculate yesterday's date
  const yesterday = new Date(date + 'T12:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDateStr = yesterday.toISOString().slice(0, 10);
  const yesterdayIntervals = replayIntervals(days, yesterdayDateStr);
  const yesterdayLanes = [];
  yesterdayIntervals.forEach(s=>{let lane=yesterdayLanes.findIndex(end=>end<=s.from);if(lane<0)lane=yesterdayLanes.length;s.lane=lane;yesterdayLanes[lane]=s.to;});

  const totalLanes = Math.max(1, lanes.length, yesterdayLanes.length);
  // A bedtime a sleep stretch already starts at isn't repeated; the wake-up ☀ always shows.
  const covered = m => sleeps.some(b => Math.abs((m.kind==='bed'?b.from:b.to) - m.min) <= 1);
  const moments = dayMoments(days, date).filter(m => m.kind!=='bed' || !covered(m));
  const awake = sleeps.slice(1).map((b,i)=>({from:sleeps[i].to,to:b.from})).filter(g=>g.to-g.from>0&&g.to-g.from<=240);
  const night = sleeps.filter(b => !b.nap && b.from < 720);
  const momentKeys = moments.some(m=>m.kind==='mb') ? ['mb'] : [];

  return `<div class="replay-heading"><h3>Timeline</h3><span class="replay-count">${plural(intervals.length,'session')}</span></div><div class="replay-legend">${legend.map(key=>`<span><i style="background:${getColor(key)}"></i>${esc(names[key]||key)}</span>`).join('')}${sleeps.length?'<span><i class="sleep-key"></i>Sleep</span>':''}${momentKeys.length?'<span><i class="mb-key"></i>MB</span>':''}</div><div class="replay-chart"><div class="time-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div><div class="replay-strip" style="height:${totalLanes*38+16}px">
  ${yesterdayIntervals.map(s=>`<span class="replay-segment ghost" style="left:${s.from/14.4}%;width:${(s.to-s.from)/14.4}%;top:${s.lane*38+8}px;" title="Yesterday: ${esc(s.label||names[s.activity]||s.activity)} (${time(s.from)}–${time(s.to)})"></span>`).join('')}
  ${intervals.map(s=>`<span class="replay-segment" style="left:${s.from/14.4}%;width:${(s.to-s.from)/14.4}%;top:${s.lane*38+8}px;background:${getColor(getTaskKey(s))}" title="${esc(s.label||names[s.activity]||s.activity)}: ${time(s.from)}–${time(s.to)}${s.estimated?' (calculated start)':''}"></span>`).join('')}${sleeps.map(sleepSegment).join('')}${moments.filter(m=>m.kind==='mb').map(mbDot).join('')}</div></div><div class="replay-agenda">${nightNote(night, night.length ? null : moments.find(m=>m.kind==='wake')?.min)}${[...intervals.map(s=>({at:s.from,s})),...moments.filter(m=>m.kind!=='wake' && !(m.kind==='bed' && m.min<720)).map(m=>({at:m.min,m})),...sleeps.filter(b=>!night.includes(b)).map(b=>({at:b.from,b}))].sort((a,b)=>a.at-b.at).map(({s,m,b})=>b?note('sleep nap', time(b.startMin ?? b.from), `<span aria-hidden="true">☾</span> ${sleepName(b)} ${range(b)} · ${duration(b.minutes)}`):m?note(m.kind==='mb'?'mb':'sleep', time(m.min), m.kind==='mb'?'MB':'<span aria-hidden="true">☾</span> Bed'):`<article class="replay-event" style="--event-color:${getColor(getTaskKey(s))}"><div class="replay-clock"><strong>${time(s.from)}</strong><small>${s.to===1440?'12:00 AM':time(s.to)}</small></div><div class="replay-spine"><i></i></div><div class="replay-event-body"><div class="replay-event-title"><strong>${esc(s.label||names[s.activity]||s.activity)}</strong><span>${duration(s.to-s.from)}</span></div><p>${esc(names[s.activity]||s.activity)}${s.subject&&!sameText(s.subject,names[s.activity])?' / '+esc(s.subject):''}${s.originDate!==date?' · continued from the day before':''}</p>${s.estimated?'<small class="calculated-label">Start calculated from duration</small>':''}</div></article>`).join('')||'<p class="time-empty">Nothing timed here yet. Try a different day or reset your filters.</p>'}</div><p class="time-caption">Uncoloured time is unlogged. Faint dashed blocks are yesterday, for comparison.</p>`;
}
function sleptLine(day) {
  const s = sleptOn(day);
  if (!s.minutes) return '';
  const parts = [s.stretches > 1 ? `${s.stretches} stretches` : '', s.naps ? plural(s.naps, 'nap') : ''].filter(Boolean).join(', ');
  return `<p class="slept-line"><span aria-hidden="true">☾</span> Slept ${duration(s.minutes)}${parts ? ` (${parts})` : ''}</p>`;
}
let searchDebounceTimer = null;
// The day comes from the week strip (week.js), shared by every Life card.
document.addEventListener('life-date', () => { if (currentDays.length || currentSource) renderLifeAnalytics(currentDays, currentSource, currentOpts); });
let currentOpts={};
export function renderLifeAnalytics(days,source,opts=currentOpts) {
  currentDays=days;currentSource=source;currentOpts=opts||{};
  const host=document.getElementById('life-analytics');
  const today=phoenixToday();
  const date=getSelectedDay();
  const day=days.find(d=>d.date===date),sessions=sessionsForDay(day),selected=selectSessions(sessions,filters);
  const subjects=[...new Set(days.flatMap(d=>sessionsForDay(d).filter(s=>s.activity==='hmwk').map(s=>s.subject)))].sort();
  const activities=[...new Set([...Object.keys(names),...sessions.map(s=>s.activity)])];
  const sum=selected.reduce((n,s)=>n+s.minutes,0),homework=selected.filter(s=>s.activity==='hmwk'),hw=homework.reduce((n,s)=>n+s.minutes,0);
  const longest=selected.reduce((n,s)=>Math.max(n,s.minutes),0);
  const option=(value,label,chosen)=>`<option value="${esc(value)}" ${chosen===value?'selected':''}>${esc(label)}</option>`;
  const filtering=filters.activity!=='all'||filters.subject!=='all'||filters.period!=='all'||filters.query;
  const nowChip=currentOpts.now&&date===today?`<span class="now-chip"><i aria-hidden="true"></i>Now: ${esc(currentOpts.now)}${currentOpts.since&&clock(currentOpts.since)!==null?` since ${time(clock(currentOpts.since))}`:''}</span>`:'';
  const context=[day?.headache!=null||day?.headache_reports?.length?`<span>Headache <b>${day?.headache??'reported'}</b></span>`:'',day?.missed_habits?.length?`<span>Missed <b>${esc(day.missed_habits.map(h=>h.replaceAll('_',' ')).join(', '))}</b></span>`:''].filter(Boolean).join('');
  host.innerHTML=`<div class="time-heading"><div><h2>Where did your day go?</h2>${nowChip}${source==='sample'?'<p>Local sample data.</p>':''}<p class="time-day">${date===today?'Today':esc(new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric'}))}</p></div></div>
  ${context?`<div class="daily-context">${context}</div>`:''}
  <div class="time-stats"><div><span>Logged time</span><strong>${duration(sum)}</strong><small>${filtering?'matching your filters':'all sessions'}</small></div><div><span>Homework</span><strong>${duration(hw)}</strong><small>${plural(homework.length,'session')}</small></div><div><span>Longest session</span><strong>${duration(longest)}</strong><small>${plural(selected.length,'session')} this day</small></div></div>
  <details class="time-filter-details" ${filtering?'open':''}><summary>Filter sessions${filtering?' (on)':''}</summary><div class="time-filters"><label>Activity<select id="life-activity">${option('all','All activities',filters.activity)}${activities.map(a=>option(a,names[a]||a,filters.activity)).join('')}</select></label><label>Homework subject<select id="life-subject">${option('all','All subjects',filters.subject)}${subjects.map(s=>option(s,s,filters.subject)).join('')}</select></label><label>Time of day<select id="life-period">${[['all','Full day'],['morning','Before noon'],['afternoon','Noon–6 PM'],['evening','After 6 PM']].map(([v,l])=>option(v,l,filters.period)).join('')}</select></label><label>Find a task<input id="life-search" type="search" placeholder="History, essay, workout…" value="${esc(filters.query)}"></label><button type="button" id="life-reset">Reset</button></div></details>
  <div class="time-columns"><div class="time-panel">${replay(days,date,selected)}</div><div class="time-panel"><h3>Your time mix</h3>${sleptLine(day)}${bars(selected,'activity')}<h3 class="subject-heading">Homework deep dive</h3>${bars(homework,'subject')}</div></div>
  <details class="session-explorer"><summary>All sessions as a table</summary><div class="time-table-heading"><label>Sort<select id="life-sort">${option('time','Time of day',filters.sort)}${option('longest','Longest first',filters.sort)}${option('subject','Subject',filters.sort)}</select></label></div><div class="session-list">${[...selected].sort((a,b)=>filters.sort==='longest'?b.minutes-a.minutes:filters.sort==='subject'?(a.subject||'').localeCompare(b.subject||''):(a.startMinute??a.endMinute??1441)-(b.startMinute??b.endMinute??1441)).map(s=>`<details id="session-${s.index}"><summary><span class="session-color" style="background:${getColor(getTaskKey(s))}"></span><span><strong>${esc(s.label||names[s.activity]||s.activity)}</strong><small>${esc(subLabel(s))}</small></span><span>${s.startMinute!==null?time(s.startMinute):'Start not logged'}${s.endMinute!==null?' → '+time(s.endMinute):''}</span><b>${duration(s.minutes)}</b></summary><p>Activity: ${esc(names[s.activity]||s.activity)}${s.subject?` · Subject: ${esc(s.subject)}`:''} · Logged duration: ${duration(s.minutes)}.</p>${s.startMinute===null||s.endMinute===null?'<p>If one timestamp is available, the replay calculates the other from the logged duration. Without either timestamp, this session remains unscheduled.</p>':''}</details>`).join('')||'<p class="time-empty">No sessions for this day and filter combination. Try another date or reset the filters.</p>'}</div></details>`;
  const rerender=()=>renderLifeAnalytics(currentDays,currentSource,currentOpts);
  ['activity','subject','period','sort'].forEach(key=>document.getElementById('life-'+key).addEventListener('change',e=>{filters[key]=e.target.value;rerender();}));
  document.getElementById('life-search').addEventListener('input',e=>{
    const position=e.target.selectionStart;
    filters.query=e.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      rerender();
      const input=document.getElementById('life-search');
      if(input){input.focus();if(input.type!=='search')input.setSelectionRange(position,position);}
    }, 150);
  });
  document.getElementById('life-reset').onclick=()=>{Object.assign(filters,{activity:'all',subject:'all',period:'all',query:'',sort:'time'});rerender();};
  host.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{const detail=document.getElementById('session-'+b.dataset.session);detail.open=true;detail.scrollIntoView({behavior:'smooth',block:'center'});});
}
