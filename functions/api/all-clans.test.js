import test from 'node:test';
import assert from 'node:assert/strict';
import {rotateClans,appendRotatingSnapshots,allClanKey} from './all-clans.js';
import {analyzeSnapshots} from './performance.js';
const at = new Date('2026-11-23T00:00:00.000Z');
test('rotation covers each non-CHAOS clan exactly once per 55 minutes for 87 ranked clans',()=>{
 const roster=Array.from({length:87},(_,n)=>({id:String(n+1),name:'Clan'+(n+1)}));
 const collected=[];
 for(let i=0;i<11;i++){
  const time=new Date(at.getTime()+i*300000);
  const selection=rotateClans(roster,time);
  assert.ok(selection.selected.length<=8);
  assert.equal(selection.cycleMinutes,55);
  collected.push(...selection.selected.map(c=>c.id));
 }
 assert.equal(collected.length,86);
 assert.equal(new Set(collected).size,86);
 assert.equal(collected.includes('3'),false);
});
test('same scheduled bucket replaces retry instead of double-counting',()=>{
 const args={day:'2026-11-23',season:5,at:'2026-11-23T00:00:00Z',requested:1,errors:[],cycleMinutes:55};
 const initial=appendRotatingSnapshots(null,[{id:'6',name:'Other',values:{Alice:100}}],args);
 const replaced=appendRotatingSnapshots(initial,[{id:'6',name:'Other',values:{Alice:110}}],{...args,at:'2026-11-23T00:02:00Z'});
 assert.equal(replaced.clans['6'].samples.length,1);
 assert.equal(replaced.clans['6'].samples[0].values.Alice,110);
 assert.equal(replaced.lastBatch.success,1);
});
test('season namespaces keep snapshots separated',()=>{
 assert.notEqual(allClanKey('2026-11-23',4),allClanKey('2026-11-23',5));
 assert.equal(allClanKey('2026-11-23',null),'all-clan-history:legacy:2026-11-23');
});
test('sparse rotated samples never infer one-hour rates without coverage',()=>{
 const data=analyzeSnapshots([{at:'2026-11-23T00:00:00Z',values:{Alice:1000}}],{values:{Alice:1000}});
 assert.equal(data.hasHistory,false);
 assert.equal(data.members[0].gainPerHour,null);
 assert.equal(data.members[0].windows['1h'],null);
});
