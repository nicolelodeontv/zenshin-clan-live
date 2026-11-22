import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSnapshots} from './performance.js';
const at=(hr,min=0)=>new Date(Date.UTC(2026,10,22,hr,min)).toISOString();
test('observed REP pace, target and timed windows are grounded in snapshots',()=>{
 const snapshots=[{at:at(12),values:{Alice:1000,Bob:2000}},{at:at(13),values:{Alice:2000,Bob:2500}},{at:at(14),values:{Alice:3000,Bob:2600}}];
 const baseline={values:{Alice:500,Bob:2000}};
 const data=analyzeSnapshots(snapshots,baseline);
 const a=data.members.find(x=>x.name==='Alice');
 assert.equal(data.snapshots,3);
 assert.equal(a.dayGain,2500);
 assert.equal(a.gainPerHour,1000);
 assert.equal(a.windows['1h'],1000);
 assert.equal(a.windows['3h'],null);
 assert.equal(a.progress10k,25);
 assert.equal(a.lastIncreaseAt,at(14));
 assert.equal(data.totalRatePerHour,800);
});
test('no invented pace, observed increases, or window gains with insufficient history',()=>{
 const data=analyzeSnapshots([{at:at(14),values:{Alice:4000}}],{values:{Alice:4000}});
 assert.equal(data.members[0].gainPerHour,null);
 assert.equal(data.members[0].lastIncreaseAt,null);
 assert.equal(data.members[0].windows['1h'],null);
 assert.equal(data.totalRatePerHour,null);
});
test('reputation reset invalidates pace and gains',()=>{
 const points=[{at:at(12),values:{Alice:8000}},{at:at(13),values:{Alice:200}}];
 const data=analyzeSnapshots(points,{values:{Alice:8000}});
 assert.equal(data.members[0].resetDetected,true);
 assert.equal(data.members[0].gainPerHour,null);
 assert.equal(data.members[0].dayGain,null);
});
