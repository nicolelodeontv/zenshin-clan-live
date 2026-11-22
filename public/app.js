import {enrichRankings,formatGap} from './ranking-math.js';
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString('en-US');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const POLL_MS=5000;
let clans=[], previous=new Map(), busy=false, lastSuccess=0, refreshTimer=null;
let failures=0;
const status=$('status'), error=$('error'), updated=$('updated');
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
  return '<tr class="'+(chaos?'chaos':'')+'"><td>#'+c.rank+change+'</td><td>'+link+(chaos?' ★':'')+'</td><td>'+escapeHtml(c.master)+'</td><td>'+(c.members??'—')+' / '+(c.capacity??'—')+'</td><td>'+fmt(c.reputation)+delta+'</td><td class="gap">'+formatGap(c.gapToAbove)+'</td><td class="gap">'+formatGap(c.gapToLeader)+'</td></tr>';
 }).join('')||'<tr><td colspan="7">No matching clans</td></tr>';
}
function schedule(ms=POLL_MS){clearTimeout(refreshTimer);if(!document.hidden) refreshTimer=setTimeout(sync,ms);}
async function sync(){
 if(busy)return;
 busy=true;
 $('refresh').disabled=true;
 status.textContent='● Refreshing…';
 const abort=new AbortController();
 const timeout=setTimeout(()=>abort.abort(),14000);
 try{
  const response=await fetch('/api/clans?t='+Date.now(),{cache:'no-store',signal:abort.signal});
  const body=await response.json();
  if(!response.ok||!Array.isArray(body.clans))throw Error(body.detail||body.error||'Invalid ranking data');
  if(!body.clans.length)throw Error('Ranking list is empty');
  previous=new Map(clans.map(c=>[c.id||c.name,c]));
  clans=enrichRankings(body.clans);
  const leader=clans[0],chaos=clans.find(c=>c.name.toLowerCase()==='chaos');
  $('season').textContent=body.season?'Season '+body.season:'Unknown';
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
  schedule(failures?Math.min(30000,POLL_MS*Math.pow(2,Math.min(failures,3))):POLL_MS);
 }
}
$('search').addEventListener('input',render);
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
let fdObservedRate=null;
let trackingStatusFetchedAt=0;
async function updateTrackingStatus(id){
 const el=$('backgroundTracking');
 if(id!=='3'){el.textContent='Background snapshots: CHAOS only. This clan tracks gains from its first daily visit.';return;}
 if(Date.now()-trackingStatusFetchedAt<20000)return;
 trackingStatusFetchedAt=Date.now();
 try{
  const response=await fetch('/api/tracking-status',{cache:'no-store'});
  if(!response.ok)throw Error('Tracking status unavailable');
  const data=await response.json();
  el.textContent=data.lastError
    ?'24/7 tracking error: '+data.lastError
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
  const response=await fetch('/api/members?id='+encodeURIComponent(id)+'&t='+Date.now(),{cache:'no-store',signal:controller.signal});
  const body=await response.json();
  if(controller.signal.aborted)return;
  if(!response.ok||!Array.isArray(body.members))throw Error(body.detail||body.error||'Member data unavailable');
  const clanName=body.clanName||selectedClanName||'Clan #'+id;
  $('membersTitle').textContent=clanName+' · Members';
  $('memberStatus').textContent=clanName+' · '+body.members.length+' members · '+body.date+' (SGT)';
  memberRecords=body.members;
  drawMemberRows();
  if(id==='3'&&performanceLoadedFor!=='3')loadPerformance();
  $('memberFoot').textContent='*Tracked since '+new Date(body.baselineAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT. New members show — until a baseline exists. Auto-updating while visible.';
 }catch(e){if(e.name!=='AbortError'&&!controller.signal.aborted)$('memberStatus').textContent='Member source error: '+e.message;}
 finally{if(memberController===controller)memberController=null;}
}
function selectClan(id,name){
 $('memberClanId').value=id;
 selectedClanName=name;
 trackingStatusFetchedAt=0;
 updateTrackingStatus(id);
 $('membersTitle').textContent=name+' · Members';
 memberRecords=[];
 performanceData=null;
 performanceLoadedFor=null;
 $('memberRows').innerHTML='<tr><td colspan="8">Loading '+escapeHtml(name)+' members…</td></tr>';
 if(!$('memberDialog').open)$('memberDialog').showModal();
 if(id==='3')loadPerformance();else clearPerformance();
 loadMembers();
}
$('rows').addEventListener('click',event=>{
 const link=event.target.closest('.clan-member-link');
 if(!link)return;
 event.preventDefault();
 selectClan(link.dataset.clanId,link.dataset.clanName);
});
$('memberClose').addEventListener('click',()=>$('memberDialog').close());
$('memberDialog').addEventListener('click',event=>{if(event.target===$('memberDialog'))$('memberDialog').close();});
$('memberDialog').addEventListener('close',()=>{if(memberController)memberController.abort();memberController=null;});
$('memberLoad').addEventListener('click',()=>{
 const id=$('memberClanId').value.trim();
 selectedClanName=clans.find(c=>String(c.id)===id)?.name||'Clan #'+id;
 trackingStatusFetchedAt=0;
 updateTrackingStatus(id);
 $('membersTitle').textContent=selectedClanName+' · Members';
 memberRecords=[];
 performanceData=null;
 performanceLoadedFor=null;
 if(id==='3')loadPerformance();else clearPerformance();
 loadMembers();
});
setInterval(()=>{if(!document.hidden&&$('memberDialog').open&&!memberController){loadMembers();updateTrackingStatus($('memberClanId').value.trim());}},5000);
setInterval(()=>{if(!document.hidden&&$('memberDialog').open&&$('memberClanId').value.trim()==='3')loadPerformance();},30000);


function drawMemberRows(){
 const hasMetrics=$('memberClanId').value.trim()==='3';
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
 $('historyPlot').textContent='Historical performance is currently tracked for CHAOS only.';
 $('historyCoverage').textContent='History coverage: —';
 $('historyWindow').textContent='1h: — · 3h: — · 6h: — · 24h: —';
}
async function loadPerformance(){
 if(performanceBusy||!$('memberDialog').open||$('memberClanId').value.trim()!=='3')return;
 performanceBusy=true;
 const requestedId=$('memberClanId').value.trim();
 try{
  const response=await fetch('/api/performance?id=3&t='+Date.now(),{cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(data.detail||data.error||'Performance unavailable');
  if(!$('memberDialog').open||$('memberClanId').value.trim()!==requestedId)return;
  performanceData=data;
  fdObservedRate=data.totalRatePerHour;
  performanceLoadedFor='3';
  const selected=$('historyPlayer').value;
  $('historyPlayer').innerHTML='<option value="">All members</option>'+data.members.map(m=>'<option value="'+escapeHtml(m.name)+'">'+escapeHtml(m.name)+'</option>').join('');
  if([...$('historyPlayer').options].some(o=>o.value===selected))$('historyPlayer').value=selected;
  drawMemberRows();
  drawHistory();
  updateFdPanel();
 }catch(e){
  if($('memberDialog').open&&$('memberClanId').value.trim()==='3')$('historyPlot').textContent='History unavailable: '+e.message;
 }finally{performanceBusy=false;}
}
function drawHistory(){
 if(!performanceData)return;
 const data=performanceData,player=$('historyPlayer').value,range=Number($('historyRange').value)||3;
 const metric=player?data.members.find(m=>m.name===player):null;
 const latest=Date.parse(data.lastSnapshot||data.updatedAt);
 const earliest=latest-range*3600000;
 const raw=(data.series||[]).filter(p=>Date.parse(p.at)>=earliest&&Date.parse(p.at)<=latest).map(p=>({t:Date.parse(p.at),v:player?p.values?.[player]:p.total})).filter(p=>Number.isFinite(p.v));
 $('historyCoverage').textContent='Recorded snapshots: '+(data.snapshots||0)+' · coverage '+(data.coverageMinutes||0)+' min · latest '+(data.lastSnapshot?new Date(data.lastSnapshot).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+' SGT':'—');
 const w=metric?.windows;
 $('historyWindow').textContent=w?'1h: '+(w['1h']===null?'—':'+'+fmt(w['1h']))+' · 3h: '+(w['3h']===null?'—':'+'+fmt(w['3h']))+' · 6h: '+(w['6h']===null?'—':'+'+fmt(w['6h']))+' · 24h: '+(w['24h']===null?'—':'+'+fmt(w['24h'])):'Select a player for observed 1h / 3h / 6h / 24h gains';
 const plot=$('historyPlot');
 if(raw.length<2){plot.textContent='At least two saved samples are needed for this chart. Current sample count: '+raw.length+'.';return;}
 const min=Math.min(...raw.map(p=>p.v)),max=Math.max(...raw.map(p=>p.v));
 const span=Math.max(1,max-min),x0=45,x1=745,y0=20,y1=166;
 const x=t=>x0+(t-earliest)/(latest-earliest||1)*(x1-x0);
 const y=v=>y1-(v-min)/span*(y1-y0);
 const series=[];let group=[];
 for(const point of raw){
  if(group.length&&point.t-group.at(-1).t>15*60000){if(group.length>1)series.push(group);group=[];}
  group.push(point);
 }
 if(group.length>1)series.push(group);
 const paths=series.map(points=>'<polyline points="'+points.map(p=>x(p.t).toFixed(1)+','+y(p.v).toFixed(1)).join(' ')+'" fill="none" stroke="#67e6c2" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>').join('');
 const dots=raw.map(p=>'<circle cx="'+x(p.t).toFixed(1)+'" cy="'+y(p.v).toFixed(1)+'" r="3" fill="#67e6c2"><title>'+new Date(p.t).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT: '+fmt(p.v)+' REP</title></circle>').join('');
 plot.innerHTML='<svg viewBox="0 0 780 195" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="'+(player?escapeHtml(player):'CHAOS total')+' REP from recorded snapshots"><line x1="45" y1="166" x2="745" y2="166" stroke="#54708b"/><line x1="45" y1="20" x2="45" y2="166" stroke="#54708b"/><text x="6" y="27" fill="#b5c5d7" font-size="12">'+fmt(max)+'</text><text x="6" y="161" fill="#b5c5d7" font-size="12">'+fmt(min)+'</text>'+paths+dots+'<text x="45" y="186" fill="#b5c5d7" font-size="12">'+new Date(earliest).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+'</text><text x="706" y="186" fill="#b5c5d7" font-size="12">'+new Date(latest).toLocaleTimeString('en-SG',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:false})+'</text></svg>';
}
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
$('historyPlayer').addEventListener('change',drawHistory);
$('historyRange').addEventListener('change',drawHistory);

let fdPaceBusy=false;
async function refreshFdPace(){
 if(document.hidden||fdPaceBusy)return;
 fdPaceBusy=true;
 try{
  const response=await fetch('/api/performance?id=3',{cache:'no-store'});
  if(!response.ok)return;
  const data=await response.json();
  fdObservedRate=data.totalRatePerHour;
  updateFdPanel();
 }catch(error){console.warn('Final Day pace refresh failed',error);}
 finally{fdPaceBusy=false;}
}
refreshFdPace();
setInterval(refreshFdPace,30000);
