import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveEvents,recordTrackingAlerts,alertsResponse} from './alerts.js';

const time='2026-11-23T10:00:00.000Z';
const base={season:4,seasonStatus:'active',seasonEndAt:null,nextSeasonStartAt:null,trackingState:'healthy'};
test('confirmed changes produce notices without fabricating a start date',()=>{
 const updated={...base,season:5,seasonStatus:'closed',nextSeasonStartAt:'2026-12-01T00:00:00.000Z'};
 const events=deriveEvents(base,updated,time);
 assert.deepEqual(events.map(e=>e.kind),['season-closed','season-number','next-season-date']);
 assert.ok(events.every(e=>e.at===time));
 assert.equal(deriveEvents(updated,updated,time).length,0);
});
test('failures, pauses and recovery create only transition notices',()=>{
 const error={...base,trackingState:'error',error:'Upstream timed out'};
 assert.deepEqual(deriveEvents(base,error,time).map(e=>e.kind),['tracking-error']);
 assert.equal(deriveEvents(error,error,time).length,0);
 const paused={...base,trackingState:'paused',warning:'Verifying season'};
 assert.deepEqual(deriveEvents(base,paused,time).map(e=>e.kind),['tracking-paused']);
 assert.deepEqual(deriveEvents(paused,base,time).map(e=>e.kind),['tracking-recovered']);
});
test('events persist and the public alerts endpoint is read only',async()=>{
 const map=new Map();
 const env={GAINS:{
  async get(key){return map.has(key)?JSON.parse(map.get(key)):null;},
  async put(key,value){map.set(key,value);}
 }};
 await recordTrackingAlerts(env,{now:time,official:{season:4,seasonStatus:'active'}});
 await recordTrackingAlerts(env,{now:'2026-11-23T10:05:00.000Z',official:{season:4,seasonStatus:'closed'}});
 const entries=JSON.parse(map.get('tracking-alerts:v1'));
 assert.equal(entries.length,1);
 assert.equal(entries[0].kind,'season-closed');
 await recordTrackingAlerts(env,{now:'2026-11-23T10:10:00.000Z',official:{season:4,seasonStatus:'closed'}});
 assert.equal(JSON.parse(map.get('tracking-alerts:v1')).length,1);
 const response=await alertsResponse(env);
 assert.equal(response.status,200);
 const parsed=await response.json();
 assert.equal(parsed.official.seasonStatus,'closed');
 assert.equal(parsed.events.length>=1,true);
});

test('identical routine observations do not consume another KV write',async()=>{
 const values=new Map();
 let writes=0;
 const env={GAINS:{
  async get(k){return values.has(k)?JSON.parse(values.get(k)):null;},
  async put(k,v){writes++;values.set(k,v);}
 }};
 const official={season:5,seasonStatus:'active',seasonEndAt:null,nextSeasonStartAt:null};
 await recordTrackingAlerts(env,{now:'2026-11-23T08:00:00Z',official});
 assert.equal(writes,1);
 await recordTrackingAlerts(env,{now:'2026-11-23T08:05:00Z',official});
 assert.equal(writes,1);
});
