import {parse as parseRankings} from './clans.js';
import {recordTrackingAlerts} from './alerts.js';
import {captureRotatingClans} from './all-clans.js';
import {storageKey,sgtDate,decideTransition,readSeasonState,archiveSeason,detectMassRepReset,SEASON_STATE_KEY} from './season.js';
// Scheduled member snapshots for CHAOS; no public endpoint can trigger a write.
const CHAOS_ID='3';
const SGT_DATE=sgtDate;
const BASELINE_KEY=(date,season)=>storageKey('member-baseline',date,CHAOS_ID,season);
const HISTORY_KEY=(date,season)=>storageKey('member-history',date,CHAOS_ID,season);
const TTL=604800;
const HEALTH_KEY='tracking-health:3';
export async function captureChaosSnapshot(env,now=new Date()){
 if(!env.GAINS)throw Error('GAINS KV binding missing');
 // The game may say "season closed" without disclosing a number.
 // Only numbered, confirmed changes can create a new season namespace.
 const rankingResponse=await fetch('https://ninjazenshin.online/clan-ranking',{headers:{Accept:'text/html','User-Agent':'ClanLiveDashboard/1.3'},signal:AbortSignal.timeout(12000),cache:'no-store'});
 if(!rankingResponse.ok)throw Error('Season check HTTP '+rankingResponse.status);
 const official=parseRankings(await rankingResponse.text());
 const state=await readSeasonState(env);
 const decision=decideTransition(state,official.seasonStatus==='closed'?null:official.season);
 const day=SGT_DATE(now),timestamp=now.toISOString();
 if(decision.pending){
  await env.GAINS.put(SEASON_STATE_KEY,JSON.stringify({...state,pendingSeason:decision.pendingSeason,pendingCount:1,lastSeasonCheck:timestamp}));
  return {skipped:true,reason:'Verifying season '+decision.pendingSeason+' on next scheduled check',season:state?.season||null,official};
 }
 if(decision.changed){
  if(state?.season){await archiveSeason(env,state,timestamp);}
  else {
   const old=await env.GAINS.get(HISTORY_KEY(day,null),'json')||await env.GAINS.get(HISTORY_KEY(SGT_DATE(new Date(now.getTime()-86400000)),null),'json');
   const last=old?.snapshots?.at(-1);
   if(last)await archiveSeason(env,{season:null,lastRecordedAt:last.at,lastMemberValues:last.values,lastClanRep:null,lastRank:null},timestamp);
  }
 }
 const season=decision.season;
 const r=await fetch('https://ninjazenshin.online/clan-ranking/members/3',{
  headers:{Accept:'application/json','User-Agent':'ClanLiveDashboard/1.2'},
  signal:AbortSignal.timeout(12000),cache:'no-store'
 });
 if(!r.ok)throw Error('CHAOS source HTTP '+r.status);
 const body=await r.json();
 if(!Array.isArray(body.members)||body.members.length===0)throw Error('CHAOS member list unavailable');
 const members=body.members.map(m=>({name:String(m.name||'').trim(),level:Number(m.level)||0,rep:Number(m.rep)}))
   .filter(m=>m.name&&Number.isFinite(m.rep));
 if(!members.length)throw Error('No valid CHAOS members');
 const values=Object.fromEntries(members.map(m=>[m.name,m.rep]));
 if(!decision.changed&&detectMassRepReset(state?.lastMemberValues||{},values)){
  const reason='Potential season reset detected from widespread REP decreases; waiting for confirmed numbered season';
  console.warn(reason);
  return {skipped:true,reason,season,official};
 }

 const baseline=await env.GAINS.get(BASELINE_KEY(day,season),'json');
 if(!baseline?.values){
  await env.GAINS.put(BASELINE_KEY(day,season),JSON.stringify({capturedAt:timestamp,values}),{expirationTtl:TTL});
 }
 const stored=await env.GAINS.get(HISTORY_KEY(day,season),'json');
 const history=Array.isArray(stored?.snapshots)?stored.snapshots:[];
 // One record per scheduled interval. Replace retries in the same five-minute bucket.
 const bucket=Math.floor(now.getTime()/300000);
 const snapshot={at:timestamp,bucket,values,origin:'scheduled'};
 const index=history.findIndex(p=>p.bucket===bucket);
 if(index>=0)history[index]=snapshot;else history.push(snapshot);
 history.sort((a,b)=>a.bucket-b.bucket);
 if(history.length>300)history.splice(0,history.length-300);
 await env.GAINS.put(HISTORY_KEY(day,season),JSON.stringify({clanId:CHAOS_ID,clanName:body.name||'Chaos',date:day,season,snapshots:history}),{expirationTtl:TTL});
 const chaos=official.clans.find(c=>String(c.id)==='3'||c.name.toLowerCase()==='chaos');
 const updatedState={season,pendingSeason:null,pendingCount:0,lastSeasonCheck:timestamp,lastRecordedAt:timestamp,lastMemberValues:values,lastClanRep:chaos?.reputation??null,lastRank:chaos?.rank??null,lastSeasonStatus:official.seasonStatus};
 const age=Date.parse(state?.lastRecordedAt||'');
 const shouldWrite=decision.changed||state?.pendingSeason||!Number.isFinite(age)||now.getTime()-age>=15*60*1000;
 if(shouldWrite)await env.GAINS.put(SEASON_STATE_KEY,JSON.stringify(updatedState));
 return {clanId:CHAOS_ID,date:day,season,seasonChanged:decision.changed,memberCount:members.length,lastSnapshot:timestamp,snapshotsToday:history.length,official};
}
// Keep a durable result for every cron attempt, including failures.
export async function scheduledCapture(env,now=new Date()){
 const attemptedAt=new Date().toISOString();
 const previous=await env.GAINS.get(HEALTH_KEY,'json').catch(()=>null);
 try{
  const result=await captureChaosSnapshot(env,now);
  if(result.skipped){await env.GAINS.put(HEALTH_KEY,JSON.stringify({...previous,lastAttempt:attemptedAt,lastWarning:result.reason,lastError:null}),{expirationTtl:TTL});await recordTrackingAlerts(env,{now:attemptedAt,official:result.official,skipped:true,warning:result.reason});return result;}
  await env.GAINS.put(HEALTH_KEY,JSON.stringify({lastAttempt:attemptedAt,lastSuccess:new Date().toISOString(),lastError:null,lastWarning:null,season:result.season,memberCount:result.memberCount,snapshotsToday:result.snapshotsToday}),{expirationTtl:TTL});
  // Other ranked clans are best-effort: an unavailable clan must not mark CHAOS tracking failed.
  try{
   const rotated=await captureRotatingClans(env,now,result.official,result.season);
   console.log('Ranked clan rotation',JSON.stringify(rotated));
  }catch(rotationError){console.error('Ranked clan rotation failed',rotationError);}
  await recordTrackingAlerts(env,{now:attemptedAt,official:result.official});
  console.log('Scheduled CHAOS snapshot saved',JSON.stringify({...result,official:undefined}));
  return result;
 }catch(error){
  const message=String(error?.message||error).slice(0,350);
  console.error('Scheduled CHAOS snapshot failed',message);
  if(env.GAINS){
   try{await env.GAINS.put(HEALTH_KEY,JSON.stringify({lastAttempt:attemptedAt,lastSuccess:previous?.lastSuccess||null,lastError:message,memberCount:previous?.memberCount||0}),{expirationTtl:TTL});}
   catch(writeError){console.error('Tracking health persistence failed',writeError);}
  }
  try{await recordTrackingAlerts(env,{now:attemptedAt,error:message});}catch(alertError){console.error('Alert state update failed',alertError);}
  throw error;
 }
}
export async function trackingStatus(env){
 if(!env.GAINS)return Response.json({error:'Storage not configured'},{status:503});
 const now=new Date(),today=SGT_DATE(now),yesterday=SGT_DATE(new Date(now.getTime()-86400000));
 const state=await readSeasonState(env);const season=state?.season||null;
 const latest=await env.GAINS.get(HISTORY_KEY(today,season),'json');
 const previous=latest?.snapshots?.length?null:await env.GAINS.get(HISTORY_KEY(yesterday,season),'json');
 const result=latest?.snapshots?.length?latest:previous;
 const last=result?.snapshots?.at(-1);
 const health=await env.GAINS.get(HEALTH_KEY,'json').catch(()=>null);
 const lastScheduled=health?.lastSuccess||null;
 return Response.json({clanId:CHAOS_ID,clanName:'Chaos',season,pendingSeason:state?.pendingSeason||null,lastSeasonCheck:state?.lastSeasonCheck||null,lastWarning:health?.lastWarning||null,schedule:'*/5 * * * *',intervalMinutes:5,lastSnapshot:last?.at||null,snapshotsToday:latest?.snapshots?.length||0,latestDate:result?.date||null,memberCount:last?Object.keys(last.values).length:0,lastAttempt:health?.lastAttempt||null,lastScheduledSuccess:lastScheduled,lastError:health?.lastError||null,active:Boolean(lastScheduled&&now.getTime()-Date.parse(lastScheduled)<900000)}, {headers:{'Cache-Control':'no-store'}});
}
