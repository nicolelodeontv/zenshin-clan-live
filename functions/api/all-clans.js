// Budgeted rotation across all ranked clans, excluding CHAOS (tracked separately).
// Eight clans per five-minute cron => up to ~55 minutes for a full 88-clan rotation.
// Store all non-CHAOS observations in one daily KV value rather than one write per clan.
import {sgtDate,seasonNamespace,readSeasonState} from './season.js';
export const ROTATING_BATCH_SIZE=8;
const RETENTION=7*24*60*60;
const INTERVAL=300000;
export function allClanKey(day,season){return 'all-clan-history:'+seasonNamespace(season)+':'+day;}
export function rotateClans(clans,at,batchSize=ROTATING_BATCH_SIZE){
 const candidates=clans.filter(c=>/^[0-9]{1,7}$/.test(String(c.id||''))&&String(c.id)!=='3');
 candidates.sort((a,b)=>Number(a.id)-Number(b.id));
 const groups=Math.max(1,Math.ceil(candidates.length/batchSize));
 const slot=Math.floor(new Date(at).getTime()/INTERVAL);
 const position=((slot%groups)+groups)%groups;
 return {selected:candidates.slice(position*batchSize,(position+1)*batchSize),groups,position,total:candidates.length,cycleMinutes:groups*5};
}
export function appendRotatingSnapshots(stored,results,metadata){
 const day=metadata.day,season=metadata.season;
 const data=stored?.season===season&&stored?.date===day&&stored.clans&&typeof stored.clans==='object'?stored:{date:day,season,clans:{}};
 for(const result of results){
  const id=String(result.id),old=data.clans[id];
  const series=Array.isArray(old?.samples)?old.samples:[];
  const item={at:metadata.at,values:result.values};
  const bucket=Math.floor(Date.parse(metadata.at)/INTERVAL);
  const existing=series.findIndex(p=>Math.floor(Date.parse(p.at)/INTERVAL)===bucket);
  if(existing>=0)series[existing]=item;else series.push(item);
  series.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  // A clan is sampled at most ~27 times daily; cap to protect KV value growth.
  if(series.length>64)series.splice(0,series.length-64);
  data.clans[id]={id,name:result.name,samples:series,lastSampleAt:metadata.at,memberCount:Object.keys(result.values).length};
 }
 data.updatedAt=metadata.at;
 const batch={attempted:metadata.at,requested:metadata.requested,success:results.length,errors:metadata.errors||[],cycleMinutes:metadata.cycleMinutes,totalCandidates:metadata.totalCandidates??null};
 data.lastBatch=batch;
 const recent=Array.isArray(data.recentBatches)?data.recentBatches:[];
 const bucket=Math.floor(Date.parse(metadata.at)/INTERVAL);
 data.recentBatches=[...recent.filter(b=>Math.floor(Date.parse(b.attempted)/INTERVAL)!==bucket),batch].sort((a,b)=>Date.parse(a.attempted)-Date.parse(b.attempted)).slice(-24);
 return data;
}
export async function readAllClanDay(env,day,season){
 return env.GAINS.get(allClanKey(day,season),'json');
}
export async function captureRotatingClans(env,now,official,season){
 if(!env.GAINS)throw Error('GAINS binding missing');
 if(!official?.clans?.length)throw Error('Ranked clan roster unavailable');
 const rotation=rotateClans(official.clans,now);
 const day=sgtDate(now),at=new Date().toISOString();
 // Small concurrent batches avoid hammering the official source.
 const results=[],errors=[];
 const selected=rotation.selected;
 for(let offset=0;offset<selected.length;offset+=3){
  const segment=selected.slice(offset,offset+3);
  const sampled=await Promise.all(segment.map(async clan=>{
   const id=String(clan.id);
   try{
    const response=await fetch('https://ninjazenshin.online/clan-ranking/members/'+id,{
     headers:{Accept:'application/json','User-Agent':'ClanLiveDashboard/1.5'},
     signal:AbortSignal.timeout(10000),cache:'no-store'
    });
    if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();
    if(!Array.isArray(data.members)||!data.members.length)throw Error('Missing member roster');
    const values={};
    for(const member of data.members){
     const name=String(member.name||'').trim(),rep=Number(member.rep);
     if(name&&Number.isFinite(rep)&&rep>=0)values[name]=rep;
    }
    if(!Object.keys(values).length)throw Error('No valid member REP');
    return {id,name:String(data.name||clan.name),values};
   }catch(error){errors.push({id,reason:String(error.message||error).slice(0,100)});return null;}
  }));
  results.push(...sampled.filter(Boolean));
 }
 // Persist the batch outcome even when every request failed, keeping prior successful samples intact.
 const stored=await readAllClanDay(env,day,season);
 const merged=appendRotatingSnapshots(stored,results,{day,season,at,requested:selected.length,errors,cycleMinutes:rotation.cycleMinutes,totalCandidates:rotation.total});
 await env.GAINS.put(allClanKey(day,season),JSON.stringify(merged),{expirationTtl:RETENTION});
 return {date:day,season,requested:selected.length,saved:results.length,errors,cycleMinutes:rotation.cycleMinutes,trackedToday:Object.keys(merged.clans).length};
}
export async function allClanStatusResponse(env){
 if(!env.GAINS)return Response.json({error:'Tracking storage not configured'},{status:503});
 try{
  const now=new Date(),day=sgtDate(now),state=await readSeasonState(env),season=state?.season||null;
  const today=await readAllClanDay(env,day,season);
  const count=Object.keys(today?.clans||{}).length;
  return Response.json({date:day,season,trackedToday:count,lastBatch:today?.lastBatch||null,updatedAt:today?.updatedAt||null,
    rotationBatchSize:ROTATING_BATCH_SIZE,chaosIntervalMinutes:5,scope:'Other clans are collected in rotation. Missing samples are not estimated.'},
   {headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:'Coverage unavailable',detail:String(error.message||error)},{status:502});}
}
