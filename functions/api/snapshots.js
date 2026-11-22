// Scheduled member snapshots for CHAOS; no public endpoint can trigger a write.
const CHAOS_ID='3';
const SGT_DATE=(date=new Date())=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day;};
const BASELINE_KEY=date=>'member-baseline:'+date+':'+CHAOS_ID;
const HISTORY_KEY=date=>'member-history:'+date+':'+CHAOS_ID;
const TTL=604800;
const HEALTH_KEY='tracking-health:3';
export async function captureChaosSnapshot(env,now=new Date()){
 if(!env.GAINS)throw Error('GAINS KV binding missing');
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
 const day=SGT_DATE(now),timestamp=now.toISOString();
 const values=Object.fromEntries(members.map(m=>[m.name,m.rep]));
 const baseline=await env.GAINS.get(BASELINE_KEY(day),'json');
 if(!baseline?.values){
  await env.GAINS.put(BASELINE_KEY(day),JSON.stringify({capturedAt:timestamp,values}),{expirationTtl:TTL});
 }
 const stored=await env.GAINS.get(HISTORY_KEY(day),'json');
 const history=Array.isArray(stored?.snapshots)?stored.snapshots:[];
 // One record per scheduled interval. Replace retries in the same five-minute bucket.
 const bucket=Math.floor(now.getTime()/300000);
 const snapshot={at:timestamp,bucket,values,origin:'scheduled'};
 const index=history.findIndex(p=>p.bucket===bucket);
 if(index>=0)history[index]=snapshot;else history.push(snapshot);
 history.sort((a,b)=>a.bucket-b.bucket);
 if(history.length>300)history.splice(0,history.length-300);
 await env.GAINS.put(HISTORY_KEY(day),JSON.stringify({clanId:CHAOS_ID,clanName:body.name||'Chaos',date:day,snapshots:history}),{expirationTtl:TTL});
 return {clanId:CHAOS_ID,date:day,memberCount:members.length,lastSnapshot:timestamp,snapshotsToday:history.length};
}
// Keep a durable result for every cron attempt, including failures.
export async function scheduledCapture(env,now=new Date()){
 const attemptedAt=new Date().toISOString();
 const previous=await env.GAINS.get(HEALTH_KEY,'json').catch(()=>null);
 try{
  const result=await captureChaosSnapshot(env,now);
  await env.GAINS.put(HEALTH_KEY,JSON.stringify({lastAttempt:attemptedAt,lastSuccess:new Date().toISOString(),lastError:null,memberCount:result.memberCount,snapshotsToday:result.snapshotsToday}),{expirationTtl:TTL});
  console.log('Scheduled CHAOS snapshot saved',JSON.stringify(result));
  return result;
 }catch(error){
  const message=String(error?.message||error).slice(0,350);
  console.error('Scheduled CHAOS snapshot failed',message);
  if(env.GAINS){
   try{await env.GAINS.put(HEALTH_KEY,JSON.stringify({lastAttempt:attemptedAt,lastSuccess:previous?.lastSuccess||null,lastError:message,memberCount:previous?.memberCount||0}),{expirationTtl:TTL});}
   catch(writeError){console.error('Tracking health persistence failed',writeError);}
  }
  throw error;
 }
}
export async function trackingStatus(env){
 if(!env.GAINS)return Response.json({error:'Storage not configured'},{status:503});
 const now=new Date(),today=SGT_DATE(now),yesterday=SGT_DATE(new Date(now.getTime()-86400000));
 const latest=await env.GAINS.get(HISTORY_KEY(today),'json');
 const previous=latest?.snapshots?.length?null:await env.GAINS.get(HISTORY_KEY(yesterday),'json');
 const result=latest?.snapshots?.length?latest:previous;
 const last=result?.snapshots?.at(-1);
 const health=await env.GAINS.get(HEALTH_KEY,'json').catch(()=>null);
 const lastScheduled=health?.lastSuccess||null;
 return Response.json({clanId:CHAOS_ID,clanName:'Chaos',schedule:'*/5 * * * *',intervalMinutes:5,lastSnapshot:last?.at||null,snapshotsToday:latest?.snapshots?.length||0,latestDate:result?.date||null,memberCount:last?Object.keys(last.values).length:0,lastAttempt:health?.lastAttempt||null,lastScheduledSuccess:lastScheduled,lastError:health?.lastError||null,active:Boolean(lastScheduled&&now.getTime()-Date.parse(lastScheduled)<900000)}, {headers:{'Cache-Control':'no-store'}});
}
