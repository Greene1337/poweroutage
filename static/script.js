/* PowerOutage dashboard. Uses only the existing /api/stats and /api/outages endpoints. */
'use strict';

const $ = (id) => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 10000;
const PAGE_SIZE = 500;
const state = { outages: [], selected: 'today', loaded: false, showAll: false, lastRefresh: null };

const pad = (n) => String(n).padStart(2, '0');
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); }
function localDate(date) { return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`; }
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return `${h}h ${rem}m`;
  return `${Math.floor(h/24)}d ${h%24}h`;
}
function formatDate(ms, withDate = true) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(undefined, withDate ? {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'} : {hour:'2-digit',minute:'2-digit'});
}
function parseOutages(records) {
  return records.map((o) => ({
    id: o.id,
    start: new Date(o.start_time).getTime(),
    end: new Date(o.end_time).getTime(),
    seconds: Number(o.duration)
  })).filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start)
    .sort((a,b) => b.start-a.start);
}
function rangeFor(period, now = Date.now()) {
  const start = startOfDay(new Date(now));
  if (period === 'week') return {from: new Date(new Date(start).getFullYear(), new Date(start).getMonth(), new Date(start).getDate()-6).getTime(), to: now, unit: 'week'};
  if (period === 'month') return {from: new Date(new Date(start).getFullYear(), new Date(start).getMonth(), new Date(start).getDate()-29).getTime(), to: now, unit: 'month'};
  return {from: start, to: now, unit: 'today'};
}
function mergedGaps(outages, from, to) {
  const intervals = outages.map((o) => [Math.max(from, o.start),Math.min(to,o.end)]).filter(([s,e]) => e > s).sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for (const [s,e] of intervals) {
    const last=merged[merged.length-1];
    if (last && s <= last[1]) last[1]=Math.max(e,last[1]);
    else merged.push([s,e]);
  }
  return merged;
}
function analyze(outages, from, to) {
  const gaps=mergedGaps(outages,from,to);
  const downtime=gaps.reduce((sum,[s,e])=>sum+e-s,0);
  const total=Math.max(0,to-from);
  const count=outages.filter((o)=>o.start<to && o.end>from).length;
  const longest=gaps.reduce((max,[s,e])=>Math.max(max,e-s),0);
  return {gaps,downtime,total,count,longest,uptime:Math.max(0,total-downtime),pct:total?100*(total-downtime)/total:null};
}
function timelineParts(gaps, from, to, endOfView, unknownBefore = null) {
  const parts=[];
  let cursor=from;
  const boundary=Math.min(endOfView,to);
  const add=(start,end,kind)=>{if(end>start)parts.push({start,end,kind});};
  for (const [start,end] of gaps) {
    if (start>=boundary) break;
    if (start>cursor) add(cursor,start,'online');
    add(Math.max(start,cursor),Math.min(end,boundary),'down');
    cursor=Math.max(cursor,Math.min(end,boundary));
  }
  add(cursor,boundary,'online');
  add(boundary,to,'unknown');
  // A new empty installation has no evidence of prior monitoring.
  if (unknownBefore !== null) {
    const cut=Math.min(Math.max(unknownBefore,from),to);
    return parts.flatMap(p=>p.end<=cut?[{...p,kind:'unknown'}]:p.start>=cut?[p]:[{start:p.start,end:cut,kind:'unknown'},{start:cut,end:p.end,kind:p.kind}]);
  }
  return parts;
}
function paintTrack(el,parts,from,to) {
  el.replaceChildren();
  for (const p of parts) {
    const node=document.createElement('span');
    node.className='segment'+(p.kind==='down'?' down':p.kind==='unknown'?' unknown':'');
    node.style.flex=`${p.end-p.start} 1 0`;
    node.title=`${p.kind==='down'?'Interruption':p.kind==='unknown'?'Not observed':'No interruption recorded'}: ${formatDate(p.start)} – ${formatDate(p.end)}`;
    el.appendChild(node);
  }
}
function renderSevenDays(now) {
  const rows=$('weekRows');rows.replaceChildren();
  const today=startOfDay(new Date(now));
  const earliest=state.outages.length?Math.min(...state.outages.map(o=>o.start)):now;
  for(let i=6;i>=0;i--) {
    const startDate=new Date(today);startDate.setDate(startDate.getDate()-i);
    const start=startDate.getTime(),end=new Date(startDate.getFullYear(),startDate.getMonth(),startDate.getDate()+1).getTime();
    const observedEnd=Math.min(end,now);
    const stats=analyze(state.outages,start,Math.max(start,observedEnd));
    const row=document.createElement('div');row.className='weekrow';
    const label=document.createElement('div');label.className='day';
    const name=startDate.toLocaleDateString(undefined,{weekday:'short'});
    const day=document.createElement(i===0?'b':'span');day.textContent=`${name} ${startDate.getDate()}`;label.appendChild(day);
    const bar=document.createElement('div');bar.className='weekbar';
    const gaps=mergedGaps(state.outages,start,end);
    const parts=timelineParts(gaps,start,end,now,earliest);
    for(const part of parts){if(part.kind==='online')continue;const piece=document.createElement('span');piece.className='slice'+(part.kind==='unknown'?' unknown':'');piece.style.left=`${100*(part.start-start)/(end-start)}%`;piece.style.width=`${100*(part.end-part.start)/(end-start)}%`;piece.title=`${part.kind==='down'?'Interruption':'Not observed'}: ${formatDate(part.start)} – ${formatDate(part.end)}`;bar.appendChild(piece);}
    const pct=document.createElement('div');pct.className='pct';pct.textContent=observedEnd>Math.max(start,earliest)?`${stats.pct.toFixed(1)}%`:'—';
    // Tooltip is an estimate over the elapsed part of the day.
    row.append(label,bar,pct);rows.appendChild(row);
  }
}
function renderEvents() {
  const el=$('eventList');el.replaceChildren();
  if(!state.outages.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No interruptions recorded yet.';el.appendChild(empty);}
  const visible=state.showAll?state.outages:state.outages.slice(0,5);
  for(const o of visible) {
    const row=document.createElement('div');row.className='event';
    const time=document.createElement('div');time.className='event-time';time.textContent=formatDate(o.start);
    const title=document.createElement('div');title.className='event-main';title.textContent='Interrupted';
    title.title=`Restored ${formatDate(o.end)}`;
    const duration=document.createElement('div');duration.className='duration';duration.textContent=formatDuration(o.end-o.start);
    row.append(time,title,duration);el.appendChild(row);
  }
  const more=$('showMore');more.classList.toggle('hidden',state.outages.length<=5);
  more.textContent=state.showAll?'Show fewer incidents':`Show all ${state.outages.length} incidents`;
  $('exportCsv').disabled=!state.outages.length;
}
function render(now=Date.now()) {
  if(!state.loaded)return;
  const labels={today:['today','today','Today'],week:['last 7 days','last 7 days','7 days'],month:['last 30 days','last 30 days','30 days']};
  const [periodLabel,timelineTitle,patternLabel]=labels[state.selected];
  $('periodLabel').textContent=periodLabel;$('periodLabel2').textContent=periodLabel;$('timelineTitle').textContent=`· ${timelineTitle}`;$('insightPeriod').textContent=patternLabel;
  for(const b of document.querySelectorAll('[data-period]'))b.setAttribute('aria-pressed',String(b.dataset.period===state.selected));
  const {from,to}=rangeFor(state.selected,now);
  const s=analyze(state.outages,from,to);
  $('availability').textContent=s.pct===null?'—':s.pct.toFixed(1);
  $('availabilityMeter').style.width=`${s.pct||0}%`;
  $('uptimeLabel').textContent=formatDuration(s.uptime);
  $('count').textContent=String(s.count);
  $('longest').textContent=s.count?formatDuration(s.longest):'—';
  $('totalDowntime').textContent=formatDuration(s.downtime);
  $('averageOutage').textContent=s.count?formatDuration(s.downtime/s.count):'—';
  const recent=state.outages.filter(o=>o.start<to&&o.end>from);
  if (recent.length) {
    const longest=recent.reduce((best,o)=>(Math.min(to,o.end)-Math.max(from,o.start) > Math.min(to,best.end)-Math.max(from,best.start)?o:best),recent[0]);
    $('insightText').textContent=`${s.count} interruption${s.count===1?'':'s'} recorded in this period. The longest lasted ${formatDuration(Math.min(to,longest.end)-Math.max(from,longest.start))}.`;
  } else $('insightText').textContent='No interruptions recorded in this period.';
  const earliest=state.outages.length?Math.min(...state.outages.map(o=>o.start)):now;
  const endView=state.selected==='today'?new Date(new Date(from).getFullYear(),new Date(from).getMonth(),new Date(from).getDate()+1).getTime():new Date(new Date(startOfDay(new Date(now))).getFullYear(),new Date(startOfDay(new Date(now))).getMonth(),new Date(startOfDay(new Date(now))).getDate()+1).getTime();
  const gaps=mergedGaps(state.outages,from,endView);
  const parts=timelineParts(gaps,from,endView,now,earliest);
  paintTrack($('mainTrack'),parts,from,endView);
  if(state.selected==='today'){$('tickLabels').innerHTML='<span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>';$('timelineSubtitle').textContent='Today · midnight to midnight';}
  else {
    const slots=state.selected==='week'?7:5;
    const labels=[];
    for(let i=0;i<slots;i++){const t=from+(endView-from)*(i/(slots-1));labels.push(new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'}));}
    $('tickLabels').replaceChildren(...labels.map(t=>{const x=document.createElement('span');x.textContent=t;return x;}));
    $('timelineSubtitle').textContent=`${patternLabel} · calendar timeline`;
  }
  renderSevenDays(now);
  // The decorative mini trend becomes actual per-day interruption minutes.
  const spark=$('sparkline');spark.replaceChildren();
  const days=state.selected==='month'?15:state.selected==='week'?7:12;
  for(let i=days-1;i>=0;i--){const end=new Date(now);end.setHours(0,0,0,0);end.setDate(end.getDate()-i);const begin=end.getTime();const finish=new Date(end.getFullYear(),end.getMonth(),end.getDate()+1).getTime();const d=analyze(state.outages,begin,Math.min(finish,now));const bar=document.createElement('i');bar.style.height=`${Math.max(10,Math.min(100,d.downtime/DAY*100))}%`;bar.title=`${localDate(end)} · ${formatDuration(d.downtime)} downtime`;spark.appendChild(bar);}
  renderEvents();
}
async function getJson(url) {
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok)throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}
async function refresh() {
  try {
    const stats=await getJson('/api/stats');
    let records=[];
    for(let skip=0;skip<MAX_EVENTS;skip+=PAGE_SIZE){const page=await getJson(`/api/outages?skip=${skip}&limit=${PAGE_SIZE}`);if(!Array.isArray(page))throw new Error('Unexpected outage response');records.push(...page);if(page.length<PAGE_SIZE)break;}
    state.outages=parseOutages(records);state.loaded=true;state.lastRefresh=Date.now();
    $('connectionDot').classList.remove('error');$('connectionLabel').textContent='Monitoring active';
    $('statusPanel').classList.remove('is-error');$('statusTitle').textContent='Monitor online';
    $('statusDescription').textContent='API reachable. Power availability is inferred from the monitored host.';
    $('errorNote').classList.add('hidden');
    const latest=state.outages[0];
    $('lastOutage').textContent=latest?`${formatDate(latest.start)} – ${formatDate(latest.end,false)}`:'No incidents yet';
    $('updatedAt').textContent=`Updated ${new Date(state.lastRefresh).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    render(state.lastRefresh);
  } catch(e) {
    $('connectionDot').classList.add('error');$('connectionLabel').textContent='Connection lost';
    $('statusPanel').classList.add('is-error');$('statusTitle').textContent='Monitor unreachable';
    $('statusDescription').textContent='Unable to update data; last successful readings are retained below.';
    $('errorNote').textContent=`Data could not be refreshed: ${e.message}`;$('errorNote').classList.remove('hidden');
    $('updatedAt').textContent=state.lastRefresh?`Last updated ${formatDate(state.lastRefresh)}`:'No successful refresh yet';
  }
}
function exportCsv() {
  const rows=[['id','start_time','end_time','duration_seconds'],...state.outages.map(o=>[o.id,new Date(o.start).toISOString(),new Date(o.end).toISOString(),(o.end-o.start)/1000])];
  const csv=rows.map(row=>row.join(',')).join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`poweroutage-${localDate(new Date())}.csv`;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{state.selected=b.dataset.period;render();}));
$('showMore').addEventListener('click',()=>{state.showAll=!state.showAll;renderEvents();});
$('exportCsv').addEventListener('click',exportCsv);
refresh();
setInterval(refresh,60_000);
