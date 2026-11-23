import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMonitoringHealth} from './monitoring-health.js';
const now=new Date('2026-11-23T08:00:00.000Z');
test('healthy collector and rotation use recorded success and failure counts',()=>{
 const input={
  lastChaosSuccess:'2026-11-23T07:56:00Z',
  chaosSamples:[{at:'2026-11-23T07:50:00Z'},{at:'2026-11-23T07:55:00Z'}],
  clans:{'2':{id:'2',name:'Clan B',lastSampleAt:'2026-11-23T07:15:00Z',samples:[{at:'2026-11-23T07:15:00Z'}]}},
  trackedToday:1,candidateCount:86,cycleMinutes:55,
  recentBatches:[{attempted:'2026-11-23T07:55:00Z',requested:8,success:7,errors:[{id:'5',reason:'HTTP 503'}]}]
 };
 const result=analyzeMonitoringHealth(input,now);
 assert.equal(result.chaos.state,'healthy');
 assert.equal(result.chaos.observedGaps,0);
 assert.equal(result.rotating.state,'healthy');
 assert.equal(result.rotating.failed,1);
 assert.equal(result.rotating.staleCount,0);
 assert.equal(result.rotating.recentFailures[0].id,'5');
 assert.equal(result.rotating.totalRankedOtherClans,86);
});
test('observed gaps require two real snapshots and stale clans use expected cycle',()=>{
 const data=analyzeMonitoringHealth({
  lastChaosSuccess:'2026-11-23T07:40:00Z',
  chaosSamples:[{at:'2026-11-23T07:10:00Z'},{at:'2026-11-23T07:30:00Z'}],
  clans:{'4':{id:'4',name:'Old Clan',lastSampleAt:'2026-11-23T06:45:00Z',samples:[{at:'2026-11-23T06:45:00Z'}]}},
  cycleMinutes:55,trackedToday:0,recentBatches:[]
 },now);
 assert.equal(data.chaos.state,'stale');
 assert.equal(data.chaos.observedGaps,1);
 assert.equal(data.chaos.largestObservedGapMinutes,20);
 assert.equal(data.rotating.staleCount,1);
 assert.equal(data.rotating.state,'not-started');
});
test('no saved samples means no invented gaps or missing-clan failure count',()=>{
 const report=analyzeMonitoringHealth({clans:{},recentBatches:[],candidateCount:86},now);
 assert.equal(report.chaos.snapshots,0);
 assert.equal(report.chaos.observedGaps,0);
 assert.equal(report.rotating.staleCount,0);
 assert.equal(report.rotating.failed,0);
 assert.equal(report.rotating.state,'not-started');
});
test('all-failed batches appear as failures instead of disappearing',()=>{
 const report=analyzeMonitoringHealth({lastChaosSuccess:'2026-11-23T07:56:00Z',recentBatches:[{attempted:'2026-11-23T07:55:00Z',requested:8,success:0,errors:[{id:'8',reason:'Timeout'}]}]},now);
 assert.equal(report.rotating.state,'failed');
 assert.equal(report.rotating.requested,8);
 assert.equal(report.rotating.failed,8);
});
