import {enrichRankings,formatGap} from './ranking-math.js';
import {historyPoints,historySegments,comparisonAt} from './history-chart.js';
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString('en-US');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const POLL_MS=5000;
let clans=[], previous=new Map(), busy=false, lastSuccess=0, refreshTimer=null;
let failures=0;
const status=$('status'), error=$('error'), updated=$('updated');

let officialSeason={season:null,seasonStatus:'unknown',seasonEndAt:null,nextSeasonStartAt:null};
let lastRankingSeason=null;
let trackedSeason=null;
const sgtTime=iso=>new Date(iso).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT';
const timeLeft=iso=>{
 const remaining=Date.parse(iso)-Date.now();
 if(!Number.isFinite(remaining))return null;
 if(remaining<=0)return '00d 00h 00m 00s';
 let seconds=Math.floor(remaining/1000);
 const d=Math.floor(seconds/86400);seconds%=86400;
 const h=Math.floor(seconds/3600);seconds%=3600;
 const m=Math.floor(seconds/60);const sec=seconds%60;
 return [String(d).padStart(2,'0')+'d',String(h).padStart(2,'0')+'h',String(m).padStart(2,'0')+'m',String(sec).padStart(2,'0')+'s'].join(' ');
};
function updateSeasonCountdowns(){
 const state=officialSeason.seasonStatus;
 const end=officialSeason.seasonEndAt;
 const next=officialSeason.nextSeasonStartAt;
 $('seasonTimerState').textContent=state==='closed'?'Official season closed':state==='active'?'Season running':'Schedule not published';
 if(state==='closed'){
  $('seasonEndTimer').textContent='Season closed';
  $('seasonEndDate').textContent='Winners being calculated · official source';
 }else if(end){
  const left=timeLeft(end);
  $('seasonEndTimer').textContent=left==='00d 00h 00m 00s'?'End time reached · awaiting official confirmation':left||'Unavailable';
  $('seasonEndDate').textContent='Scheduled end: '+sgtTime(end);
 }else{
  $('seasonEndTimer').textContent='Not announced';
  $('seasonEndDate').textContent='No confirmed end date in the official rankings';
 }
 if(next){
  const left=timeLeft(next);
  $('seasonStartTimer').textContent=left==='00d 00h 00m 00s'?'Start time reached · awaiting official confirmation':left||'Unavailable';
  $('seasonStartDate').textContent='Official start: '+sgtTime(next);
 }else{
  $('seasonStartTimer').textContent='Awaiting announcement';
  $('seasonStartDate').textContent='The game has not published a verified next-season start date';
 }
}
setInterval(updateSeasonCountdowns,1000);

function render(){
 const q=$('search').value.toLowerCase().trim();
 const sort=$('sort').value;
 const filtered=clans.filter(c=>(c.name+' '+c.master).toLowerCase().includes(q));
 filtered.sort((a,b)=>sort==='rep'?b.reputation-a.reputation:sort==='members'?(b.members??0)-(a.members??0):a.rank-b.rank);
 $('rows').innerHTML=filtered.map(c=>{
  const old=previous.get(c.id||c.name);
  const gain=old ? c.reputation-old.reputation : null;
  const movement=old ? old.rank-c.rank : 0;
  const chaos=c.name.toLowerCase()==='chaos';
  const link=c.id?'<a href="#" class="clan-member-link" data-clan-id="'+c.id+'" data-clan-name="'+escapeHtml(c.name)+'" aria-label="View '+escapeHtml(c.name)+' members">'+escapeHtml(c.name)+'</a>':'<span title="Clan ID unavailable">'+escapeHtml(c.name)+'</span>';
  const delta=gain===null?'':gain>0?'<small class="positive"> +'+fmt(gain)+'</small>':gain<0?'<small class="negative"> '+fmt(gain)+'</small>':'';
  const change=movement?'<small class="'+(movement>0?'positive':'negative')+'"> '+(movement>0?'▲':'▼')+Math.abs(movement)+'</small>':'';
  return '<tr class="'+(chaos?'chaos':'')+'"><td>#'+c.rank+change+'</td><td>'+link+(chaos?' ★':'')+'</td><td>'+escapeHtml(c.master)+'</td><td>'+(c.members??'—')+' / '+(c.capacity??'—')+'</td><td>'+fmt(c.reputation)+delta+'<small class="mobile-gap">'+(c.gapToLeader===0?'Leading':'−'+formatGap(c.gapToLeader)+' to #1')+'</small></td><td class="gap">'+formatGap(c.gapToAbove)+'</td><td class="gap">'+formatGap(c.gapToLeader)+'</td></tr>';
 }).join('')||'<tr><td colspan="7" class="empty-results"><strong>No matching clans</strong><p>Try a different name or clear the search to see every ranked clan.</p><button type="button" id="clearClanSearch">Clear search</button></td></tr>';
 $('rows').setAttribute('aria-busy','false');
 const summary=q?'<strong>'+filtered.length+'</strong> of '+clans.length+' clans matching “'+escapeHtml($('search').value.trim())+'”':'<strong>'+filtered.length+'</strong> ranked clans · select a clan to view members';
 if($('resultsSummary').innerHTML!==summary)$('resultsSummary').innerHTML=summary;
}
function schedule(ms=POLL_MS){clearTimeout(refreshTimer);if(!document.hidden) refreshTimer=setTimeout(sync,ms);}
async function sync(){
 if(busy)return;
 busy=true;
 $('refresh').disabled=true;
 status.textContent=clans.length?'● Updating rankings…':'● Connecting to rankings…';
 $('refresh').setAttribute('aria-busy','true');
 const abort=new AbortController();
 const timeout=setTimeout(()=>abort.abort(),14000);
 try{
  const response=await fetch('/api/clans?t='+Date.now(),{cache:'no-store',signal:abort.signal});
  const body=await response.json();
  if(!response.ok||!Array.isArray(body.clans))throw Error(body.detail||body.error||'Invalid ranking data');
  if(!body.clans.length)throw Error('Ranking list is empty');
  const seasonChanged=Number.isInteger(body.season)&&lastRankingSeason!==null&&body.season!==lastRankingSeason;
  previous=seasonChanged?new Map():new Map(clans.map(c=>[c.id||c.name,c]));
  if(seasonChanged){fdObservedRate=null;performanceData=null;performanceLoadedFor=null;}
  if(Number.isInteger(body.season))lastRankingSeason=body.season;
  clans=enrichRankings(body.clans);
  updateClanComparisonChoices();
  const leader=clans[0],chaos=clans.find(c=>c.name.toLowerCase()==='chaos');
  officialSeason={season:body.season||null,seasonStatus:body.seasonStatus||'unknown',seasonEndAt:body.seasonEndAt||null,nextSeasonStartAt:body.nextSeasonStartAt||null};
  updateSeasonCountdowns();
  $('season').textContent=body.season?'Season '+body.season:body.seasonStatus==='closed'?'Closed':'Not published';
  $('count').textContent=clans.length;
  $('top').textContent=fmt(leader.reputation);
  $('topName').textContent=leader.name;
  $('chaos').textContent=chaos?'#'+chaos.rank:'—';
  $('chaosRep').textContent=chaos?fmt(chaos.reputation)+' rep · '+fmt(chaos.gapToLeader)+' behind #1':'Not ranked';
  const received=Date.parse(body.updatedAt);
  lastSuccess=Number.isFinite(received)?received:Date.now();
  $('updated').textContent='Latest source fetch: '+new Date(lastSuccess).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT · Live auto-updates';
  status.textContent='● Live polling';
  status.className='status positive';
  error.style.display='none';
  failures=0;
  render();
  updateFdPanel();
  updateSeasonTransition();
 }catch(e){
  failures++;
  status.textContent='● Connection error';
  status.className='status negative';
  error.style.display='block';
  error.textContent='Live source unavailable: '+(e.name==='AbortError'?'request timed out':e.message)+(clans.length?'. Displaying last successful rankings.':'');
 }finally{
  clearTimeout(timeout);
  busy=false;
  $('refresh').disabled=false;
  $('refresh').removeAttribute('aria-busy');
  if(!clans.length)$('rows').setAttribute('aria-busy','false');
  schedule(failures?Math.min(30000,POLL_MS*Math.pow(2,Math.min(failures,3))):POLL_MS);
 }
}
$('search').addEventListener('input',render);
$('rows').addEventListener('click',event=>{
 if(event.target.closest('#clearClanSearch')){$('search').value='';render();$('search').focus();}
});
document.addEventListener('keydown',event=>{
 if(event.key!=='/'||event.ctrlKey||event.metaKey||event.altKey||$('memberDialog').open)return;
 const tag=document.activeElement?.tagName;
 if(['INPUT','TEXTAREA','SELECT'].includes(tag)||document.activeElement?.isContentEditable)return;
 event.preventDefault();
 applyDashboardView('rankings',true);
 $('search').focus();
});
$('sort').addEventListener('change',render);
$('refresh').addEventListener('click',()=>{clearTimeout(refreshTimer);sync();});
document.addEventListener('visibilitychange',()=>{clearTimeout(refreshTimer);if(!document.hidden)sync();});
window.addEventListener('online',()=>{clearTimeout(refreshTimer);sync();});
setInterval(()=>{if(lastSuccess&&Date.now()-lastSuccess>30000&&!busy){status.textContent='● Data stale';status.className='status negative';}},5000);
sync();

let memberController=null;
let selectedClanName='Chaos';
let memberRecords=[];
let performanceData=null;
let performanceLoadedFor=null;
let performanceBusy=false;
let performanceAbort=null;
let performanceRequestId=0;
let drawerReturnFocus=null;
let fdObservedRate=null;
let trackingStatusFetchedAt=0;
async function updateTrackingStatus(id){
 const el=$('backgroundTracking');
 if(id!=='3'){
  el.textContent='Rotating background tracking · checking saved clan samples…';
  return;
 }
 if(Date.now()-trackingStatusFetchedAt<20000)return;
 trackingStatusFetchedAt=Date.now();
 try{
  const response=await fetch('/api/tracking-status',{cache:'no-store'});
  if(!response.ok)throw Error('Tracking status unavailable');
  const data=await response.json();
  el.textContent=data.lastError
    ?'24/7 tracking error: '+data.lastError
    :data.lastWarning
      ?'Season protection: '+data.lastWarning
    :data.lastScheduledSuccess
      ?'24/7 CHAOS tracking: '+(data.active?'Active':'Last check aging')+' · last successful cron '+new Date(data.lastScheduledSuccess).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT · '+data.snapshotsToday+' snapshots today'
      :'24/7 CHAOS tracking configured · awaiting first verified scheduled execution';
 }catch(e){el.textContent='24/7 tracking status temporarily unavailable';}
}

async function loadMembers(){
 if(!$('memberDialog').open)return;
 const id=$('memberClanId').value.trim();
 if(!/^[0-9]{1,7}$/.test(id)){ $('memberStatus').textContent='Invalid clan ID: please use digits only'; $('memberRows').innerHTML='<tr><td colspan="8">Invalid clan ID</td></tr>'; return; }
 if(memberController)memberController.abort();
 const controller=new AbortController();
 memberController=controller;
 $('memberStatus').textContent='Loading '+selectedClanName+' members…';
 try{
  const seasonArg=officialSeason.season?'&season='+officialSeason.season:'';
  const response=await fetch('/api/members?id='+encodeURIComponent(id)+seasonArg+'&t='+Date.now(),{cache:'no-store',signal:controller.signal});
  const body=await response.json();
  if(controller.signal.aborted)return;
  if(!response.ok||!Array.isArray(body.members))throw Error(body.detail||body.error||'Member data unavailable');
  const clanName=body.clanName||selectedClanName||'Clan #'+id;
  if(id!=='3')$('backgroundTracking').textContent=body.backgroundSampleAt?'Rotating history · last saved '+sgtTime(body.backgroundSampleAt)+' · approx '+(body.backgroundCycleMinutes||55)+' min per full cycle':'Rotating history · no scheduled sample saved for this clan today yet';
  $('membersTitle').textContent=clanName+' · Members';
  $('memberStatus').textContent=clanName+' · '+body.members.length+' members · '+body.date+' (SGT)';
  memberRecords=body.members;
  drawMemberRows();
  if(performanceLoadedFor!==id)loadPerformance();
  $('memberFoot').textContent=body.baselineAt?'*Observed since '+sgtTime(body.baselineAt)+'. Gains before the first snapshot are not available. Auto-updating while visible.':'*Waiting for the first scheduled daily sample for this clan. REP gains are unavailable until then.';
 }catch(e){if(e.name!=='AbortError'&&!controller.signal.aborted)$('memberStatus').textContent='Member source error: '+e.message;}
 finally{if(memberController===controller)memberController=null;}
}
function resetClanDetailState(){
 if(memberController)memberController.abort();
 if(performanceAbort)performanceAbort.abort();
 performanceAbort=null;performanceRequestId++;performanceBusy=false;
 performanceData=null;performanceLoadedFor=null;
 memberRecords=[];
 clearPerformance();
 $('historyPlot').classList.add('is-loading');
 $('historyPlot').textContent='Loading recorded REP history…';
}
function selectClan(id,name){
 $('memberClanId').value=id;
 selectedClanName=name;
 trackingStatusFetchedAt=0;
 updateTrackingStatus(id);
 $('membersTitle').textContent=name+' · Members';
 resetClanDetailState();
 $('memberRows').innerHTML='<tr><td colspan="8">Loading '+escapeHtml(name)+' members…</td></tr>';
 if(!$('memberDialog').open)$('memberDialog').showModal();
 loadPerformance();
 loadMembers();
}
$('rows').addEventListener('click',event=>{
 const link=event.target.closest('.clan-member-link');
 if(!link)return;
 event.preventDefault();
 drawerReturnFocus=link;
 selectClan(link.dataset.clanId,link.dataset.clanName);
});
$('memberClose').addEventListener('click',()=>$('memberDialog').close());
$('memberDialog').addEventListener('click',event=>{if(event.target===$('memberDialog'))$('memberDialog').close();});
$('memberDialog').addEventListener('close',()=>{if(memberController)memberController.abort();memberController=null;if(performanceAbort)performanceAbort.abort();performanceAbort=null;performanceRequestId++;performanceBusy=false;const target=drawerReturnFocus;drawerReturnFocus=null;if(target?.isConnected)target.focus({preventScroll:true});});
$('memberLoad').addEventListener('click',()=>{
 const id=$('memberClanId').value.trim();
 selectedClanName=clans.find(c=>String(c.id)===id)?.name||'Clan #'+id;
 trackingStatusFetchedAt=0;
 updateTrackingStatus(id);
 $('membersTitle').textContent=selectedClanName+' · Members';
 resetClanDetailState();
 $('memberRows').innerHTML='<tr><td colspan="8">Loading '+escapeHtml(selectedClanName)+' members…</td></tr>';
 loadPerformance();
 loadMembers();
});
setInterval(()=>{if(!document.hidden&&$('memberDialog').open&&!memberController){loadMembers();updateTrackingStatus($('memberClanId').value.trim());}},5000);
setInterval(()=>{if(!document.hidden&&$('memberDialog').open)loadPerformance();},30000);


function drawMemberRows(){
 const hasMetrics=true;
 const mapped=new Map((hasMetrics?performanceData?.members||[]:[]).map(m=>[m.name,m]));
 $('memberRows').innerHTML=memberRecords.map((m,index)=>{
  const p=mapped.get(m.name);
  const gain=Number.isFinite(p?.dayGain)?p.dayGain:m.gain;
  const gainCell=gain===null||gain===undefined?'—':'+'+fmt(gain);
  const pace=Number.isFinite(p?.gainPerHour)?fmt(Math.round(p.gainPerHour))+'/hr':'—';
  const pct=Number.isFinite(p?.progress10k)?p.progress10k:null;
  const progress=pct===null?'—':'<div class="rep-progress"><div class="rep-progress-fill" style="width:'+Math.max(0,Math.min(100,pct))+'%"></div><span class="rep-progress-label">'+pct+'%</span></div>';
  const last=p?.lastIncreaseAt?new Date(p.lastIncreaseAt).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+' SGT':'—';
  return '<tr><td>'+(index+1)+'</td><td>'+escapeHtml(m.name)+(p?.resetDetected?' <small title="Reputation decreased during the observed period">↻</small>':'')+'</td><td>'+m.level+'</td><td class="mono-data">'+fmt(m.rep)+'</td><td class="mono-data '+(gain>0?'positive':'')+'">'+gainCell+'</td><td class="mono-data">'+pace+'</td><td>'+progress+'</td><td>'+last+'</td></tr>';
 }).join('')||'<tr><td colspan="8">No matching members</td></tr>';
}
function clearPerformance(){
 $('historyPlayer').innerHTML='<option value="">All members</option>';
 $('historyCompare').innerHTML='<option value="">No comparison</option>';
 $('historyCompare').disabled=true;
 $('historyScrub').disabled=true;
 $('historyInspect').textContent='Select a time to inspect saved REP values.';
 $('historyInspectCount').textContent='—';
 $('historyLegend').textContent='';
 $('historyPlot').textContent='Waiting for scheduled snapshots for this clan.';
 $('historyCoverage').textContent='History coverage: —';
 $('historyWindow').textContent='1h: — · 3h: — · 6h: — · 24h: —';
}
async function loadPerformance(){
 if(performanceBusy||!$('memberDialog').open)return;
 performanceBusy=true;
 const requestedId=$('memberClanId').value.trim();
 const requestId=++performanceRequestId;
 const controller=new AbortController();
 performanceAbort=controller;
 try{
  const seasonArg=officialSeason.season?'&season='+officialSeason.season:'';
  const response=await fetch('/api/performance?id='+encodeURIComponent(requestedId)+seasonArg+'&t='+Date.now(),{cache:'no-store',signal:controller.signal});
  const data=await response.json();
  if(!response.ok)throw Error(data.detail||data.error||'Performance unavailable');
  if(controller.signal.aborted||requestId!==performanceRequestId||!$('memberDialog').open||$('memberClanId').value.trim()!==requestedId)return;
  performanceData=data;
  if(requestedId==='3')fdObservedRate=data.totalRatePerHour;
  performanceLoadedFor=requestedId;
  const selected=$('historyPlayer').value;
  $('historyPlayer').innerHTML='<option value="">All members</option>'+data.members.map(m=>'<option value="'+escapeHtml(m.name)+'">'+escapeHtml(m.name)+'</option>').join('');
  if([...$('historyPlayer').options].some(o=>o.value===selected))$('historyPlayer').value=selected;
  updateCompareOptions();
  drawMemberRows();
  drawHistory();
  updateFdPanel();
 }catch(e){
  if(!controller.signal.aborted&&requestId===performanceRequestId&&$('memberDialog').open&&$('memberClanId').value.trim()===requestedId)$('historyPlot').textContent='History unavailable: '+e.message;
 }finally{
  if(requestId===performanceRequestId){performanceBusy=false;performanceAbort=null;$('historyPlot').classList.remove('is-loading');}
 }
}

let chartInspectorSamples=[];
let chartInspectorPrimary=[];
let chartInspectorSecondary=[];
let chartInspectorNames=['',''];
function updateCompareOptions(){
 const player=$('historyPlayer').value;
 const current=$('historyCompare').value;
 const others=(performanceData?.members||[]).filter(m=>m.name!==player);
 $('historyCompare').innerHTML='<option value="">No comparison</option>'+others.map(m=>'<option value="'+escapeHtml(m.name)+'">'+escapeHtml(m.name)+'</option>').join('');
 $('historyCompare').disabled=!player;
 if(player&&others.some(m=>m.name===current))$('historyCompare').value=current;
}
function updateChartInspector(){
 const scrub=$('historyScrub');
 const t=chartInspectorSamples[Number(scrub.value)];
 if(!Number.isFinite(t)){ $('historyInspect').textContent='No recorded sample available for this range.';return; }
 const {primary,secondary,delta}=comparisonAt(chartInspectorPrimary,chartInspectorSecondary,t);
 const formatSample=p=>p&&Math.abs(p.t-t)<=Math.max(15,Number(performanceData?.cycleMinutes)||15)*60000?fmt(p.v)+' REP':'not sampled nearby';
 const when=new Date(t).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT';
 $('historyInspect').textContent=when+' · '+chartInspectorNames[0]+': '+formatSample(primary)+(chartInspectorNames[1]?' · '+chartInspectorNames[1]+': '+formatSample(secondary)+(delta===null?' · no comparable simultaneous sample':' · difference '+(delta>=0?'+':'')+fmt(delta)+' REP'):'');
 $('historyInspectCount').textContent=(Number(scrub.value)+1)+' / '+chartInspectorSamples.length;
}
function drawHistory(){
 if(!performanceData)return;
 const data=performanceData,player=$('historyPlayer').value,compare=player?$('historyCompare').value:'',range=Number($('historyRange').value)||3;
 const label=player||'All members';
 const secondaryLabel=compare&&compare!==player?compare:'';
 const first=historyPoints(data.series||[],player,range);
 const second=secondaryLabel?historyPoints(data.series||[],secondaryLabel,range):[];
 chartInspectorPrimary=first;
 chartInspectorSecondary=second;
 chartInspectorNames=[label,secondaryLabel];
 chartInspectorSamples=[...new Set([...first,...second].map(p=>p.t))].sort((a,b)=>a-b);
 const scrub=$('historyScrub');
 const priorIndex=Number(scrub.value);
 scrub.max=String(Math.max(0,chartInspectorSamples.length-1));
 scrub.value=String(Math.max(0,Math.min(chartInspectorSamples.length-1,priorIndex||chartInspectorSamples.length-1)));
 scrub.disabled=!chartInspectorSamples.length;
 $('historyLegend').innerHTML='<span class="chart-legend-item"><i class="chart-dot" aria-hidden="true"></i>'+escapeHtml(label)+'</span>'+(secondaryLabel?'<span class="chart-legend-item"><i class="chart-dot compare" aria-hidden="true"></i>'+escapeHtml(secondaryLabel)+'</span>':'');
 const metric=player?data.members.find(m=>m.name===player):null;
 $('historyCoverage').textContent=(data.coverageMode||'Recorded history')+' · '+(data.snapshots||0)+' samples · span '+(data.coverageMinutes||0)+' min · latest '+(data.lastSnapshot?new Date(data.lastSnapshot).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+' SGT':'—');
 const w=metric?.windows;
 $('historyWindow').textContent=w?'1h: '+(w['1h']===null?'—':'+'+fmt(w['1h']))+' · 3h: '+(w['3h']===null?'—':'+'+fmt(w['3h']))+' · 6h: '+(w['6h']===null?'—':'+'+fmt(w['6h']))+' · 24h: '+(w['24h']===null?'—':'+'+fmt(w['24h'])):'Select a player for observed 1h / 3h / 6h / 24h gains';
 const plot=$('historyPlot');
 if(!first.length&&!second.length){
  plot.textContent='No saved REP observations for this time range.';
  updateChartInspector();
  return;
 }
 const all=[...first,...second],min=Math.min(...all.map(p=>p.v)),max=Math.max(...all.map(p=>p.v));
 const minT=Math.min(...all.map(p=>p.t)),maxT=Math.max(...all.map(p=>p.t));
 const span=Math.max(1,max-min),timeSpan=Math.max(1,maxT-minT);
 const x=t=>45+(t-minT)/timeSpan*700;
 const y=v=>166-(v-min)/span*144;
 const gapMs=Math.max(15,Number(data.cycleMinutes)||15)*1.5*60000;
 const line=(points,color)=>historySegments(points,gapMs).map(segment=>{
  if(segment.length===1)return '';
  return '<polyline class="chart-line" points="'+segment.map(p=>x(p.t).toFixed(2)+','+y(p.v).toFixed(2)).join(' ')+'" stroke="'+color+'"/>';
 }).join('');
 const circles=(points,color)=>points.map(p=>'<circle class="chart-dots" cx="'+x(p.t).toFixed(2)+'" cy="'+y(p.v).toFixed(2)+'" r="3.3" fill="'+color+'"><title>'+escapeHtml(new Date(p.t).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT: '+fmt(p.v)+' REP')+'</title></circle>').join('');
 const timeLabel=t=>new Date(t).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false});
 plot.innerHTML='<svg viewBox="0 0 780 195" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+escapeHtml(label+(secondaryLabel?' compared with '+secondaryLabel:''))+' recorded REP chart"><line x1="45" y1="166" x2="745" y2="166" stroke="#526c6c"/><line x1="45" y1="22" x2="45" y2="166" stroke="#526c6c"/><text x="7" y="27" font-size="11" fill="#b4cdcd">'+fmt(max)+'</text><text x="7" y="159" font-size="11" fill="#b4cdcd">'+fmt(min)+'</text>'+line(first,'#71dfbd')+line(second,'#d6b2f2')+circles(first,'#71dfbd')+circles(second,'#d6b2f2')+'<text x="45" y="186" font-size="11" fill="#b4cdcd">'+escapeHtml(timeLabel(minT))+'</text><text x="704" y="186" font-size="11" fill="#b4cdcd">'+escapeHtml(timeLabel(maxT))+'</text></svg>';
 plot.dataset.startTime=String(minT);
 plot.dataset.endTime=String(maxT);
 updateChartInspector();
}
$('historyScrub').addEventListener('input',updateChartInspector);
$('historyCompare').addEventListener('change',drawHistory);
$('historyPlayer').addEventListener('change',()=>{updateCompareOptions();drawHistory();});
$('historyPlot').addEventListener('click',event=>{
 const svg=event.target.closest('svg');
 if(!svg||!chartInspectorSamples.length)return;
 const rect=svg.getBoundingClientRect();
 const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));
 const t=Number($('historyPlot').dataset.startTime)+fraction*(Number($('historyPlot').dataset.endTime)-Number($('historyPlot').dataset.startTime));
 let nearest=0;
 for(let i=1;i<chartInspectorSamples.length;i++)if(Math.abs(chartInspectorSamples[i]-t)<Math.abs(chartInspectorSamples[nearest]-t))nearest=i;
 $('historyScrub').value=String(nearest);
 updateChartInspector();
});

function updateFdPanel(){
 const chaos=clans.find(c=>c.name.toLowerCase()==='chaos');
 if(!chaos)return;
 $('fdAbove').textContent=chaos.rank===1?'Rank #1':fmt(chaos.gapToAbove||0)+' REP';
 $('fdLeader').textContent=chaos.rank===1?'Leading':fmt(chaos.gapToLeader||0)+' REP';
 const rate=fdObservedRate;
 $('fdPace').textContent=Number.isFinite(rate)?fmt(Math.round(rate))+' REP/hr':'Not enough history';
 const hours=Number($('fdHours').value);
 const gap=chaos.rank===1?0:chaos.gapToAbove;
 $('fdRequired').textContent=hours>0&&Number.isFinite(gap)?fmt(Math.ceil(gap/hours))+' REP/hr':'Enter hours';
 if(!hours||hours<=0){$('fdMessage').textContent='Enter the actual hours remaining before Final Day to calculate the minimum catch-up pace. Competitor growth is not included.';return;}
 if(chaos.rank===1){$('fdMessage').textContent='CHAOS currently leads. Keep monitoring the gap to #2; these calculations do not predict future positions.';return;}
 if(!Number.isFinite(rate)){$('fdMessage').textContent='Minimum '+fmt(Math.ceil(gap/hours))+' REP/hr closes the gap to the clan above only if it gains zero REP. Need more saved snapshots for a CHAOS pace comparison.';return;}
 const possible=rate*hours;
 $('fdMessage').textContent='What-if only: at the observed '+fmt(Math.round(rate))+' REP/hr, CHAOS would gain about '+fmt(Math.round(possible))+' REP over '+hours+' hours. '+(possible>=gap?'This could close the current '+fmt(gap)+' REP gap if the clan above stops gaining.':'This would leave about '+fmt(Math.ceil(gap-possible))+' REP of today’s gap if the clan above stops gaining.')+' No opponent rate or final rank is predicted.';
}
$('fdHours').addEventListener('input',updateFdPanel);

$('historyRange').addEventListener('change',drawHistory);

let fdPaceBusy=false;
async function refreshFdPace(){
 if(document.hidden||fdPaceBusy)return;
 fdPaceBusy=true;
 try{
  const seasonArg=officialSeason.season?'&season='+officialSeason.season:'';
  const response=await fetch('/api/performance?id=3'+seasonArg,{cache:'no-store'});
  if(!response.ok)return;
  const data=await response.json();
  fdObservedRate=data.totalRatePerHour;
  updateFdPanel();
 }catch(error){console.warn('Final Day pace refresh failed',error);}
 finally{fdPaceBusy=false;}
}
refreshFdPace();
setInterval(refreshFdPace,30000);


let lastTransitionCheck=0;
async function updateSeasonTransition(){
 const box=$('seasonTransition');
 if(!officialSeason.season){box.hidden=true;return;}
 if(Date.now()-lastTransitionCheck<20000){
  box.hidden=trackedSeason===officialSeason.season;
  return;
 }
 lastTransitionCheck=Date.now();
 try{
  const response=await fetch('/api/tracking-status',{cache:'no-store'});
  if(!response.ok)return;
  const data=await response.json();
  const before=trackedSeason;
  trackedSeason=data.season||null;
  box.hidden=trackedSeason===officialSeason.season;
  box.textContent=data.pendingSeason===officialSeason.season
   ?'New season '+officialSeason.season+' detected. Verifying a second scheduled observation before resetting member REP tracking.'
   :'Official Season '+officialSeason.season+' detected. Scheduled tracking is verifying the season boundary; previous REP data remains protected.';
  if(before!==trackedSeason&&trackedSeason===officialSeason.season){
   fdObservedRate=null;performanceData=null;performanceLoadedFor=null;
   refreshFdPace();
   if($('memberDialog').open&&$('memberClanId').value.trim()==='3'){loadMembers();loadPerformance();}
   loadSeasonArchives();
  }
 }catch(e){box.hidden=false;box.textContent='Checking new season tracking state…';}
}
let lastArchiveRefresh=0;
async function loadSeasonArchives(){
 if(Date.now()-lastArchiveRefresh<20000)return;
 lastArchiveRefresh=Date.now();
 try{
  const response=await fetch('/api/season-archive',{cache:'no-store'});
  if(!response.ok)throw Error('Archive API unavailable');
  const data=await response.json();
  const archives=data.archives||[];
  $('seasonArchiveStatus').textContent=archives.length+' preserved season '+(archives.length===1?'summary':'summaries')+' · last-observed values, not official final results';
  $('seasonArchives').innerHTML=archives.map(item=>{
   const rows=Object.entries(item.lastObservedMemberRep||{}).sort((a,b)=>b[1]-a[1]);
   const members=rows.map(([name,rep])=>'<div>'+escapeHtml(name)+' — '+fmt(rep)+' REP</div>').join('');
   return '<details class="archive-item"><summary>'+escapeHtml(item.seasonLabel)+' · '+(item.recordedAt?sgtTime(item.recordedAt):'Last recorded time unknown')+'</summary><p>Last observed rank: '+(item.lastObservedRank?'#'+item.lastObservedRank:'Not available')+' · Clan REP: '+(Number.isFinite(item.lastObservedClanRep)?fmt(item.lastObservedClanRep):'Not available')+'</p><p>'+escapeHtml(item.scope||'Last observed values only')+'</p><div class="archive-data">'+members+'</div></details>';
  }).join('')||'<p>No previous season has been archived yet. Archives are created when an official numbered season change is confirmed.</p>';
 }catch(e){$('seasonArchiveStatus').textContent='Archive status unavailable: '+e.message;}
}
loadSeasonArchives();
setInterval(loadSeasonArchives,60000);


let alertsBusy=false;
async function loadAlerts(){
 if(document.hidden||alertsBusy)return;
 alertsBusy=true;
 try{
  const response=await fetch('/api/alerts',{cache:'no-store'});
  const data=await response.json();
  if(!response.ok||!Array.isArray(data.events))throw Error(data.detail||data.error||'Notifications unavailable');
  $('alertsHealth').textContent=data.trackingHealthy?'● CHAOS background tracking healthy':'● CHAOS snapshots delayed — check tracking status';
  $('alertsHealth').className='status '+(data.trackingHealthy?'positive':'negative');
  $('alertCount').textContent=data.events.length?'('+data.events.length+')':'';
  const list=data.events.slice(0,12);
  $('alertsList').innerHTML=list.map(entry=>{
   const severity=entry.severity==='warning'?'warning':'info';
   const date=Number.isFinite(Date.parse(entry.at))?sgtTime(entry.at):'Time unknown';
   return '<article class="alert-entry '+severity+'"><strong>'+escapeHtml(entry.title||'Tracking notice')+'</strong><p>'+escapeHtml(entry.detail||'')+'</p><time>'+escapeHtml(date)+'</time></article>';
  }).join('')||'<p class="alert-empty">No new season or tracking events. Notifications will appear here when a change is detected.</p>';
 }catch(e){
  $('alertsHealth').textContent='Alert service unavailable: '+e.message;
  $('alertsHealth').className='status negative';
 }finally{alertsBusy=false;}
}
$('alertsRefresh').addEventListener('click',loadAlerts);
loadAlerts();
setInterval(loadAlerts,30000);


let allCoverageBusy=false;
async function refreshAllCoverage(){
 if(document.hidden||allCoverageBusy)return;
 allCoverageBusy=true;
 try{
  const response=await fetch('/api/all-clan-status',{cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.detail||data.error||'Coverage unavailable');
  const otherCount=clans.filter(c=>c.id&&String(c.id)!=='3').length;
  const total=data.trackedToday||0;
  const suffix=data.lastBatch?.attempted?' · latest batch '+sgtTime(data.lastBatch.attempted)+' · '+(data.lastBatch.success||0)+'/'+(data.lastBatch.requested||0)+' sampled':' · waiting for first scheduled batch';
  $('allClanCoverage').textContent='Background coverage: '+total+'/'+(otherCount||'—')+' other ranked clans sampled today · 8 per 5-minute batch · ~'+(data.lastBatch?.cycleMinutes||55)+' min full rotation'+suffix;
 }catch(e){$('allClanCoverage').textContent='Rotating clan coverage temporarily unavailable';}
 finally{allCoverageBusy=false;}
}
refreshAllCoverage();
setInterval(refreshAllCoverage,30000);


let monitoringBusy=false;
const healthDate=iso=>iso&&Number.isFinite(Date.parse(iso))?sgtTime(iso):'No recorded sample';
const healthState=state=>({'healthy':'Healthy','stale':'Delayed','error':'Failed','paused':'Paused','failed':'Batch failed','no-data':'No data','not-started':'Awaiting first batch'})[state]||'Unknown';
async function loadMonitoringHealth(){
 if(document.hidden||monitoringBusy)return;
 monitoringBusy=true;
 try{
  const response=await fetch('/api/monitoring-health',{cache:'no-store'});
  const data=await response.json();
  if(!response.ok||!data.chaos||!data.rotating)throw Error(data.detail||data.error||'Invalid health response');
  const chaos=data.chaos,rot=data.rotating;
  $('monitorChaos').textContent=healthState(chaos.state);
  $('monitorChaosDetail').textContent=chaos.lastSuccess?'Last success '+healthDate(chaos.lastSuccess):'No successful saved snapshot yet';
  $('monitorRotation').textContent=healthState(rot.state);
  $('monitorRotationDetail').textContent=rot.lastBatch?.attempted?'Latest batch '+healthDate(rot.lastBatch.attempted):'Awaiting first scheduled batch';
  const totalClans=Number.isInteger(rot.totalRankedOtherClans)?rot.totalRankedOtherClans:clans.filter(c=>c.id&&String(c.id)!=='3').length;
  $('monitorCoverage').textContent=fmt(rot.trackedToday)+(totalClans?' / '+fmt(totalClans):'');
  $('monitorCoverageDetail').textContent='Other ranked clans with samples today';
  $('monitorSuccess').textContent=rot.requested>0?Math.round(100*rot.succeeded/rot.requested)+'%':'—';
  $('monitorSuccessDetail').textContent=rot.attempts?rot.succeeded+'/'+rot.requested+' successful fetches in '+rot.attempts+' recorded batches':'Detailed batch history starts after this upgrade';
  $('monitorGaps').textContent=chaos.observedGaps+' observed intervals greater than 10 minutes'+(chaos.observedGaps?' · longest '+chaos.largestObservedGapMinutes+' min':'')+' · '+chaos.snapshots+' saved observations across today and yesterday';
  $('monitorStale').innerHTML=(rot.staleClans||[]).map(c=>'<div class="monitor-entry">'+escapeHtml(c.name)+' (#'+escapeHtml(c.id)+') · last recorded '+c.ageMinutes+' min ago</div>').join('')||'<div>No currently observed clans exceed the expected rotation age. Unsampled clans are not counted as failed.</div>';
  $('monitorFailures').innerHTML=(rot.recentFailures||[]).slice(0,12).map(f=>'<div class="monitor-entry">Clan #'+escapeHtml(f.id)+' · '+escapeHtml(f.reason)+' · '+escapeHtml(healthDate(f.at))+'</div>').join('')||'<div>No failures in the recorded batch history.</div>';
  $('monitorLimitations').textContent=data.limitations||'Missing samples cannot be reconstructed.';
  $('monitorUpdated').textContent='Report generated '+healthDate(data.generatedAt)+' · observations are read-only and may lag behind the game';
 }catch(e){
  $('monitorChaos').textContent='Unavailable';
  $('monitorRotation').textContent='Unavailable';
  $('monitorUpdated').textContent='Tracking health temporarily unavailable: '+e.message;
 }finally{monitoringBusy=false;}
}
$('monitorRefresh').addEventListener('click',loadMonitoringHealth);
loadMonitoringHealth();
setInterval(loadMonitoringHealth,30000);


// Lightweight client-side navigation; data polling continues regardless of the selected section.
const dashboardViews={
 overview:{title:'Clan overview',subtitle:'Live clan rankings, REP progress, and season activity in one place.'},
 rankings:{title:'Clan rankings',subtitle:'Compare clans, search the leaderboard, and open member performance details.'},
 monitoring:{title:'Tracking health',subtitle:'Collection status, season notices, and recorded data freshness.'},
 seasons:{title:'Season history',subtitle:'Official season schedule and archived CHAOS results.'}
};
function applyDashboardView(view,updateUrl=false){
 if(!Object.prototype.hasOwnProperty.call(dashboardViews,view))view='overview';
 const details=dashboardViews[view];
 document.querySelectorAll('[data-sections]').forEach(section=>{
  const enabled=(section.dataset.sections||'').split(/\s+/).includes(view);
  section.classList.toggle('is-hidden',!enabled);
 });
 document.querySelectorAll('.nav-link[data-view]').forEach(link=>{
  const active=link.dataset.view===view;
  link.classList.toggle('is-active',active);
  link.setAttribute('aria-pressed',String(active));
 });
 $('pageTitle').innerHTML=escapeHtml(details.title)+'<span class="title-dot">.</span>';
 $('pageSubtitle').textContent=details.subtitle;
 if(updateUrl&&window.location.hash!=='#'+view)history.replaceState(null,'','#'+view);
 if(updateUrl&&window.matchMedia('(max-width:760px)').matches)window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelector('.main-nav').addEventListener('click',event=>{
 const button=event.target.closest('button[data-view]');
 if(button)applyDashboardView(button.dataset.view,true);
});
window.addEventListener('hashchange',()=>applyDashboardView(window.location.hash.slice(1),false));
applyDashboardView(window.location.hash.slice(1)||'overview');


let comparisonIdsKey='';
let comparisonRequestId=0;
let comparisonAbort=null;
function updateClanComparisonChoices(){
 const choices=clans.filter(c=>/^[0-9]{1,7}$/.test(String(c.id||'')));
 const fingerprint=choices.map(c=>String(c.id)+':'+c.name).join('|');
 if(fingerprint===comparisonIdsKey)return;
 const selectA=$('compareClanA'),selectB=$('compareClanB');
 const priorA=selectA.value,priorB=selectB.value;
 const options='<option value="">Choose a clan</option>'+choices.map(c=>'<option value="'+escapeHtml(c.id)+'">#'+c.rank+' '+escapeHtml(c.name)+'</option>').join('');
 selectA.innerHTML=options;selectB.innerHTML=options;
 const chaos=choices.find(c=>c.name.toLowerCase()==='chaos');
 const leader=choices.find(c=>String(c.id)!==String(chaos?.id));
 selectA.value=choices.some(c=>String(c.id)===priorA)?priorA:String(chaos?.id||choices[0]?.id||'');
 selectB.value=choices.some(c=>String(c.id)===priorB&&priorB!==selectA.value)?priorB:String(leader?.id||'');
 if(selectA.value===selectB.value)selectB.value='';
 comparisonIdsKey=fingerprint;
}
function comparisonSeriesSVG(points,color,x,y,maxGapMs){
 return historySegments(points,maxGapMs).map(group=>group.length<2?'':'<polyline class="chart-line" stroke="'+color+'" points="'+group.map(p=>x(p.t).toFixed(2)+','+y(p.v).toFixed(2)).join(' ')+'"/>').join('')+
 points.map(p=>'<circle class="chart-dots" r="3.2" cx="'+x(p.t).toFixed(2)+'" cy="'+y(p.v).toFixed(2)+'" fill="'+color+'"><title>'+escapeHtml(new Date(p.t).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT · '+fmt(p.v)+' member REP')+'</title></circle>').join('');
}
async function loadClanComparison(){
 const a=$('compareClanA').value,b=$('compareClanB').value;
 const chart=$('compareClanChart'),message=$('compareClanStatus');
 if(!a||!b||a===b){
  if(comparisonAbort)comparisonAbort.abort();
  chart.textContent=a===b?'Choose two different clans.':'Select two clans to compare.';
  message.textContent='Comparison requires two different ranked clans.';
  $('compareClanLegend').textContent='';
  return;
 }
 if(comparisonAbort)comparisonAbort.abort();
 const controller=new AbortController(),requestId=++comparisonRequestId;
 comparisonAbort=controller;
 $('compareClanRefresh').disabled=true;
 message.textContent='Loading recorded REP samples for both clans…';
 chart.textContent='Checking saved history…';
 try{
  const range=Number($('compareClanRange').value)||6;
  const get=async id=>{
   const response=await fetch('/api/performance?id='+encodeURIComponent(id)+(officialSeason.season?'&season='+officialSeason.season:'')+'&t='+Date.now(),{cache:'no-store',signal:controller.signal});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||data.detail||'History unavailable for clan '+id);
   return data;
  };
  const [first,second]=await Promise.all([get(a),get(b)]);
  if(controller.signal.aborted||requestId!==comparisonRequestId)return;
  const clanA=clans.find(c=>String(c.id)===a),clanB=clans.find(c=>String(c.id)===b);
  const labelA=clanA?.name||'Clan #'+a,labelB=clanB?.name||'Clan #'+b;
  const p=historyPoints(first.series||[],'',range),q=historyPoints(second.series||[],'',range);
  $('compareClanLegend').innerHTML='<span class="chart-legend-item"><i class="chart-dot" aria-hidden="true"></i>'+escapeHtml(labelA)+' ('+p.length+' samples)</span><span class="chart-legend-item"><i class="chart-dot compare" aria-hidden="true"></i>'+escapeHtml(labelB)+' ('+q.length+' samples)</span>';
  const latestA=p.at(-1),latestB=q.at(-1);
  const when=point=>point?new Date(point.t).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+' SGT':'not sampled';
  message.textContent=labelA+': '+(latestA?fmt(latestA.v)+' member REP at '+when(latestA):'No saved samples')+' · '+labelB+': '+(latestB?fmt(latestB.v)+' member REP at '+when(latestB):'No saved samples');
  if(!p.length&&!q.length){chart.textContent='No recorded data for either clan in this period.';return;}
  const all=[...p,...q],minT=Math.min(...all.map(x=>x.t)),maxT=Math.max(...all.map(x=>x.t)),min=Math.min(...all.map(x=>x.v)),max=Math.max(...all.map(x=>x.v));
  const x=t=>45+(t-minT)/Math.max(1,maxT-minT)*700,y=v=>165-(v-min)/Math.max(1,max-min)*143;
  const time=t=>new Date(t).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false});
  const svg='<svg viewBox="0 0 780 195" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+escapeHtml(labelA+' and '+labelB+' recorded member REP totals')+'"><line x1="45" y1="165" x2="745" y2="165" stroke="#536a6e"/><line x1="45" y1="22" x2="45" y2="165" stroke="#536a6e"/><text x="7" y="25" fill="#b8cecf" font-size="11">'+fmt(max)+'</text><text x="7" y="158" fill="#b8cecf" font-size="11">'+fmt(min)+'</text>'+comparisonSeriesSVG(p,'#71dfbd',x,y,Math.max(15,Number(first.cycleMinutes)||5)*1.5*60000)+comparisonSeriesSVG(q,'#d6b2f2',x,y,Math.max(15,Number(second.cycleMinutes)||55)*1.5*60000)+'<text x="45" y="187" font-size="11" fill="#a9c0c1">'+escapeHtml(time(minT))+'</text><text x="704" y="187" font-size="11" fill="#a9c0c1">'+escapeHtml(time(maxT))+'</text></svg>';
  chart.innerHTML=svg;
 }catch(error){
  if(!controller.signal.aborted&&requestId===comparisonRequestId){message.textContent='Comparison unavailable: '+error.message;chart.textContent='Could not load saved history.';}
 }finally{
  if(requestId===comparisonRequestId){comparisonAbort=null;$('compareClanRefresh').disabled=false;}
 }
}
$('compareClanRefresh').addEventListener('click',loadClanComparison);
$('compareClanA').addEventListener('change',loadClanComparison);
$('compareClanB').addEventListener('change',loadClanComparison);
$('compareClanRange').addEventListener('change',loadClanComparison);
