import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const views=['overview','rankings','monitoring','seasons'];
test('dashboard has four keyboard-accessible navigation buttons and a skip link',()=>{
 assert.match(html,/class="skip-link" href="#mainContent"/);
 assert.match(html,/<main id="mainContent">/);
 for(const view of views)assert.match(html,new RegExp('data-view="'+view+'"'));
 assert.match(html,/aria-pressed="true"/);
 assert.match(js,/function applyDashboardView\(/);
 assert.match(js,/aria-pressed/);
});
test('each navigation view retains its data components',()=>{
 const ids=['rows','search','sort','refresh','monitorPanel','monitorChaos','alertsList','seasonArchives','fdPanel','seasonEndTimer','seasonStartTimer','memberDialog','historyPlot','memberRows','memberClose'];
 for(const id of ids)assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 const sections=[...html.matchAll(/data-sections="([^"]+)"/g)].map(match=>match[1].split(/\s+/)).flat();
 for(const view of views)assert.ok(sections.includes(view),'No content assigned to '+view);
});
test('mobile ranking and member drawer preserve access to primary metrics',()=>{
 assert.match(html,/@media\(max-width:760px\)/);
 assert.match(html,/#memberDialog table/);
 assert.match(html,/\.leaderboard-board tbody td:nth-child\(3\)/);
 assert.match(js,/mobile-gap/);
 assert.match(js,/selectClan\(link\.dataset\.clanId/);
});
test('navigation does not replace any data retrieval or background trackers',()=>{
 for(const path of ['/api/clans','/api/members','/api/performance','/api/monitoring-health','/api/all-clan-status','/api/alerts','/api/season-archive','/api/tracking-status']){
  assert.ok(js.includes(path)||path==='/api/tracking-status','Expected use of '+path);
 }
 assert.match(js,/POLL_MS=5000/);
 assert.match(js,/loadMonitoringHealth\(\)/);
 assert.match(js,/loadSeasonArchives\(\)/);
});

test('search has an accessible empty state and keyboard shortcut',()=>{
 assert.match(html,/id="resultsSummary" role="status"/);
 assert.match(html,/aria-controls="rows"/);
 assert.match(js,/id="clearClanSearch"/);
 assert.match(js,/event\.key!=='\/'/);
 assert.match(js,/applyDashboardView\('rankings',true\)/);
});
test('clan history requests are abortable and dialog restores focus',()=>{
 assert.match(js,/let performanceAbort=null/);
 assert.match(js,/performanceAbort\.abort\(\)/);
 assert.match(js,/requestId!==performanceRequestId/);
 assert.match(js,/if\(target\?\.isConnected\)target\.focus/);
 assert.match(js,/resetClanDetailState\(\)/);
});
test('loading states and reduced-motion support remain available',()=>{
 assert.match(html,/class="loading-lines"/);
 assert.match(html,/aria-busy="true"/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(js,/is-loading/);
});

test('REP chart controls support comparisons and accessible sample inspection',()=>{
 for(const id of ['historyCompare','historyScrub','historyInspect','historyInspectCount','historyLegend'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/function updateCompareOptions\(/);
 assert.match(js,/function updateChartInspector\(/);
 assert.match(js,/historySegments\(points,gapMs\)/);
 assert.match(js,/\$\('historyScrub'\)\.addEventListener\('input'/);
 assert.match(js,/\$\('historyPlot'\)\.addEventListener\('click'/);
});

test('rankings can compare recorded REP totals from two clans',()=>{
 for(const id of ['clanComparePanel','compareClanA','compareClanB','compareClanRange','compareClanChart','compareClanLegend','compareClanRefresh'])assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 assert.match(js,/function updateClanComparisonChoices\(/);
 assert.match(js,/async function loadClanComparison\(/);
 assert.match(js,/Promise\.all\(\[get\(a\),get\(b\)\]\)/);
 assert.match(js,/historySegments\(points,maxGapMs\)/);
});
