import { canonicalSubject, colorFor, sameText, phoenixToday, shiftIso, plural } from './util.js';

// The date range follows the global picker in the top bar (passed in by app.js).
const view = { range: '14', subject: 'all', query: '', sort: 'newest' };
const RANGE_LABELS = { '7': 'Last 7 days', '14': 'Last 14 days', '30': 'Last 30 days', all: 'All time' };
const esc = (value = '') => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const minutesLabel = value => {
  const minutes = Math.round(Number(value) || 0);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}m` : ''}`.trim() : `${minutes}m`;
};
const localDate = value => {
  if (!value) return null;
  const date = new Date(`${value.slice(0,10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const dayLabel = value => localDate(value)?.toLocaleDateString('en-US',{month:'short',day:'numeric'}) || value;
const longDayLabel = value => localDate(value)?.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) || value;
const clockMinute = value => {
  const match = String(value || '').match(/T(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const clockLabel = minute => {
  if (minute == null) return 'Not timed';
  const value = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hour = Math.floor(value / 60), mins = value % 60;
  return `${hour % 12 || 12}:${String(mins).padStart(2,'0')} ${hour < 12 ? 'AM' : 'PM'}`;
};
const average = values => values.length ? values.reduce((sum,value)=>sum+value,0) / values.length : 0;
const assignment = session => sameText(session.label, session.subject) ? 'Homework' : session.label;

function sourceSessions(days) {
  return days.flatMap(day => {
    const timed = (day.sessions || []).filter(session => session.activity === 'hmwk').map((session,index) => {
      const minutes = Math.max(0, Number(session.minutes) || 0);
      let startMinute = clockMinute(session.start), endMinute = clockMinute(session.end), calculated = false;
      if (startMinute == null && endMinute != null && minutes) { startMinute = (endMinute - minutes + 1440) % 1440; calculated = true; }
      if (endMinute == null && startMinute != null && minutes) { endMinute = (startMinute + minutes) % 1440; calculated = true; }
      const subject = canonicalSubject(session.subject);
      return { ...session, date:day.date, minutes, subject, label:session.label || session.name || session.task || (subject === 'General' ? 'Homework' : subject), startMinute, endMinute, calculated, key:`${day.date}-${index}` };
    }).filter(session => session.minutes > 0);
    if (timed.length) return timed;
    const subjects = Object.entries(day.hmwk_by_subject || {}).filter(([,minutes]) => Number(minutes) > 0);
    if (subjects.length) return subjects.map(([subject,minutes],index) => ({ date:day.date, minutes:Number(minutes), subject:canonicalSubject(subject), label:canonicalSubject(subject), startMinute:null, endMinute:null, calculated:false, aggregate:true, key:`${day.date}-aggregate-${index}` }));
    return Number(day.hmwk_minutes) > 0 ? [{ date:day.date, minutes:Number(day.hmwk_minutes), subject:'General', label:'Homework', startMinute:null, endMinute:null, calculated:false, aggregate:true, key:`${day.date}-aggregate` }] : [];
  });
}

// Calendar days in the range, but never before the first logged day (no
// empty "pre-history" bars) and never after today (Phoenix).
function rangeDays(days) {
  const dated = days.filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day.date || '')).sort((a,b)=>a.date.localeCompare(b.date));
  if (!dated.length) return [];
  const byDate = new Map(dated.map(day => [day.date, day]));
  const today = phoenixToday();
  const end = dated.at(-1).date > today ? dated.at(-1).date : today;
  const first = dated[0].date;
  let start = view.range === 'all' ? first : shiftIso(end, -(Number(view.range) - 1));
  if (start < first) start = first;
  const result = [];
  for (let key = start; key <= end; key = shiftIso(key, 1)) result.push(byDate.get(key) || { date:key, sessions:[], hmwk_minutes:0, hmwk_by_subject:{} });
  return result;
}

function groupSum(items, keyFn) {
  const groups = new Map();
  items.forEach(item => { const key=keyFn(item); groups.set(key,(groups.get(key)||0)+item.minutes); });
  return [...groups].map(([key,minutes])=>({key,minutes})).sort((a,b)=>b.minutes-a.minutes);
}

// Today still in progress doesn't break the streak.
function currentStreak(days, sessions) {
  if (!days.length) return 0;
  const studied = new Set(sessions.map(session=>session.date));
  let date = days.at(-1).date, count = 0;
  if (!studied.has(date)) date = shiftIso(date, -1);
  while (studied.has(date)) { count += 1; date = shiftIso(date, -1); }
  return count;
}

function bestStreak(days, sessions) {
  const studied = new Set(sessions.map(session=>session.date));
  let best=0, run=0;
  days.forEach(day => { run=studied.has(day.date)?run+1:0; best=Math.max(best,run); });
  return best;
}

function dailyChart(days, sessions) {
  const daily = days.map(day=>({ date:day.date, minutes:sessions.filter(s=>s.date===day.date).reduce((sum,s)=>sum+s.minutes,0) }));
  const shown = daily.slice(-35), max=Math.max(1,...shown.map(d=>d.minutes)), avg=average(daily.map(d=>d.minutes));
  // Label from the newest bar backwards, about five labels max, so they never overlap.
  const stride = Math.max(1, Math.ceil(shown.length / 5)), labelled = new Set();
  for (let i = shown.length - 1; i >= 0; i -= stride) labelled.add(i);
  const ratio = Math.min(1, avg / max);
  return `<article class="hw-card hw-daily-card"><div class="hw-card-title"><div><span>PACE</span><h3>Study minutes by day</h3></div><strong>${minutesLabel(avg)}<small>daily avg</small></strong></div><div class="hw-daily-chart" role="img" aria-label="Daily homework minutes, ${esc(dayLabel(shown[0]?.date))} to ${esc(dayLabel(shown.at(-1)?.date))}">${shown.map((day,index)=>`<button class="hw-day-bar" type="button" data-hw-date="${day.date}" title="${longDayLabel(day.date)}: ${minutesLabel(day.minutes)}" aria-label="${longDayLabel(day.date)}: ${minutesLabel(day.minutes)}"><i style="height:${Math.max(day.minutes ? 8 : 2,day.minutes/max*100)}%;--bar:${day.minutes ? '#7650cf' : '#e9e3f4'}"></i>${labelled.has(index)?`<span>${dayLabel(day.date)}</span>`:''}</button>`).join('')}${avg ? `<div class="hw-average-line ${ratio > .82 ? 'label-below' : ''}" style="--avg:${ratio}"><span>avg ${minutesLabel(avg)}</span></div>` : ''}</div><p class="hw-caption">${daily.length>shown.length?`Showing the latest ${shown.length} days. `:''}Starts at your first logged day. Select any bar to filter the session details below.</p></article>`;
}

function subjectChart(sessions) {
  const groups=groupSum(sessions,s=>s.subject), total=sessions.reduce((sum,s)=>sum+s.minutes,0);
  if (!groups.length) return emptyChart('No subjects in this view yet.');
  let angle=0;
  const segments=groups.map(group=>{const from=angle;angle+=group.minutes/total*360;return `${colorFor(group.key)} ${from}deg ${angle}deg`;}).join(',');
  return `<article class="hw-card"><div class="hw-card-title"><div><span>SUBJECT MIX</span><h3>Where study time goes</h3></div></div><div class="hw-subject-layout"><div class="hw-donut" style="background:conic-gradient(${segments})" role="img" aria-label="Study time by subject"><div><strong>${minutesLabel(total)}</strong><span>total</span></div></div><div class="hw-ranked-bars">${groups.map(group=>`<button type="button" data-hw-subject="${esc(group.key)}"><span><i style="background:${colorFor(group.key)}"></i>${esc(group.key)}</span><b>${minutesLabel(group.minutes)} · ${Math.round(group.minutes/total*100)}%</b><em><i style="width:${group.minutes/groups[0].minutes*100}%;background:${colorFor(group.key)}"></i></em></button>`).join('')}</div></div></article>`;
}

function timeChart(sessions) {
  const timed=sessions.filter(s=>s.startMinute!=null), buckets=Array.from({length:24},(_,hour)=>({hour,minutes:0}));
  timed.forEach(session=>buckets[Math.floor(session.startMinute/60)%24].minutes+=session.minutes);
  const max=Math.max(1,...buckets.map(b=>b.minutes)), peak=[...buckets].sort((a,b)=>b.minutes-a.minutes)[0];
  return `<article class="hw-card"><div class="hw-card-title"><div><span>FOCUS CLOCK</span><h3>When you tend to study</h3></div><strong>${timed.length?clockLabel(peak.hour*60):'—'}<small>${timed.length?'peak start hour':'timestamps needed'}</small></strong></div><div class="hw-hour-chart">${buckets.map(bucket=>`<div title="${clockLabel(bucket.hour*60)}: ${minutesLabel(bucket.minutes)}"><i style="height:${Math.max(bucket.minutes?7:2,bucket.minutes/max*100)}%"></i>${bucket.hour%6===0?`<span>${bucket.hour===0?'12a':bucket.hour<12?bucket.hour+'a':bucket.hour===12?'12p':bucket.hour-12+'p'}</span>`:''}</div>`).join('')}</div><p class="hw-caption">Based on ${plural(timed.length,'session')} with a start or end time.</p></article>`;
}

function weekdayChart(days,sessions) {
  const buckets=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(label=>({label,total:0,days:0}));
  days.forEach(day=>{const index=localDate(day.date)?.getDay();if(index!=null){buckets[index].days++;buckets[index].total+=sessions.filter(s=>s.date===day.date).reduce((sum,s)=>sum+s.minutes,0);}});
  buckets.forEach(bucket=>bucket.avg=bucket.days?bucket.total/bucket.days:0);
  const max=Math.max(1,...buckets.map(b=>b.avg)), best=[...buckets].sort((a,b)=>b.avg-a.avg)[0];
  return `<article class="hw-card"><div class="hw-card-title"><div><span>WEEKLY RHYTHM</span><h3>Average by weekday</h3></div><strong>${best.avg?best.label:'—'}<small>strongest day</small></strong></div><div class="hw-weekday-chart">${buckets.map(bucket=>`<div><span>${bucket.days?minutesLabel(bucket.avg):'—'}</span><i style="height:${Math.max(bucket.avg?8:2,bucket.avg/max*100)}%"></i><b>${bucket.label}</b></div>`).join('')}</div>${days.length<14?`<p class="hw-caption">Only ${plural(days.length,'day')} logged so far, so some weekdays have one sample or none (—).</p>`:''}</article>`;
}

function durationChart(sessions) {
  const buckets=[{label:'Quick win',hint:'Under 15m',test:m=>m<15},{label:'Sprint',hint:'15–29m',test:m=>m>=15&&m<30},{label:'Focus block',hint:'30–59m',test:m=>m>=30&&m<60},{label:'Deep work',hint:'60m+',test:m=>m>=60}].map(bucket=>({...bucket,count:sessions.filter(s=>bucket.test(s.minutes)).length}));
  const max=Math.max(1,...buckets.map(b=>b.count));
  return `<article class="hw-card"><div class="hw-card-title"><div><span>SESSION SHAPE</span><h3>How long your blocks run</h3></div></div><div class="hw-duration-chart">${buckets.map((bucket,index)=>`<div><span><b>${bucket.label}</b><small>${bucket.hint}</small></span><em><i style="width:${bucket.count/max*100}%;--duration-index:${index}"></i></em><strong>${bucket.count}</strong></div>`).join('')}</div></article>`;
}

function emptyChart(message) { return `<article class="hw-card hw-empty-mini"><span aria-hidden="true">✦</span><p>${esc(message)}</p></article>`; }

function subjectDetails(sessions) {
  const total=sessions.reduce((sum,s)=>sum+s.minutes,0), groups=groupSum(sessions,s=>s.subject);
  return `<section class="hw-subject-details"><div class="hw-section-heading"><div><span>SUBJECTS</span><h2>By subject</h2></div></div><div class="hw-subject-grid">${groups.map((group,index)=>{const own=sessions.filter(s=>s.subject===group.key),days=new Set(own.map(s=>s.date)).size,longest=Math.max(...own.map(s=>s.minutes));return `<button type="button" data-hw-subject="${esc(group.key)}" style="--subject:${colorFor(group.key)}"><span class="hw-subject-rank" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><i></i><h3>${esc(group.key)}</h3><strong>${minutesLabel(group.minutes)}</strong><div><span><b>${own.length}</b> ${own.length===1?'session':'sessions'}</span><span><b>${minutesLabel(average(own.map(s=>s.minutes)))}</b> avg</span><span><b>${days}</b> study ${days===1?'day':'days'}</span><span><b>${minutesLabel(longest)}</b> longest</span></div><em>${total?Math.round(group.minutes/total*100):0}% of study time</em></button>`;}).join('')||'<div class="hw-empty-wide">Add a subject to your MOTION homework logs to compare courses here.</div>'}</div></section>`;
}

function sessionTable(sessions) {
  const query=view.query.trim().toLowerCase();
  let rows=sessions.filter(session=>!query||`${session.subject} ${session.label} ${session.date}`.toLowerCase().includes(query));
  rows=[...rows].sort((a,b)=>view.sort==='longest'?b.minutes-a.minutes:view.sort==='subject'?a.subject.localeCompare(b.subject)||b.date.localeCompare(a.date):b.date.localeCompare(a.date)||(b.startMinute??-1)-(a.startMinute??-1));
  return `<section class="hw-session-section"><div class="hw-section-heading hw-session-heading"><div><span>SESSIONS</span><h2>Every session</h2><p>${plural(rows.length,'matching session')} · averages use logged sessions only.</p></div><div class="hw-session-controls"><label><span class="sr-only">Search study sessions</span><input id="hw-search" type="search" placeholder="Search subject or assignment…" value="${esc(view.query)}"></label><label><span class="sr-only">Sort study sessions</span><select id="hw-sort"><option value="newest" ${view.sort==='newest'?'selected':''}>Newest first</option><option value="longest" ${view.sort==='longest'?'selected':''}>Longest first</option><option value="subject" ${view.sort==='subject'?'selected':''}>By subject</option></select></label></div></div><div class="hw-session-table"><div class="hw-session-row hw-session-header"><span>Date</span><span>Subject & assignment</span><span>Time</span><span>Duration</span></div>${rows.map(session=>`<article class="hw-session-row"><span><strong>${dayLabel(session.date)}</strong><small>${localDate(session.date)?.toLocaleDateString('en-US',{weekday:'long'})||''}</small></span><span><i style="background:${colorFor(session.subject)}"></i><strong>${esc(session.subject)}</strong><small>${esc(assignment(session))}</small></span><span><strong>${session.startMinute!=null?clockLabel(session.startMinute):'Not timed'}</strong><small>${session.endMinute!=null?`to ${clockLabel(session.endMinute)}`:session.aggregate?'daily total':'end not logged'}${session.calculated?' · calculated':''}</small></span><span><b>${minutesLabel(session.minutes)}</b></span></article>`).join('')||'<div class="hw-empty-wide">No sessions match these filters.</div>'}</div></section>`;
}

let currentDays=[], currentSource='';
export function renderHomeworkAnalytics(days, source, { range } = {}) {
  currentDays=days;currentSource=source;
  if (range && RANGE_LABELS[range]) view.range = range;
  const host=document.getElementById('homework-dashboard');
  if (!host) return;
  const allSessions=sourceSessions(days), subjects=[...new Set(allSessions.map(s=>s.subject))].sort();
  if (view.subject!=='all' && !subjects.includes(view.subject)) view.subject='all';
  const daysInRange=rangeDays(days), dateSet=new Set(daysInRange.map(day=>day.date));
  const rangeSessions=allSessions.filter(session=>dateSet.has(session.date));
  const sessions=view.subject==='all'?rangeSessions:rangeSessions.filter(session=>session.subject===view.subject);
  const total=sessions.reduce((sum,s)=>sum+s.minutes,0), studyDays=new Set(sessions.map(s=>s.date)).size;
  const longest=sessions.reduce((max,s)=>Math.max(max,s.minutes),0), consistency=daysInRange.length?Math.round(studyDays/daysInRange.length*100):0;
  const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
  const span = daysInRange.length ? `${dayLabel(daysInRange[0].date)} – ${dayLabel(daysInRange.at(-1).date)}` : '';
  host.innerHTML=`<section class="hw-toolbar"><div><p class="hw-range-note"><span>Range (top picker)</span><strong>${esc(RANGE_LABELS[view.range])}${span?` · ${esc(span)}`:''}</strong></p><label>Subject<select id="hw-subject">${option('all','All subjects',view.subject)}${subjects.map(subject=>option(subject,subject,view.subject)).join('')}</select></label></div><button type="button" id="hw-reset">Reset view</button></section>
  <div id="hw-revisit-slot"></div>
  ${!sessions.length?`<div class="hw-empty-state"><span aria-hidden="true">✎</span><h2>${allSessions.length?'No homework matches this view':'Your study story starts with one session.'}</h2><p>${allSessions.length?'Try a longer date range or choose all subjects.':'Log homework with MOTION and this page will automatically build your charts, averages, and subject insights.'}</p></div>`:`<section class="hw-kpis"><article><span>TOTAL STUDY TIME</span><strong>${minutesLabel(total)}</strong><small>${plural(sessions.length,'logged session')}</small></article><article><span>AVERAGE STUDY DAY</span><strong>${minutesLabel(total/studyDays)}</strong><small>across ${plural(studyDays,'active day')}</small></article><article><span>AVERAGE SESSION</span><strong>${minutesLabel(total/sessions.length)}</strong><small>longest is ${minutesLabel(longest)}</small></article><article><span>STUDY CONSISTENCY</span><strong>${consistency}%</strong><small>${studyDays} of ${plural(daysInRange.length,'day')} since your first log</small></article><article class="hw-streak-kpi"><span>CURRENT STREAK</span><strong>${currentStreak(daysInRange,sessions)} <small>${currentStreak(daysInRange,sessions)===1?'day':'days'}</small></strong><em>best ${bestStreak(daysInRange,sessions)}</em></article></section><section class="hw-chart-grid">${dailyChart(daysInRange,sessions)}${subjectChart(sessions)}${timeChart(sessions)}${weekdayChart(daysInRange,sessions)}${durationChart(sessions)}</section>${subjectDetails(sessions)}${sessionTable(sessions)}`}
  <p class="hw-method-note">Totals can include overlapping sessions. “Calculated” start = end time minus duration. “General” = homework with no subject. ${source==='sample'?'Local sample data.':''}</p>`;
  const rerender=()=>{renderHomeworkAnalytics(currentDays,currentSource);document.dispatchEvent(new CustomEvent('homework-rendered'));};
  host.querySelector('#hw-subject')?.addEventListener('change',event=>{view.subject=event.target.value;rerender();});
  host.querySelector('#hw-sort')?.addEventListener('change',event=>{view.sort=event.target.value;rerender();});
  host.querySelector('#hw-search')?.addEventListener('input',event=>{view.query=event.target.value;const position=event.target.selectionStart;rerender();const input=document.getElementById('hw-search');input?.focus();input?.setSelectionRange(position,position);});
  host.querySelector('#hw-reset')?.addEventListener('click',()=>{Object.assign(view,{subject:'all',query:'',sort:'newest'});rerender();});
  host.querySelectorAll('[data-hw-subject]').forEach(button=>button.addEventListener('click',()=>{view.subject=button.dataset.hwSubject;rerender();}));
  host.querySelectorAll('[data-hw-date]').forEach(button=>button.addEventListener('click',()=>{view.query=button.dataset.hwDate;rerender();document.querySelector('.hw-session-section')?.scrollIntoView({behavior:'smooth',block:'start'});}));
}
