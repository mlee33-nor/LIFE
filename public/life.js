import { colorFor as getColor, activityNames as names, canonicalSubject, sameText, phoenixToday, shiftIso, plural } from './util.js';
const filters = { date:'', activity:'all', subject:'all', period:'all', query:'', sort:'time' };
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
  const lanes=[];
  intervals.forEach(s=>{let lane=lanes.findIndex(end=>end<=s.from);if(lane<0)lane=lanes.length;s.lane=lane;lanes[lane]=s.to;});

  // Calculate yesterday's date
  const yesterday = new Date(date + 'T12:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayDateStr = yesterday.toISOString().slice(0, 10);
  const yesterdayIntervals = replayIntervals(days, yesterdayDateStr);
  const yesterdayLanes = [];
  yesterdayIntervals.forEach(s=>{let lane=yesterdayLanes.findIndex(end=>end<=s.from);if(lane<0)lane=yesterdayLanes.length;s.lane=lane;yesterdayLanes[lane]=s.to;});

  const totalLanes = Math.max(1, lanes.length, yesterdayLanes.length);

  return `<div class="replay-heading"><h3>Timeline</h3><span class="replay-count">${plural(intervals.length,'session')}</span></div><div class="replay-legend">${legend.map(key=>`<span><i style="background:${getColor(key)}"></i>${esc(names[key]||key)}</span>`).join('')}<span><i class="unlogged-key"></i>Unlogged</span></div><div class="replay-chart"><div class="time-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div><div class="replay-strip" style="height:${totalLanes*38+16}px">
  ${yesterdayIntervals.map(s=>`<span class="replay-segment ghost" style="left:${s.from/14.4}%;width:${(s.to-s.from)/14.4}%;top:${s.lane*38+8}px;" title="Yesterday: ${esc(s.label||names[s.activity]||s.activity)} (${time(s.from)}–${time(s.to)})"></span>`).join('')}
  ${intervals.map(s=>`<span class="replay-segment" style="left:${s.from/14.4}%;width:${(s.to-s.from)/14.4}%;top:${s.lane*38+8}px;background:${getColor(getTaskKey(s))}" title="${esc(s.label||names[s.activity]||s.activity)}: ${time(s.from)}–${time(s.to)}${s.estimated?' (calculated start)':''}"></span>`).join('')}</div></div><div class="replay-agenda">${intervals.map(s=>`<article class="replay-event" style="--event-color:${getColor(getTaskKey(s))}"><div class="replay-clock"><strong>${time(s.from)}</strong><small>${s.to===1440?'12:00 AM':time(s.to)}</small></div><div class="replay-spine"><i></i></div><div class="replay-event-body"><div class="replay-event-title"><strong>${esc(s.label||names[s.activity]||s.activity)}</strong><span>${duration(s.to-s.from)}</span></div><p>${esc(names[s.activity]||s.activity)}${s.subject&&!sameText(s.subject,names[s.activity])?' / '+esc(s.subject):''}${s.originDate!==date?' · continued from the day before':''}</p>${s.estimated?'<small class="calculated-label">Start calculated from duration</small>':''}</div></article>`).join('')||'<p class="time-empty">Nothing timed here yet. Try a different day or reset your filters.</p>'}</div><p class="time-caption">Uncoloured time is unlogged. Faint dashed blocks are yesterday, for comparison.</p>`;
}
let searchDebounceTimer = null;
let lastAnnounced = null;
// The selected day is shared with other Life cards (e.g. Today's recap) via a 'life-date' event.
export const getLifeDate = () => filters.date;
let currentOpts={};
export function renderLifeAnalytics(days,source,opts=currentOpts) {
  currentDays=days;currentSource=source;currentOpts=opts||{};
  const host=document.getElementById('life-analytics');
  const today=phoenixToday();
  if (!filters.date||filters.date>today) filters.date=days.find(d=>d.date<=today)?.date||today;
  if (filters.date!==lastAnnounced) { lastAnnounced=filters.date; document.dispatchEvent(new CustomEvent('life-date',{detail:filters.date})); }
  const day=days.find(d=>d.date===filters.date),sessions=sessionsForDay(day),selected=selectSessions(sessions,filters);
  const subjects=[...new Set(days.flatMap(d=>sessionsForDay(d).filter(s=>s.activity==='hmwk').map(s=>s.subject)))].sort();
  const activities=[...new Set([...Object.keys(names),...sessions.map(s=>s.activity)])];
  const sum=selected.reduce((n,s)=>n+s.minutes,0),homework=selected.filter(s=>s.activity==='hmwk'),hw=homework.reduce((n,s)=>n+s.minutes,0);
  const longest=selected.reduce((n,s)=>Math.max(n,s.minutes),0);
  const option=(value,label,chosen)=>`<option value="${esc(value)}" ${chosen===value?'selected':''}>${esc(label)}</option>`;
  const filtering=filters.activity!=='all'||filters.subject!=='all'||filters.period!=='all'||filters.query;
  const nowChip=currentOpts.now&&filters.date===today?`<span class="now-chip"><i aria-hidden="true"></i>Now: ${esc(currentOpts.now)}${currentOpts.since&&clock(currentOpts.since)!==null?` since ${time(clock(currentOpts.since))}`:''}</span>`:'';
  const context=[day?.headache!=null||day?.headache_reports?.length?`<span>Headache <b>${day?.headache??'reported'}</b></span>`:'',day?.missed_habits?.length?`<span>Missed <b>${esc(day.missed_habits.map(h=>h.replaceAll('_',' ')).join(', '))}</b></span>`:''].filter(Boolean).join('');
  host.innerHTML=`<div class="time-heading"><div><h2>Where did your day go?</h2>${nowChip}${source==='sample'?'<p>Local sample data.</p>':''}</div><div class="day-picker"><button type="button" data-day-shift="-1" aria-label="Previous day">←</button><input aria-label="Day to analyze" type="date" id="life-date" value="${filters.date}" max="${today}"><button type="button" data-day-shift="1" aria-label="Next day" ${filters.date>=today?'disabled':''}>→</button></div></div>
  ${context?`<div class="daily-context">${context}</div>`:''}
  <div class="time-stats"><div><span>Logged time</span><strong>${duration(sum)}</strong><small>${filtering?'matching your filters':'all sessions'}</small></div><div><span>Homework</span><strong>${duration(hw)}</strong><small>${plural(homework.length,'session')}</small></div><div><span>Longest session</span><strong>${duration(longest)}</strong><small>${plural(selected.length,'session')} this day</small></div></div>
  <details class="time-filter-details" ${filtering?'open':''}><summary>Filter sessions${filtering?' (on)':''}</summary><div class="time-filters"><label>Activity<select id="life-activity">${option('all','All activities',filters.activity)}${activities.map(a=>option(a,names[a]||a,filters.activity)).join('')}</select></label><label>Homework subject<select id="life-subject">${option('all','All subjects',filters.subject)}${subjects.map(s=>option(s,s,filters.subject)).join('')}</select></label><label>Time of day<select id="life-period">${[['all','Full day'],['morning','Before noon'],['afternoon','Noon–6 PM'],['evening','After 6 PM']].map(([v,l])=>option(v,l,filters.period)).join('')}</select></label><label>Find a task<input id="life-search" type="search" placeholder="History, essay, workout…" value="${esc(filters.query)}"></label><button type="button" id="life-reset">Reset</button></div></details>
  <div class="time-columns"><div class="time-panel">${replay(days,filters.date,selected)}</div><div class="time-panel"><h3>Your time mix</h3>${bars(selected,'activity')}<h3 class="subject-heading">Homework deep dive</h3>${bars(homework,'subject')}</div></div>
  <details class="session-explorer"><summary>All sessions as a table</summary><div class="time-table-heading"><label>Sort<select id="life-sort">${option('time','Time of day',filters.sort)}${option('longest','Longest first',filters.sort)}${option('subject','Subject',filters.sort)}</select></label></div><div class="session-list">${[...selected].sort((a,b)=>filters.sort==='longest'?b.minutes-a.minutes:filters.sort==='subject'?(a.subject||'').localeCompare(b.subject||''):(a.startMinute??a.endMinute??1441)-(b.startMinute??b.endMinute??1441)).map(s=>`<details id="session-${s.index}"><summary><span class="session-color" style="background:${getColor(getTaskKey(s))}"></span><span><strong>${esc(s.label||names[s.activity]||s.activity)}</strong><small>${esc(subLabel(s))}</small></span><span>${s.startMinute!==null?time(s.startMinute):'Start not logged'}${s.endMinute!==null?' → '+time(s.endMinute):''}</span><b>${duration(s.minutes)}</b></summary><p>Activity: ${esc(names[s.activity]||s.activity)}${s.subject?` · Subject: ${esc(s.subject)}`:''} · Logged duration: ${duration(s.minutes)}.</p>${s.startMinute===null||s.endMinute===null?'<p>If one timestamp is available, the replay calculates the other from the logged duration. Without either timestamp, this session remains unscheduled.</p>':''}</details>`).join('')||'<p class="time-empty">No sessions for this day and filter combination. Try another date or reset the filters.</p>'}</div></details>`;
  const rerender=()=>renderLifeAnalytics(currentDays,currentSource,currentOpts);
  ['date','activity','subject','period','sort'].forEach(key=>document.getElementById('life-'+key).addEventListener('change',e=>{let value=e.target.value;if(key==='date'&&(!value||value>today))value=today;filters[key]=value;rerender();}));
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
  host.querySelectorAll('[data-day-shift]').forEach(b=>b.onclick=()=>{const next=shiftIso(filters.date,Number(b.dataset.dayShift));filters.date=next>today?today:next;rerender();});
  host.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{const detail=document.getElementById('session-'+b.dataset.session);detail.open=true;detail.scrollIntoView({behavior:'smooth',block:'center'});});
}
