import test from 'node:test';
import assert from 'node:assert/strict';
import {decideTransition,storageKey,seasonNamespace,detectMassRepReset,sgtDate,archiveSeason,readSeasonState,SEASON_STATE_KEY} from './season.js';

test('closed unnumbered season does not create a new season or reset',()=>{
 const prior={season:4,lastMemberValues:{Alice:50000}};
 const d=decideTransition(prior,null);
 assert.deepEqual(d,{season:4,pending:false,changed:false,confirmed:false});
 assert.equal(storageKey('member-history','2026-11-23','3',4),'member-history:season-4:2026-11-23:3');
 assert.equal(storageKey('member-history','2026-11-23','3',null),'member-history:2026-11-23:3');
 assert.equal(sgtDate(new Date('2026-11-22T16:01:00.000Z')),'2026-11-23');
});
test('new season requires two matching observations before switch',()=>{
 const existing={season:4};
 const first=decideTransition(existing,5);
 assert.equal(first.pending,true);
 assert.equal(first.season,4);
 const second=decideTransition({...existing,pendingSeason:5,pendingCount:1},5);
 assert.equal(second.changed,true);
 assert.equal(second.season,5);
 const falseAlarm=decideTransition({...existing,pendingSeason:5,pendingCount:1},4);
 assert.equal(falseAlarm.changed,false);
 assert.equal(falseAlarm.season,4);
});
test('first known season isolates legacy snapshots immediately',()=>{
 const first=decideTransition(null,5);
 assert.equal(first.season,5);
 assert.equal(first.changed,true);
 assert.equal(seasonNamespace(null),'legacy');
});
test('widespread REP drop pauses data capture, small changes do not',()=>{
 const before=Object.fromEntries(Array.from({length:20},(_,i)=>['P'+i,30000]));
 const many=Object.fromEntries(Array.from({length:20},(_,i)=>['P'+i,i<14?100:30500]));
 const few=Object.fromEntries(Array.from({length:20},(_,i)=>['P'+i,i<3?100:30500]));
 assert.equal(detectMassRepReset(before,many),true);
 assert.equal(detectMassRepReset(before,few),false);
});
test('archive is durable, not overwritten, and indexed',async()=>{
 const items=new Map();
 const env={GAINS:{
  async get(k){return items.has(k)?JSON.parse(items.get(k)):null;},
  async put(k,v){items.set(k,v);}
 }};
 const old={season:4,lastRecordedAt:'2026-11-22T12:00:00Z',lastMemberValues:{Alice:10000},lastClanRep:100000,lastRank:2};
 const first=await archiveSeason(env,old,'2026-11-23T12:00:00Z');
 assert.equal(first.season,4);
 assert.equal(first.lastObservedMemberRep.Alice,10000);
 assert.equal(first.lastObservedRank,2);
 assert.equal(first.scope.includes('not verified'),true);
 const second=await archiveSeason(env,{...old,lastMemberValues:{Alice:10}},'2026-11-24T12:00:00Z');
 assert.deepEqual(second,first);
 assert.deepEqual(await env.GAINS.get('season-archive-index:v1'),['season-4']);
 assert.equal(await readSeasonState(env),null);
});
