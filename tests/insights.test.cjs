// Run with: node --test tests/insights.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  localDayStart, nextDay, clippedMerged, downtime,
  buildCalendar, hourStarts, medianIncident, longestQuiet, overnightRatio
} = require('../static/insights.js');

const at = (year,month,day,hour=0,minute=0) => new Date(year,month-1,day,hour,minute).getTime();

test('overlapping gaps are merged rather than double counted', () => {
  const records=[
    { start:at(2026,11,16,8), end:at(2026,11,16,11) },
    { start:at(2026,11,16,10), end:at(2026,11,16,12) }
  ];
  assert.equal(clippedMerged(records,at(2026,11,16),at(2026,11,17)).length,1);
  assert.equal(downtime(records,at(2026,11,16),at(2026,11,17)),4*3600000);
});

test('overnight incident contributes to both dates', () => {
  const records=[{start:at(2026,11,15,23),end:at(2026,11,16,2)}];
  assert.equal(downtime(records,at(2026,11,15),at(2026,11,16)),3600000);
  assert.equal(downtime(records,at(2026,11,16),at(2026,11,17)),2*3600000);
});

test('calendar is 53 Monday-first weeks; today is known and future is muted', () => {
  const records=[{start:at(2026,11,15,23),end:at(2026,11,16,2)}];
  const days=buildCalendar(records,at(2026,11,16,18));
  assert.equal(days.length,371);
  assert.equal(new Date(days[0].from).getDay(),1);
  assert.equal(days.find(d=>d.date==='2026-11-16').ms,2*3600000);
  assert.equal(days.find(d=>d.date==='2026-11-14').unknown,true);
  assert.equal(days.find(d=>d.date==='2026-11-17').future,true);
});

test('hourly buckets use interruption starts and median uses event durations', () => {
  const records=[
    {start:at(2026,11,15,23),end:at(2026,11,16,2)},
    {start:at(2026,11,16,23),end:at(2026,11,17)}
  ];
  const from=at(2026,11,15),to=at(2026,11,18);
  assert.equal(hourStarts(records,from,to)[23],2);
  assert.equal(medianIncident(records,from,to),2*3600000);
});

test('longest quiet stretch excludes pre-monitoring time', () => {
  const records=[
    {start:at(2026,11,16,8),end:at(2026,11,16,9)},
    {start:at(2026,11,16,12),end:at(2026,11,16,13)}
  ];
  assert.equal(longestQuiet(records,at(2026,11,15),at(2026,11,16,15)),3*3600000);
});

test('night fraction splits a gap across 07:00 and 22:00', () => {
  const records=[{start:at(2026,11,16,21),end:at(2026,11,17,8)}];
  assert.equal(overnightRatio(records,at(2026,11,16,21),at(2026,11,17,8)),9/11);
  assert.equal(overnightRatio([],at(2026,11,16),at(2026,11,17)),null);
});

test('local day boundaries remain valid', () => {
  assert.equal(localDayStart(at(2026,11,16,21)),at(2026,11,16));
  assert.equal(nextDay(at(2026,11,16)),at(2026,11,17));
});
