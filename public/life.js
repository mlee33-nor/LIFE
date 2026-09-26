const filters = { date:'', activity:'all', subject:'all', period:'all', query:'', sort:'time' };
const names = { hmwk:'Homework', work:'Work', workout:'Workout', walk:'Walking', rest:'Rest', social:'Social' };
const colors = { hmwk:'#9166e5', work:'#5a9de0', workout:'#f29370', walk:'#8fbb40', rest:'#ddab43' };
const palette = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080'];
function getColor(key) {
  if (!key) return '#9166e5';
  const k = String(key).toLowerCase();
  if (colors[k]) return colors[k];
  let hash = 0;
  for (let i = 0; i < k.length; i++) hash = ((hash << 5) - hash) + k.charCodeAt(i);
  return palette[Math.abs(hash) % palette.length];
}
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
    return {...s,index,minutes,startMinute:start,endMinute:end,subject:s.subject||'Unspecified',activity:s.activity||'other'};
  }).filter(Boolean);
}
export function selectSessions(sessions,f) {
  const bounds={morning:[0,720],afternoon:[720,1080],evening:[1080,1440]};
  return sessions.filter(s=>{
    const anchor=s.startMinute??s.endMinute;
    return (f.activity==='all'||s.activity===f.activity) && (f.subject==='all'||(s.activity==='hmwk'&&s.subject===f.subject)) &&
      (f.period==='all'||(anchor!==null&&anchor>=bounds[f.period][0]&&anchor<bounds[f.period][1])) &&
      `${s.label||''} ${s.subject} ${names[s.activity]||s.activity}`.toLowerCase().includes(f.query.toLowerCase());
  });
}
function bars(sessions,field) {
  const groups=new Map();
  sessions.forEach(s=>{const key=s[field];groups.set(key,(groups.get(key)||0)+s.minutes);});
  const sorted=[...groups].sort((a,b)=>b[1]-a[1]),total=sorted.reduce((n,[,m])=>n+m,0);
  return sorted.map(([key,minutes])=>`<div class="time-bar"><div><strong>${esc(field==='activity'?(names[key]||key):key)}</strong><span>${duration(minutes)} · ${total?Math.round(minutes/total*100):0}%</span></div><div class="time-track"><span style="width:${total?minutes/total*100:0}%;background:${getColor(key)}"></span></div></div>`).join('')||'<p class="time-empty">No matching sessions logged.</p>';
}
let currentDays=[],currentSource='';
let searchDebounceTimer = null;
export function renderLifeAnalytics(days,source) {
  currentDays=days;currentSource=source;
  const host=document.getElementById('life-analytics');
  if (!filters.date) filters.date=days[0]?.date||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix'}).format(new Date());
  const day=days.find(d=>d.date===filters.date),sessions=sessionsForDay(day),selected=selectSessions(sessions,filters);
  const subjects=[...new Set(days.flatMap(d=>sessionsForDay(d).filter(s=>s.activity==='hmwk').map(s=>s.subject)))].sort();
  const activities=[...new Set([...Object.keys(names),...sessions.map(s=>s.activity)])];
  const sum=selected.reduce((n,s)=>n+s.minutes,0),homework=selected.filter(s=>s.activity==='hmwk'),hw=homework.reduce((n,s)=>n+s.minutes,0);
  const longest=selected.reduce((n,s)=>Math.max(n,s.minutes),0);
  const option=(value,label,chosen)=>`<option value="${esc(value)}" ${chosen===value?'selected':''}>${esc(label)}</option>`;
  host.innerHTML=`<div class="time-heading"><div><p class="eyebrow">LIFE / THE DAILY REPLAY</p><h2>Where did your day go?</h2><p>Every session, every subject, all in one place. ${source==='sample'?'Preview data.':''}</p></div><div class="day-picker"><button type="button" data-day-shift="-1" aria-label="Previous day">←</button><input aria-label="Day to analyze" type="date" id="life-date" value="${filters.date}"><button type="button" data-day-shift="1" aria-label="Next day">→</button></div></div>
  <div class="daily-context"><span>Logged XP <b>${day?.xp??'—'}</b></span><span>Headache <b>${day?.headache??(day?.headache_reports?.length?'Reported, unscored':'Not logged')}</b></span><span>Missed habits <b>${esc(day?.missed_habits?.join(', ')||'None logged')}</b></span></div>
  <div class="time-filters"><label>Activity<select id="life-activity">${option('all','All activities',filters.activity)}${activities.map(a=>option(a,names[a]||a,filters.activity)).join('')}</select></label><label>Homework subject<select id="life-subject">${option('all','All subjects',filters.subject)}${subjects.map(s=>option(s,s,filters.subject)).join('')}</select></label><label>Time of day<select id="life-period">${[['all','Full day'],['morning','Before noon'],['afternoon','Noon–6 PM'],['evening','After 6 PM']].map(([v,l])=>option(v,l,filters.period)).join('')}</select></label><label>Find a task<input id="life-search" type="search" placeholder="History, essay, workout…" value="${esc(filters.query)}"></label><button type="button" id="life-reset">Reset</button></div>
  <div class="time-stats"><div><span>Matching logged time</span><strong>${duration(sum)}</strong><small>Session durations; overlaps can count twice</small></div><div><span>Homework</span><strong>${duration(hw)}</strong><small>${homework.length} matching sessions</small></div><div><span>Longest session</span><strong>${duration(longest)}</strong><small>${selected.length} sessions match your filters</small></div><div><span>Woke up</span><strong>${esc(day?.wake_time||'Not logged')}</strong><small>Phoenix time · ${day?.sleep_hours!=null?esc(day.sleep_hours)+'h sleep logged':'sleep not logged'}</small></div></div>
  <div class="time-columns"><div class="time-panel"><h3>Your 24-hour replay</h3><p>One row per session. Empty space means unlogged time.</p><div class="time-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div><div class="day-rail">${day?.wake_time?`<span class="wake-marker" style="left:${(Number(day.wake_time.slice(0,2))*60+Number(day.wake_time.slice(3,5)))/1440*100}%" title="Wake ${esc(day.wake_time)}">☀</span>`:''}</div>${selected.filter(s=>s.startMinute!==null&&s.endMinute!==null).map(s=>{const end=s.endMinute<s.startMinute?1440:s.endMinute;return `<div class="timeline-row"><span>${esc(names[s.activity]||s.activity)}${s.activity==='hmwk'?' · '+esc(s.subject):''}</span><div class="timeline-track"><button type="button" data-session="${s.index}" style="left:${s.startMinute/1440*100}%;width:${Math.max(.6,(end-s.startMinute)/1440*100)}%;background:${getColor(s.activity)}" aria-label="${esc(s.label||names[s.activity]||s.activity)} ${time(s.startMinute)} to ${time(s.endMinute)}"> </button></div></div>`;}).join('')||'<p class="time-empty">No matching sessions with both start and end times. Duration-only entries appear below.</p>'}<p class="time-caption">Cross-midnight sessions are clipped at midnight; durations below remain as logged. Time-of-day filters use the start time, or end time if no start is logged.</p></div><div class="time-panel"><h3>Your time mix</h3>${bars(selected,'activity')}<h3 class="subject-heading">Homework deep dive</h3>${bars(homework,'subject')}</div></div>
  <div class="time-table-heading"><h3>Session explorer</h3><label>Sort<select id="life-sort">${option('time','Time of day',filters.sort)}${option('longest','Longest first',filters.sort)}${option('subject','Subject',filters.sort)}</select></label></div><div class="session-list">${[...selected].sort((a,b)=>filters.sort==='longest'?b.minutes-a.minutes:filters.sort==='subject'?a.subject.localeCompare(b.subject):(a.startMinute??a.endMinute??1441)-(b.startMinute??b.endMinute??1441)).map(s=>`<details id="session-${s.index}"><summary><span class="session-color" style="background:${getColor(s.activity)}"></span><span><strong>${esc(s.label||names[s.activity]||s.activity)}</strong><small>${esc(s.activity==='hmwk'?s.subject:names[s.activity]||s.activity)}</small></span><span>${s.startMinute!==null?time(s.startMinute):'Start not logged'}${s.endMinute!==null?' → '+time(s.endMinute):''}</span><b>${duration(s.minutes)}</b></summary><p>Activity: ${esc(names[s.activity]||s.activity)} · Subject: ${esc(s.subject)} · Logged duration: ${duration(s.minutes)}.</p>${s.startMinute===null||s.endMinute===null?'<p>Incomplete timestamps: this session counts toward totals but is not placed on the timeline.</p>':''}</details>`).join('')||'<p class="time-empty">No sessions for this day and filter combination. Try another date or reset the filters.</p>'}</div>`;
  const rerender=()=>renderLifeAnalytics(currentDays,currentSource);
  ['date','activity','subject','period','sort'].forEach(key=>document.getElementById('life-'+key).addEventListener('change',e=>{filters[key]=e.target.value;rerender();}));
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
  host.querySelectorAll('[data-day-shift]').forEach(b=>b.onclick=()=>{const date=new Date(filters.date+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(b.dataset.dayShift));filters.date=date.toISOString().slice(0,10);rerender();});
  host.querySelectorAll('[data-session]').forEach(b=>b.onclick=()=>{const detail=document.getElementById('session-'+b.dataset.session);detail.open=true;detail.scrollIntoView({behavior:'smooth',block:'center'});});
}
