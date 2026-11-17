/* Calendar and historical insights derived from existing outage records. No extra API calls. */
(function (root) {
  'use strict';
  const WEEKS = 53;
  const DAYS = WEEKS * 7;
  const HOUR = 60 * 60 * 1000;
  let selectedDay = null;

  function localDayStart(input) {
    const d = new Date(input);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function nextDay(start) {
    const d = new Date(start);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }
  function isoDay(input) {
    const d = new Date(input);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  }
  function describeDay(input) {
    return new Date(input).toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  }
  function pretty(ms) {
    if (ms === null || !Number.isFinite(ms)) return '—';
    const minutes = Math.floor(ms / 60000);
    if (minutes <= 0) return ms > 0 ? '<1m' : '0m';
    if (minutes < 60) return minutes + 'm';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ' + (minutes % 60) + 'm';
    return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  }
  function clippedMerged(outages, from, to) {
    const parts = outages.map(o => [Math.max(from, o.start), Math.min(to, o.end)])
      .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[1] > pair[0])
      .sort((a,b) => a[0] - b[0]);
    const merged = [];
    for (const part of parts) {
      const last = merged[merged.length-1];
      if (last && part[0] <= last[1]) last[1] = Math.max(last[1], part[1]);
      else merged.push(part.slice());
    }
    return merged;
  }
  function downtime(outages, from, to) {
    return clippedMerged(outages, from, to).reduce((sum, pair) => sum + pair[1] - pair[0], 0);
  }
  function buildCalendar(outages, now, weeks = WEEKS) {
    const today = localDayStart(now);
    const monday = new Date(today);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const start = new Date(monday);
    start.setDate(start.getDate() - (weeks - 1) * 7);
    const firstSeen = outages.length ? Math.min(...outages.map(o => o.start)) : Number.POSITIVE_INFINITY;
    const days = [];
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const from = d.getTime();
      const to = nextDay(from);
      const ms = downtime(outages, from, Math.min(to, now));
      const count = outages.filter(o => o.start < Math.min(to, now) && o.end > from).length;
      const future = from > now;
      const unknown = to <= firstSeen;
      const level = future || unknown ? -1 : ms === 0 ? 0 : ms < HOUR ? 1 : ms < 3 * HOUR ? 2 : ms < 6 * HOUR ? 3 : 4;
      days.push({from,to,ms,count,level,future,unknown,date:isoDay(from)});
    }
    return days;
  }
  function hourStarts(outages, from, to) {
    const counts = Array(24).fill(0);
    for (const o of outages) {
      if (o.start >= from && o.start < to) counts[new Date(o.start).getHours()]++;
    }
    return counts;
  }
  function medianIncident(outages, from, to) {
    const durations = outages.filter(o => o.start >= from && o.start < to)
      .map(o => o.end - o.start).filter(n => Number.isFinite(n) && n > 0).sort((a,b) => a-b);
    if (!durations.length) return null;
    const middle = Math.floor(durations.length / 2);
    return durations.length % 2 ? durations[middle] : (durations[middle-1] + durations[middle]) / 2;
  }
  function longestQuiet(outages, from, to) {
    if (!outages.length) return null;
    const earliest = Math.min(...outages.map(o => o.start));
    if (earliest >= to) return null;
    const start = Math.max(from, earliest);
    const merged = clippedMerged(outages, start, to);
    let cursor = start, longest = 0;
    for (const [s,e] of merged) {
      longest = Math.max(longest, s-cursor);
      cursor = Math.max(cursor,e);
    }
    return Math.max(longest,to-cursor);
  }
  function overnightRatio(outages, from, to) {
    const gaps = clippedMerged(outages, from, to);
    const total = gaps.reduce((sum, [s,e]) => sum + e-s,0);
    if (!total) return null;
    let overnight = 0;
    for (const [start,end] of gaps) {
      let cursor = start;
      while (cursor < end) {
        const d = new Date(cursor);
        const hour = d.getHours();
        const boundary = (Math.floor(cursor / HOUR) + 1) * HOUR; // monotonic across DST
        const next = Math.min(end, boundary);
        if (hour >= 22 || hour < 7) overnight += next-cursor;
        cursor = next;
      }
    }
    return overnight/total;
  }
  function renderCalendar(rootDocument, outages, now) {
    const days = buildCalendar(outages,now);
    const grid = rootDocument.getElementById('calendarGrid');
    const months = rootDocument.getElementById('calendarMonths');
    const details = rootDocument.getElementById('calendarDetails');
    if (!grid || !months || !details) return;
    grid.replaceChildren();
    months.replaceChildren();
    const earliest = outages.length ? Math.min(...outages.map(o => o.start)) : Infinity;
    let previousMonth = -1;
    for (let week = 0; week < WEEKS; week++) {
      const d = new Date(days[week*7].from);
      const nextMonth = d.getMonth();
      if (week === 0 || nextMonth !== previousMonth) {
        const label = rootDocument.createElement('span');
        label.textContent = d.toLocaleDateString(undefined,{month:'short'});
        label.style.gridColumn = String(week+1) + ' / span 4';
        // Every label shares the same row. Auto-placement could shift later months down.
        label.style.gridRow = '1';
        months.appendChild(label);
      }
      previousMonth = nextMonth;
    }
    if (selectedDay === null || !days.some(d => d.date===selectedDay)) selectedDay = isoDay(now);
    const choose = day => {
      selectedDay = day.date;
      for (const button of grid.querySelectorAll('button')) {
        button.setAttribute('aria-pressed',String(button.dataset.date === selectedDay));
        button.tabIndex = button.dataset.date === selectedDay ? 0 : -1;
      }
      details.textContent = describeDay(day.from) + ' · ' +
        (day.future?'Outside the observed period':day.unknown?'No recorded history yet':
          day.count + (day.count===1?' interruption':' interruptions') + ' · ' + pretty(day.ms) + ' recorded downtime');
    };
    for (let i=0;i<days.length;i++) {
      const day=days[i];
      const button = rootDocument.createElement('button');
      button.type='button';
      button.className = 'cal-cell' + (day.level < 0 ? ' no-data' : ' intensity-'+day.level) +
        (day.date === isoDay(now)?' today-cell':'');
      button.dataset.date=day.date;
      button.dataset.index=String(i);
      button.setAttribute('aria-label', describeDay(day.from) + ': ' +
        (day.future ? 'future' : day.unknown ? 'no history' : day.count + ' interruptions, ' + pretty(day.ms) + ' downtime'));
      button.setAttribute('aria-pressed', String(day.date === selectedDay));
      button.tabIndex=day.date===selectedDay?0:-1;
      button.title=button.getAttribute('aria-label');
      button.disabled=day.future;
      button.addEventListener('click',()=>choose(day));
      button.addEventListener('keydown', event => {
        const move = {ArrowUp:-1,ArrowDown:1,ArrowLeft:-7,ArrowRight:7};
        const delta = move[event.key];
        if(delta===undefined)return;
        event.preventDefault();
        const target = Math.max(0,Math.min(days.length-1,i+delta));
        const index = days[target].future ? days.findIndex(d=>d.date === isoDay(now)):target;
        const next = grid.querySelector('button[data-index="' + index + '"]');
        if(next) {next.focus(); choose(days[index]);}
      });
      grid.appendChild(button);
    }
    choose(days.find(d=>d.date===selectedDay) || days[days.length-1]);
    const cutoff = localDayStart(now);
    const active = days.filter(d=>!d.unknown&&!d.future&&d.from<=cutoff);
    const affected = active.filter(d=>d.ms>0).length;
    const total = active.reduce((n,d)=>n+d.ms,0);
    rootDocument.getElementById('calendarSummary').textContent =
      affected + (affected===1?' affected day':' affected days') + ' · ' + pretty(total) + ' downtime';
  }
  function renderHours(doc,outages,now) {
    const days = buildCalendar(outages,now);
    const from=days[0].from;
    const counts=hourStarts(outages,from,now);
    const chart=doc.getElementById('hourChart');
    if (!chart) return;
    chart.replaceChildren();
    const max = Math.max(...counts);
    for (let hour=0;hour<24;hour++) {
      const bar=doc.createElement('div');
      bar.className='hour-slot';
      const inner=doc.createElement('span');
      inner.className='hour-fill'+(counts[hour]===max&&max>0?' peak-hour':'');
      inner.style.height=(max>0?(counts[hour]/max*100):0)+'%';
      bar.title=String(hour).padStart(2,'0')+':00–'+String((hour+1)%24).padStart(2,'0')+':00 · '+counts[hour]+' starts';
      bar.setAttribute('aria-label',bar.title);
      bar.appendChild(inner);chart.appendChild(bar);
    }
    const peakIndex=max?counts.indexOf(max):-1;
    doc.getElementById('peakHour').textContent=peakIndex>=0?String(peakIndex).padStart(2,'0')+':00':'—';
    doc.getElementById('medianOutage').textContent=pretty(medianIncident(outages,from,now));
    doc.getElementById('quietStreak').textContent=pretty(longestQuiet(outages,from,now));
    const overnight=overnightRatio(outages,from,now);
    doc.getElementById('nightShare').textContent=overnight===null?'—':Math.round(overnight*100)+'%';
    doc.getElementById('hourSummary').textContent=max?
      counts.reduce((a,b)=>a+b,0)+' interruption starts in the last 12 months':
      'No interruption starts recorded in the last 12 months';
  }
  function renderExtendedInsights({outages,now}) {
    if (!root.document) return;
    renderCalendar(root.document,outages,now);
    renderHours(root.document,outages,now);
  }

  root.renderExtendedInsights=renderExtendedInsights;
  if (typeof module!=='undefined' && module.exports) {
    module.exports={localDayStart,nextDay,clippedMerged,downtime,buildCalendar,hourStarts,medianIncident,longestQuiet,overnightRatio};
  }
})(typeof window!=='undefined'?window:globalThis);
