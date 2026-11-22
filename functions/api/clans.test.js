import test from 'node:test';import assert from 'node:assert/strict';import {parse,onRequestGet} from './clans.js';
const sample='<h1>Season 4</h1><table><thead><tr><th>Rank</th><th>Clan</th><th>Master</th><th>Members</th><th>Reputation</th></tr></thead><tbody><tr><td>1</td><td><a href="/clan-ranking/members/3">Chaos</a></td><td>Michol</td><td>29/30</td><td>350,181</td></tr><tr><td>2</td><td>Other</td><td>Master</td><td>12/30</td><td>23,400</td></tr></tbody></table>';
test('parse live ranking HTML',()=>{const r=parse(sample);assert.equal(r.season,4);assert.equal(r.clans.length,2);assert.equal(r.clans[0].id,'3');assert.equal(r.clans[0].reputation,350181);assert.equal(r.clans[0].members,29);});
test('reject invalid ranking HTML',()=>assert.throws(()=>parse('<html></html>'),/Ranking table not found/));
test('structured upstream errors',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:503});try{const r=await onRequestGet();assert.equal(r.status,502);assert.equal((await r.json()).error,'Ranking source unavailable');}finally{globalThis.fetch=old;}});

test('season-end timestamp comes only from official countdown metadata',()=>{
 const html=sample.replace('<h1>Season 4</h1>','<div class="clr-season">Season 4</div><div class="clr-cd" data-end="2026-11-23T00:00:00+08:00"></div>');
 const r=parse(html);
 assert.equal(r.season,4);
 assert.equal(r.seasonStatus,'active');
 assert.equal(r.seasonEndAt,'2026-11-22T16:00:00.000Z');
 assert.equal(r.nextSeasonStartAt,null);
});
test('closed season does not invent the next season start time',()=>{
 const html=sample.replace('<h1>Season 4</h1>','<div class="clr-season">Season closed — winners being calculated</div>');
 const r=parse(html);
 assert.equal(r.seasonStatus,'closed');
 assert.equal(r.seasonEndAt,null);
 assert.equal(r.nextSeasonStartAt,null);
});
