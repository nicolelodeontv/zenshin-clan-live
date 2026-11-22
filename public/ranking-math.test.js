import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichRankings,formatGap} from './ranking-math.js';
test('gaps compare to adjacent rank and leader',()=>{
 const rows=enrichRankings([{rank:3,name:'C',reputation:700},{rank:1,name:'A',reputation:1000},{rank:2,name:'B',reputation:850}]);
 assert.deepEqual(rows.map(r=>[r.name,r.gapToAbove,r.gapToLeader]),[['A',0,0],['B',150,150],['C',150,300]]);
});
test('gaps do not become negative or mutate input',()=>{
 const arr=[{rank:1,name:'A',reputation:100},{rank:2,name:'B',reputation:110}];
 const got=enrichRankings(arr);assert.equal(got[1].gapToAbove,0);assert.equal(got[1].gapToLeader,0);assert.equal(arr[0].gapToLeader,undefined);
});
test('gap formatting',()=>{assert.equal(formatGap(15000),'15,000');assert.equal(formatGap(0),'—');assert.equal(formatGap(null),'—');});
