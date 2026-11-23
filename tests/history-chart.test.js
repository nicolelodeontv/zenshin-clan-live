import test from 'node:test';
import assert from 'node:assert/strict';
import {historyPoints,historySegments,comparisonAt} from '../public/history-chart.js';
const series=[
 {at:'2026-11-23T00:00:00Z',total:300,values:{Alice:100,Bob:200}},
 {at:'2026-11-23T00:05:00Z',total:330,values:{Alice:120,Bob:210}},
 {at:'2026-11-23T00:55:00Z',total:365,values:{Alice:130,Bob:235}}
];
test('points are filtered by real saved member observations',()=>{
 const p=historyPoints(series,'Alice',3);
 assert.deepEqual(p.map(x=>x.v),[100,120,130]);
 assert.deepEqual(historyPoints(series,'Bob',3).map(x=>x.v),[200,210,235]);
 assert.deepEqual(historyPoints(series,'',3).map(x=>x.v),[300,330,365]);
 assert.deepEqual(historyPoints(series,'Unknown',3),[]);
});
test('sparse observations do not connect across missing intervals',()=>{
 const points=historyPoints(series,'Alice',3);
 assert.deepEqual(historySegments(points,15*60000).map(x=>x.length),[2,1]);
});
test('comparison only calculates REP differences for near-aligned samples',()=>{
 const a=historyPoints(series,'Alice',3),b=historyPoints(series,'Bob',3);
 const exact=comparisonAt(a,b,Date.parse('2026-11-23T00:05:00Z'));
 assert.equal(exact.delta,-90);
 const off=comparisonAt(a.slice(0,1),b.slice(2),Date.parse('2026-11-23T00:55:00Z'));
 assert.equal(off.delta,null);
});
test('single and missing snapshots do not invent history',()=>{
 assert.deepEqual(historyPoints([], 'Alice', 1),[]);
 assert.deepEqual(historySegments([]),[]);
 assert.equal(comparisonAt([],[],Date.now()).delta,null);
});
