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
  const url=c.id?'https://ninjazenshin.online/clan-ranking/members/'+encodeURIComponent(c.id):'https://ninjazenshin.online/?panel=clan-ranking';
  const delta=gain===null?'':gain>0?'<small class="positive"> +'+fmt(gain)+'</small>':gain<0?'<small class="negative"> '+fmt(gain)+'</small>':'';
  const change=movement?'<small class="'+(movement>0?'positive':'negative')+'"> '+(movement>0?'▲':'▼')+Math.abs(movement)+'</small>':'';
  return '<tr class="'+(chaos?'chaos':'')+'"><td>#'+c.rank+change+'</td><td><a href="'+url+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(c.name)+'</a>'+(chaos?' ★':'')+'</td><td>'+escapeHtml(c.master)+'</td><td>'+(c.members??'—')+' / '+(c.capacity??'—')+'</td><td>'+fmt(c.reputation)+delta+'</td><td class="gap">'+formatGap(c.gapToAbove)+'</td><td class="gap">'+formatGap(c.gapToLeader)+'</td></tr>';
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

let memberLoading=false;
async function loadMembers(){
 if(memberLoading)return;
 const id=$('memberClanId').value.trim();
 if(!/^\d{1,7}$/.test(id)){ $('memberStatus').textContent='Enter a numeric clan ID'; return; }
 memberLoading=true;
 $('memberStatus').textContent='Updating member gains…';
 try{
  const response=await fetch('/api/members?id='+encodeURIComponent(id)+'&t='+Date.now(),{cache:'no-store'});
  const body=await response.json();
  if(!response.ok||!Array.isArray(body.members))throw Error(body.detail||body.error||'Member data unavailable');
  $('memberStatus').textContent=(body.clanName||'Clan #'+id)+' · '+body.members.length+' members · '+body.date+' (SGT)';
  $('memberRows').innerHTML=body.members.map((m,index)=>'<tr><td>'+(index+1)+'</td><td>'+escapeHtml(m.name)+'</td><td>'+m.level+'</td><td>'+fmt(m.rep)+'</td><td class="'+(m.gain>0?'positive':'')+'">'+(m.gain===null?'—':'+'+fmt(m.gain))+'</td></tr>').join('');
  $('memberFoot').textContent='*Tracked since '+new Date(body.baselineAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore',hour12:false})+' SGT. New members show — until a baseline exists. Auto-updating while visible.';
 }catch(e){$('memberStatus').textContent='Member source error: '+e.message;}finally{memberLoading=false;}
}
$('memberLoad').addEventListener('click',loadMembers);
loadMembers();
setInterval(()=>{if(!document.hidden)loadMembers();},5000);
