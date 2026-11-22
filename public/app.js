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
async function loadMembers(){
 if(!$('memberDialog').open)return;
 const id=$('memberClanId').value.trim();
 if(!/^\\d{1,7}$/.test(id)){ $('memberStatus').textContent='Choose a clan from the leaderboard or enter a numeric clan ID'; return; }
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
  $('memberRows').innerHTML=body.members.map((m,index)=>'<tr><td>'+(index+1)+'</td><td>'+escapeHtml(m.name)+'</td><td>'+m.level+'</td><td>'+fmt(m.rep)+'</td><td class="'+(m.gain>0?'positive':'')+'">'+(m.gain===null?'—':'+'+fmt(m.gain))+'</td></tr>').join('');
  $('memberFoot').textContent='*Tracked since '+new Date(body.baselineAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT. New members show — until a baseline exists. Auto-updating while visible.';
 }catch(e){if(e.name!=='AbortError'&&!controller.signal.aborted)$('memberStatus').textContent='Member source error: '+e.message;}
 finally{if(memberController===controller)memberController=null;}
}
function selectClan(id,name){
 $('memberClanId').value=id;
 selectedClanName=name;
 $('membersTitle').textContent=name+' · Members';
 $('memberRows').innerHTML='<tr><td colspan="5">Loading '+escapeHtml(name)+' members…</td></tr>';
 if(!$('memberDialog').open)$('memberDialog').showModal();
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
 $('membersTitle').textContent=selectedClanName+' · Members';
 loadMembers();
});
setInterval(()=>{if(!document.hidden&&$('memberDialog').open&&!memberController)loadMembers();},5000);
