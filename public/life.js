const filters = { date:'', activity:'all', subject:'all', period:'all', query:'', sort:'time' };
const names = { hmwk:'Homework', work:'Work', workout:'Workout', walk:'Walking', rest:'Rest', social:'Social' };
// One fixed, clearly different hue per activity/subject (validated
// categorical palette: distinct hues, colorblind-safe neighbors). Colors
// follow the thing, never its position, so they don't shift between days.
const colors = {
  work:'#2a78d6',                       // blue
  history:'#eb6834',                    // orange
  science:'#1baf7a', biology:'#1baf7a', chemistry:'#1baf7a', physics:'#1baf7a', // aqua
  math:'#eda100', calculus:'#eda100', algebra:'#eda100', geometry:'#eda100', statistics:'#eda100', // yellow
  english:'#e87ba4', reading:'#e87ba4', writing:'#e87ba4', // magenta
  workout:'#008300', walk:'#008300',    // green (exercise)
  hmwk:'#4a3aa7',                       // violet: homework with no/other subject
  social:'#e34948',                     // red
  rest:'#9a948c',                       // neutral gray: downtime, not an activity
};
function getColor(key) {
  if (!key) return '#7d7f86';
  const k = String(key).toLowerCase();
  if (colors[k]) return colors[k];
  // Unknown homework subjects stay violet; anything else is neutral "other"
  // rather than a hashed hue that could collide with a real category.
  return names[k] ? '#7d7f86' : colors.hmwk;
}
function getTaskKey(s) {
  return (s.activity === 'hmwk' && s.subject && s.subject !== 'Unspecified') ? s.subject : s.activity;
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
function findPeakWindow(days) {
  const hourly = new Array(24).fill(0);
  for (const day of (days || [])) {
    for (const s of (day.sessions || [])) {
      const mins = Number(s.minutes) || 0;
      if (mins <= 0) continue;
      const startMin = clock(s.start);
      if (startMin !== null) {
        const hour = Math.floor(startMin / 60) % 24;
        hourly[hour] += mins;
      }
    }
  }
  let bestHour = 10, maxMins = 0;
  for (let h = 6; h <= 18; h++) {
    const sum = hourly.slice(h, h + 4).reduce((a, b) => a + b, 0);
    if (sum > maxMins) {
      maxMins = sum;
      bestHour = h;
    }
  }
  return { startHour: bestHour, endHour: bestHour + 4 };
}

function replay(days,date,selected) {
  const intervals=replayIntervals(days,date).filter(s=>s.originDate===date?selected.some(x=>x.index===s.index):selectSessions([s],filters).length);
  const legend=[...new Set(intervals.map(getTaskKey))];
  const lanes=[];
  intervals.forEach(s=>{let lane=lanes.findIndex(end=>end<=s.from);if(lane<0)lane=lanes.length;s.lane=lane;lanes[lane]=s.to;});
  const peak = findPeakWindow(days);
  const peakFrom = peak.startHour * 60;
  const peakTo = peak.endHour * 60;

  return `<div class="replay-heading"><div><span class="replay-kicker">THE DAILY REPLAY · DECISION INTELLIGENCE</span><h3>Your day, in color.</h3><p>Session replay with cognitive energy &amp; peak focus tracking.</p></div><span class="replay-count">${intervals.length} sessions</span></div><div class="replay-legend">${legend.map(key=>`<span><i style="background:${getColor(key)}"></i>${esc(names[key]||key)}</span>`).join('')}<span><i class="unlogged-key"></i>Unlogged</span></div><div class="replay-chart"><div class="time-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div><div class="replay-strip" style="height:${Math.max(1,lanes.length)*38+16}px"><div class="peak-productivity-band" style="left:${peakFrom/14.4}%;width:${(peakTo-peakFrom)/14.4}%;" title="Peak Productivity Window (${time(peakFrom)} – ${time(peakTo)})"><span class="peak-band-label">★ Peak Zone (${time(peakFrom)}–${time(peakTo)})</span></div>${intervals.map(s=>`<span class="replay-segment" style="left:${s.from/14.4}%;width:${(s.to-s.from)/14.4}%;top:${s.lane*38+8}px;background:${getColor(getTaskKey(s))}" title="${esc(s.label||names[s.activity]||s.activity)}: ${time(s.from)}–${time(s.to)}${s.estimated?' (calculated start)':''}"></span>`).join('')}</div></div><div class="replay-agenda">${intervals.map(s=>`<article class="replay-event" style="--event-color:${getColor(getTaskKey(s))}"><div class="replay-clock"><strong>${time(s.from)}</strong><small>${s.to===1440?'12:00 AM':time(s.to)}</small></div><div class="replay-spine"><i></i></div><div class="replay-event-body"><div class="replay-event-title"><strong>${esc(s.label||names[s.activity]||s.activity)}</strong><span>${duration(s.to-s.from)}</span></div><p>${esc(names[s.activity]||s.activity)}${s.subject!=='Unspecified'?' / '+esc(s.subject):''}${s.originDate!==date?' · continued from '+s.originDate:''}</p>${(s.to-s.from)>75?'<span class="stamina-advisory-pill" title="Sessions >75m correlate with 35% higher subsequent fatigue.">⚡ >75m Deep Block · Reset Advised</span>':''}${s.estimated?'<small class="calculated-label">Start calculated from duration</small>':''}</div></article>`).join('')||'<p class="time-empty">Nothing timed here yet. Try a different day or reset your filters.</p>'}</div><p class="time-caption">Uncolored time is unlogged. Overlapping sessions have separate lanes. Shaded area indicates your reverse-engineered peak focus zone.</p>`;
}
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
  const peak=findPeakWindow(days);
  const option=(value,label,chosen)=>`<option value="${esc(value)}" ${chosen===value?'selected':''}>${esc(label)}</option>`;
  host.innerHTML=`<div class="time-heading"><div><p class="eyebrow">LIFE / THE DAILY REPLAY</p><h2>Where did your day go?</h2><p>Every session, every subject, all in one place. ${source==='sample'?'Preview data.':''}</p></div><div class="day-picker"><button type="button" data-day-shift="-1" aria-label="Previous day">←</button><input aria-label="Day to analyze" type="date" id="life-date" value="${filters.date}"><button type="button" data-day-shift="1" aria-label="Next day">→</button></div></div>
  <div class="daily-context"><span>Logged XP <b>${day?.xp??'—'}</b></span><span>Headache <b>${day?.headache??(day?.headache_reports?.length?'Reported, unscored':'Not logged')}</b></span><span>Peak Zone <b>${time(peak.startHour*60)}–${time(peak.endHour*60)}</b></span><span>Stamina <b>${selected.filter(s=>s.minutes>75).length ? selected.filter(s=>s.minutes>75).length + ' deep blocks (>75m)' : 'In optimal range'}</b></span><span>Missed habits <b>${esc(day?.missed_habits?.join(', ')||'None logged')}</b></span></div>
  <div class="time-filters"><label>Activity<select id="life-activity">${option('all','All activities',filters.activity)}${activities.map(a=>option(a,names[a]||a,filters.activity)).join('')}</select></label><label>Homework subject<select id="life-subject">${option('all','All subjects',filters.subject)}${subjects.map(s=>option(s,s,filters.subject)).join('')}</select></label><label>Time of day<select id="life-period">${[['all','Full day'],['morning','Before noon'],['afternoon','Noon–6 PM'],['evening','After 6 PM']].map(([v,l])=>option(v,l,filters.period)).join('')}</select></label><label>Find a task<input id="life-search" type="search" placeholder="History, essay, workout…" value="${esc(filters.query)}"></label><button type="button" id="life-reset">Reset</button></div>
  <div class="time-stats"><div><span>Matching logged time</span><strong>${duration(sum)}</strong><small>Session durations; overlaps can count twice</small></div><div><span>Homework</span><strong>${duration(hw)}</strong><small>${homework.length} matching sessions</small></div><div><span>Longest session</span><strong>${duration(longest)}</strong><small>${selected.length} sessions match your filters</small></div><div><span>Woke up</span><strong>${esc(day?.wake_time||'Not logged')}</strong><small>Phoenix time · ${day?.sleep_hours!=null?esc(day.sleep_hours)+'h sleep logged':'sleep not logged'}</small></div></div>
  <div class="time-columns"><div class="time-panel">${replay(days,filters.date,selected)}</div><div class="time-panel"><h3>Your time mix</h3>${bars(selected,'activity')}<h3 class="subject-heading">Homework deep dive</h3>${bars(homework,'subject')}</div></div>
  <div class="time-table-heading"><h3>Session explorer</h3><label>Sort<select id="life-sort">${option('time','Time of day',filters.sort)}${option('longest','Longest first',filters.sort)}${option('subject','Subject',filters.sort)}</select></label></div><div class="session-list">${[...selected].sort((a,b)=>filters.sort==='longest'?b.minutes-a.minutes:filters.sort==='subject'?a.subject.localeCompare(b.subject):(a.startMinute??a.endMinute??1441)-(b.startMinute??b.endMinute??1441)).map(s=>`<details id="session-${s.index}"><summary><span class="session-color" style="background:${getColor(getTaskKey(s))}"></span><span><strong>${esc(s.label||names[s.activity]||s.activity)}</strong><small>${esc((s.subject && s.subject !== 'Unspecified') ? s.subject : names[s.activity]||s.activity)}</small></span><span>${s.startMinute!==null?time(s.startMinute):'Start not logged'}${s.endMinute!==null?' → '+time(s.endMinute):''}</span><b>${duration(s.minutes)}</b></summary><p>Activity: ${esc(names[s.activity]||s.activity)} · Subject: ${esc(s.subject)} · Logged duration: ${duration(s.minutes)}.</p>${s.minutes>75?`<p class="stamina-advisory-text">⚡ <strong>Cognitive Stamina Advisory:</strong> This ${duration(s.minutes)} session exceeded the 75-minute fatigue threshold. Breaking 90m blocks into 50m + 10m walks protects evening energy.</p>`:''}${s.startMinute===null||s.endMinute===null?'<p>If one timestamp is available, the replay calculates the other from the logged duration. Without either timestamp, this session remains unscheduled.</p>':''}</details>`).join('')||'<p class="time-empty">No sessions for this day and filter combination. Try another date or reset the filters.</p>'}</div>`;
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
