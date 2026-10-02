const view = { range: '30', subject: 'all', query: '', sort: 'newest' };
const SUBJECT_COLORS = ['#7650cf','#ee6b46','#008c72','#d69b00','#3178c6','#dd4f87','#6771db','#25a5a0'];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const cleanSubject = value => String(value || 'Unspecified').trim() || 'Unspecified';
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
const hash = value => [...String(value)].reduce((sum,char) => ((sum << 5) - sum + char.charCodeAt(0)) | 0, 0);
const colorFor = subject => SUBJECT_COLORS[Math.abs(hash(subject)) % SUBJECT_COLORS.length];
const average = values => values.length ? values.reduce((sum,value)=>sum+value,0) / values.length : 0;

function sourceSessions(days) {
  return days.flatMap(day => {
    const timed = (day.sessions || []).filter(session => session.activity === 'hmwk').map((session,index) => {
      const minutes = Math.max(0, Number(session.minutes) || 0);
      let startMinute = clockMinute(session.start), endMinute = clockMinute(session.end), calculated = false;
      if (startMinute == null && endMinute != null && minutes) { startMinute = (endMinute - minutes + 1440) % 1440; calculated = true; }
      if (endMinute == null && startMinute != null && minutes) { endMinute = (startMinute + minutes) % 1440; calculated = true; }
      return { ...session, date:day.date, minutes, subject:cleanSubject(session.subject), label:session.label || session.name || session.task || cleanSubject(session.subject), startMinute, endMinute, calculated, key:`${day.date}-${index}` };
    }).filter(session => session.minutes > 0);
    if (timed.length) return timed;
    const subjects = Object.entries(day.hmwk_by_subject || {}).filter(([,minutes]) => Number(minutes) > 0);
    if (subjects.length) return subjects.map(([subject,minutes],index) => ({ date:day.date, minutes:Number(minutes), subject:cleanSubject(subject), label:cleanSubject(subject), startMinute:null, endMinute:null, calculated:false, aggregate:true, key:`${day.date}-aggregate-${index}` }));
    return Number(day.hmwk_minutes) > 0 ? [{ date:day.date, minutes:Number(day.hmwk_minutes), subject:'Unspecified', label:'Homework', startMinute:null, endMinute:null, calculated:false, aggregate:true, key:`${day.date}-aggregate` }] : [];
  });
}

function rangeDays(days) {
  const dated = days.filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day.date || '')).sort((a,b)=>a.date.localeCompare(b.date));
  if (!dated.length) return [];
  const byDate=new Map(dated.map(day=>[day.date,day])), latest=localDate(dated.at(-1).date);
  const cutoff=view.range==='all'?localDate(dated[0].date):new Date(latest);
  if (view.range!=='all') cutoff.setDate(cutoff.getDate()-Number(view.range)+1);
  const result=[];
  for (const cursor=new Date(cutoff);cursor<=latest;cursor.setDate(cursor.getDate()+1)) {
    const key=`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
    result.push(byDate.get(key)||{date:key,sessions:[],hmwk_minutes:0,hmwk_by_subject:{}});
  }
  return result;
}

function groupSum(items, keyFn) {
  const groups = new Map();
  items.forEach(item => { const key=keyFn(item); groups.set(key,(groups.get(key)||0)+item.minutes); });
  return [...groups].map(([key,minutes])=>({key,minutes})).sort((a,b)=>b.minutes-a.minutes);
}

function currentStreak(days, sessions) {
  if (!days.length) return 0;
  const studied = new Set(sessions.map(session=>session.date));
  let date = localDate(days.at(-1).date), count = 0;
  while (studied.has(date.toISOString().slice(0,10))) { count += 1; date.setDate(date.getDate()-1); }
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
  return `<article class="hw-card hw-daily-card"><div class="hw-card-title"><div><span>PACE</span><h3>Study minutes by day</h3></div><strong>${minutesLabel(avg)}<small>daily avg</small></strong></div><div class="hw-daily-chart" role="img" aria-label="Daily homework minutes">${shown.map((day,index)=>`<button class="hw-day-bar" type="button" data-hw-date="${day.date}" title="${longDayLabel(day.date)}: ${minutesLabel(day.minutes)}"><i style="height:${Math.max(day.minutes ? 8 : 2,day.minutes/max*100)}%;--bar:${day.minutes ? '#7650cf' : '#e9e3f4'}"></i>${index===0||index===shown.length-1||index%7===0?`<span>${dayLabel(day.date)}</span>`:''}</button>`).join('')}<div class="hw-average-line" style="bottom:${Math.min(100,avg/max*100)}%"><span>avg</span></div></div><p class="hw-caption">${daily.length>shown.length?`Showing the latest ${shown.length} days. `:''}Select any bar to filter the session details below.</p></article>`;
}

function subjectChart(sessions) {
  const groups=groupSum(sessions,s=>s.subject), total=sessions.reduce((sum,s)=>sum+s.minutes,0);
  if (!groups.length) return emptyChart('No subjects in this view yet.');
  let angle=0;
  const segments=groups.map(group=>{const from=angle;angle+=group.minutes/total*360;return `${colorFor(group.key)} ${from}deg ${angle}deg`;}).join(',');
  return `<article class="hw-card"><div class="hw-card-title"><div><span>SUBJECT MIX</span><h3>Where study time goes</h3></div></div><div class="hw-subject-layout"><div class="hw-donut" style="background:conic-gradient(${segments})"><div><strong>${minutesLabel(total)}</strong><span>total</span></div></div><div class="hw-ranked-bars">${groups.map(group=>`<button type="button" data-hw-subject="${esc(group.key)}"><span><i style="background:${colorFor(group.key)}"></i>${esc(group.key)}</span><b>${minutesLabel(group.minutes)} · ${Math.round(group.minutes/total*100)}%</b><em><i style="width:${group.minutes/groups[0].minutes*100}%;background:${colorFor(group.key)}"></i></em></button>`).join('')}</div></div></article>`;
}

function timeChart(sessions) {
  const timed=sessions.filter(s=>s.startMinute!=null), buckets=Array.from({length:24},(_,hour)=>({hour,minutes:0}));
  timed.forEach(session=>buckets[Math.floor(session.startMinute/60)%24].minutes+=session.minutes);
  const max=Math.max(1,...buckets.map(b=>b.minutes)), peak=[...buckets].sort((a,b)=>b.minutes-a.minutes)[0];
  return `<article class="hw-card"><div class="hw-card-title"><div><span>FOCUS CLOCK</span><h3>When you tend to study</h3></div><strong>${timed.length?clockLabel(peak.hour*60):'—'}<small>${timed.length?'peak start hour':'timestamps needed'}</small></strong></div><div class="hw-hour-chart">${buckets.map(bucket=>`<div title="${clockLabel(bucket.hour*60)}: ${minutesLabel(bucket.minutes)}"><i style="height:${Math.max(bucket.minutes?7:2,bucket.minutes/max*100)}%"></i>${bucket.hour%6===0?`<span>${bucket.hour===0?'12a':bucket.hour<12?bucket.hour+'a':bucket.hour===12?'12p':bucket.hour-12+'p'}</span>`:''}</div>`).join('')}</div><p class="hw-caption">Based on ${timed.length} ${timed.length===1?'session':'sessions'} with a start or end time.</p></article>`;
}

function weekdayChart(days,sessions) {
  const buckets=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(label=>({label,total:0,days:0}));
  days.forEach(day=>{const index=localDate(day.date)?.getDay();if(index!=null){buckets[index].days++;buckets[index].total+=sessions.filter(s=>s.date===day.date).reduce((sum,s)=>sum+s.minutes,0);}});
  buckets.forEach(bucket=>bucket.avg=bucket.days?bucket.total/bucket.days:0);
  const max=Math.max(1,...buckets.map(b=>b.avg)), best=[...buckets].sort((a,b)=>b.avg-a.avg)[0];
  return `<article class="hw-card"><div class="hw-card-title"><div><span>WEEKLY RHYTHM</span><h3>Average by weekday</h3></div><strong>${best.avg?best.label:'—'}<small>strongest day</small></strong></div><div class="hw-weekday-chart">${buckets.map(bucket=>`<div><span>${minutesLabel(bucket.avg)}</span><i style="height:${Math.max(bucket.avg?8:2,bucket.avg/max*100)}%"></i><b>${bucket.label}</b></div>`).join('')}</div></article>`;
}

function durationChart(sessions) {
  const buckets=[{label:'Quick win',hint:'Under 15m',test:m=>m<15},{label:'Sprint',hint:'15–29m',test:m=>m>=15&&m<30},{label:'Focus block',hint:'30–59m',test:m=>m>=30&&m<60},{label:'Deep work',hint:'60m+',test:m=>m>=60}].map(bucket=>({...bucket,count:sessions.filter(s=>bucket.test(s.minutes)).length}));
  const max=Math.max(1,...buckets.map(b=>b.count));
  return `<article class="hw-card"><div class="hw-card-title"><div><span>SESSION SHAPE</span><h3>How long your blocks run</h3></div></div><div class="hw-duration-chart">${buckets.map((bucket,index)=>`<div><span><b>${bucket.label}</b><small>${bucket.hint}</small></span><em><i style="width:${bucket.count/max*100}%;--duration-index:${index}"></i></em><strong>${bucket.count}</strong></div>`).join('')}</div></article>`;
}

function heatmap(days,sessions) {
  const totals=new Map(groupSum(sessions,s=>s.date).map(group=>[group.key,group.minutes])), max=Math.max(1,...totals.values());
  return `<article class="hw-card hw-heat-card"><div class="hw-card-title"><div><span>CONSISTENCY MAP</span><h3>Your study trail</h3></div><div class="hw-heat-key"><span>less</span>${[0,.25,.5,.75,1].map(level=>`<i style="--heat:${level}"></i>`).join('')}<span>more</span></div></div><div class="hw-heatmap">${days.slice(-112).map(day=>{const amount=totals.get(day.date)||0;return `<button type="button" data-hw-date="${day.date}" style="--heat:${amount/max}" title="${longDayLabel(day.date)}: ${minutesLabel(amount)}" aria-label="${longDayLabel(day.date)}, ${minutesLabel(amount)}"></button>`;}).join('')}</div><p class="hw-caption">Each square is one calendar day. Darker squares mean more study time.</p></article>`;
}

function emptyChart(message) { return `<article class="hw-card hw-empty-mini"><span>✦</span><p>${esc(message)}</p></article>`; }

function insights(days,sessions) {
  const subjects=groupSum(sessions,s=>s.subject), timed=sessions.filter(s=>s.startMinute!=null);
  const periods=[{label:'morning',from:0,to:720},{label:'afternoon',from:720,to:1080},{label:'evening',from:1080,to:1440}].map(period=>({...period,minutes:timed.filter(s=>s.startMinute>=period.from&&s.startMinute<period.to).reduce((sum,s)=>sum+s.minutes,0)})).sort((a,b)=>b.minutes-a.minutes);
  const longest=[...sessions].sort((a,b)=>b.minutes-a.minutes)[0], averageStart=timed.length?average(timed.map(s=>s.startMinute)):null;
  const cards=[
    {icon:'◷',title:'Your focus window',value:timed.length?`${periods[0].label[0].toUpperCase()+periods[0].label.slice(1)} leads`:'Needs timestamps',copy:timed.length?`${minutesLabel(periods[0].minutes)} begins in the ${periods[0].label}; your average start is ${clockLabel(averageStart)}.`:'Log a start or end time to reveal when your study energy peaks.'},
    {icon:'★',title:'Top subject',value:subjects[0]?.key||'Not logged',copy:subjects.length?`${minutesLabel(subjects[0].minutes)} invested, or ${Math.round(subjects[0].minutes/sessions.reduce((n,s)=>n+s.minutes,0)*100)}% of this view.`:'Subjects make the dashboard much more useful.'},
    {icon:'↗',title:'Longest push',value:longest?minutesLabel(longest.minutes):'—',copy:longest?`${longest.subject} on ${longDayLabel(longest.date)}${longest.label!==longest.subject?` · ${longest.label}`:''}.`:'Your longest session will appear here.'},
    {icon:'⚡',title:'Momentum',value:`${currentStreak(days,sessions)} day streak`,copy:`Best streak in this view: ${bestStreak(days,sessions)} days. Consistency is based only on logged homework.`}
  ];
  return `<section class="hw-insights"><div class="hw-section-heading"><div><span>COACH'S NOTES</span><h2>What your study data is saying</h2></div></div><div class="hw-insight-grid">${cards.map(card=>`<article><i>${card.icon}</i><div><span>${card.title}</span><strong>${esc(card.value)}</strong><p>${esc(card.copy)}</p></div></article>`).join('')}</div></section>`;
}

function subjectDetails(sessions) {
  const total=sessions.reduce((sum,s)=>sum+s.minutes,0), groups=groupSum(sessions,s=>s.subject);
  return `<section class="hw-subject-details"><div class="hw-section-heading"><div><span>SUBJECT BREAKDOWN</span><h2>Every course, unpacked</h2><p>Compare time invested, session size, frequency, and share of your logged work.</p></div></div><div class="hw-subject-grid">${groups.map((group,index)=>{const own=sessions.filter(s=>s.subject===group.key),days=new Set(own.map(s=>s.date)).size,longest=Math.max(...own.map(s=>s.minutes));return `<button type="button" data-hw-subject="${esc(group.key)}" style="--subject:${colorFor(group.key)}"><span class="hw-subject-rank">${String(index+1).padStart(2,'0')}</span><i></i><h3>${esc(group.key)}</h3><strong>${minutesLabel(group.minutes)}</strong><div><span><b>${own.length}</b> sessions</span><span><b>${minutesLabel(average(own.map(s=>s.minutes)))}</b> avg</span><span><b>${days}</b> study days</span><span><b>${minutesLabel(longest)}</b> longest</span></div><em>${total?Math.round(group.minutes/total*100):0}% of study time</em></button>`;}).join('')||'<div class="hw-empty-wide">Add a subject to your INSTINCT homework logs to compare courses here.</div>'}</div></section>`;
}

function sessionTable(sessions) {
  const query=view.query.trim().toLowerCase();
  let rows=sessions.filter(session=>!query||`${session.subject} ${session.label} ${session.date}`.toLowerCase().includes(query));
  rows=[...rows].sort((a,b)=>view.sort==='longest'?b.minutes-a.minutes:view.sort==='subject'?a.subject.localeCompare(b.subject)||b.date.localeCompare(a.date):b.date.localeCompare(a.date)||(b.startMinute??-1)-(a.startMinute??-1));
  return `<section class="hw-session-section"><div class="hw-section-heading hw-session-heading"><div><span>SESSION EXPLORER</span><h2>The work behind the numbers</h2><p>${rows.length} matching ${rows.length===1?'session':'sessions'} · averages use logged sessions only.</p></div><div class="hw-session-controls"><label><span class="sr-only">Search study sessions</span><input id="hw-search" type="search" placeholder="Search subject or assignment…" value="${esc(view.query)}"></label><label><span class="sr-only">Sort study sessions</span><select id="hw-sort"><option value="newest" ${view.sort==='newest'?'selected':''}>Newest first</option><option value="longest" ${view.sort==='longest'?'selected':''}>Longest first</option><option value="subject" ${view.sort==='subject'?'selected':''}>By subject</option></select></label></div></div><div class="hw-session-table"><div class="hw-session-row hw-session-header"><span>Date</span><span>Subject & assignment</span><span>Time</span><span>Duration</span></div>${rows.map(session=>`<article class="hw-session-row"><span><strong>${dayLabel(session.date)}</strong><small>${localDate(session.date)?.toLocaleDateString('en-US',{weekday:'long'})||''}</small></span><span><i style="background:${colorFor(session.subject)}"></i><strong>${esc(session.subject)}</strong><small>${esc(session.label===session.subject?'Homework':session.label)}</small></span><span><strong>${session.startMinute!=null?clockLabel(session.startMinute):'Not timed'}</strong><small>${session.endMinute!=null?`to ${clockLabel(session.endMinute)}`:session.aggregate?'daily total':'end not logged'}${session.calculated?' · calculated':''}</small></span><span><b>${minutesLabel(session.minutes)}</b></span></article>`).join('')||'<div class="hw-empty-wide">No sessions match these filters.</div>'}</div></section>`;
}

let currentDays=[], currentSource='';
export function renderHomeworkAnalytics(days, source) {
  currentDays=days;currentSource=source;
  const host=document.getElementById('homework-dashboard');
  if (!host) return;
  const allSessions=sourceSessions(days), subjects=[...new Set(allSessions.map(s=>s.subject))].sort();
  const daysInRange=rangeDays(days), dateSet=new Set(daysInRange.map(day=>day.date));
  const rangeSessions=allSessions.filter(session=>dateSet.has(session.date));
  const sessions=view.subject==='all'?rangeSessions:rangeSessions.filter(session=>session.subject===view.subject);
  const total=sessions.reduce((sum,s)=>sum+s.minutes,0), studyDays=new Set(sessions.map(s=>s.date)).size;
  const longest=sessions.reduce((max,s)=>Math.max(max,s.minutes),0), consistency=daysInRange.length?Math.round(studyDays/daysInRange.length*100):0;
  const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
  host.innerHTML=`<header class="hw-hero"><div class="hw-hero-copy"><span class="hw-level">STUDY LAB · LEVEL UP YOUR LEARNING</span><h1>Turn homework into <em>progress you can see.</em></h1><p>Explore every subject, find your best study rhythm, and see exactly where your time is going. All numbers come from your INSTINCT logs.</p></div><div class="hw-hero-orbit" aria-hidden="true"><div><b>${studyDays}</b><span>study<br>days</span></div><i>✦</i><i>✎</i><i>⚡</i></div></header>
  <section class="hw-toolbar"><div><label>Time range<select id="hw-range">${[['7','Last 7 days'],['14','Last 14 days'],['30','Last 30 days'],['90','Last 90 days'],['all','All logged time']].map(([value,label])=>option(value,label,view.range)).join('')}</select></label><label>Subject<select id="hw-subject">${option('all','All subjects',view.subject)}${subjects.map(subject=>option(subject,subject,view.subject)).join('')}</select></label></div><button type="button" id="hw-reset">Reset view</button></section>
  ${!sessions.length?`<div class="hw-empty-state"><span>✎</span><h2>${allSessions.length?'No homework matches this view':'Your study story starts with one session.'}</h2><p>${allSessions.length?'Try a longer date range or choose all subjects.':'Log homework with INSTINCT and this page will automatically build your charts, averages, and subject insights.'}</p></div>`:`<section class="hw-kpis"><article><span>TOTAL STUDY TIME</span><strong>${minutesLabel(total)}</strong><small>${sessions.length} logged sessions</small></article><article><span>AVERAGE STUDY DAY</span><strong>${minutesLabel(total/studyDays)}</strong><small>across ${studyDays} active days</small></article><article><span>AVERAGE SESSION</span><strong>${minutesLabel(total/sessions.length)}</strong><small>longest is ${minutesLabel(longest)}</small></article><article><span>STUDY CONSISTENCY</span><strong>${consistency}%</strong><small>${studyDays} of ${daysInRange.length} days</small></article><article class="hw-streak-kpi"><span>CURRENT STREAK</span><strong>${currentStreak(daysInRange,sessions)} <small>days</small></strong><em>best ${bestStreak(daysInRange,sessions)}</em></article></section><section class="hw-chart-grid">${dailyChart(daysInRange,sessions)}${subjectChart(sessions)}${timeChart(sessions)}${weekdayChart(daysInRange,sessions)}${durationChart(sessions)}${heatmap(daysInRange,sessions)}</section>${insights(daysInRange,sessions)}${subjectDetails(sessions)}${sessionTable(sessions)}`}
  <p class="hw-method-note">Logged data, not grades. Totals can include overlapping sessions. A start time marked “calculated” is derived from the logged end time minus duration. ${source==='sample'?'You are currently viewing preview data.':''}</p>`;
  const rerender=()=>renderHomeworkAnalytics(currentDays,currentSource);
  host.querySelector('#hw-range')?.addEventListener('change',event=>{view.range=event.target.value;rerender();});
  host.querySelector('#hw-subject')?.addEventListener('change',event=>{view.subject=event.target.value;rerender();});
  host.querySelector('#hw-sort')?.addEventListener('change',event=>{view.sort=event.target.value;rerender();});
  host.querySelector('#hw-search')?.addEventListener('input',event=>{view.query=event.target.value;const position=event.target.selectionStart;rerender();const input=document.getElementById('hw-search');input?.focus();input?.setSelectionRange(position,position);});
  host.querySelector('#hw-reset')?.addEventListener('click',()=>{Object.assign(view,{range:'30',subject:'all',query:'',sort:'newest'});rerender();});
  host.querySelectorAll('[data-hw-subject]').forEach(button=>button.addEventListener('click',()=>{view.subject=button.dataset.hwSubject;rerender();}));
  host.querySelectorAll('[data-hw-date]').forEach(button=>button.addEventListener('click',()=>{view.query=button.dataset.hwDate;rerender();document.querySelector('.hw-session-section')?.scrollIntoView({behavior:'smooth',block:'start'});}));
}
