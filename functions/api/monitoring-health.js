// Read-only diagnostics. Sample gaps are observations, not proof the upstream source was down.
import {sgtDate,storageKey,readSeasonState} from './season.js';
import {readAllClanDay} from './all-clans.js';
const DAY=86400000;
const CHAOS_INTERVAL=300000;
const STALE_GRACE=15*60000;
const numericTime=value=>value&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
export function analyzeMonitoringHealth(input,now=new Date()){
 const nowMs=now.getTime();
 const chaos=input.chaos||null;
 const lastChaos=numericTime(input.lastChaosSuccess);
 const chaosAgeMinutes=lastChaos===null?null:Math.max(0,Math.floor((nowMs-lastChaos)/60000));
 const chaosState=input.lastChaosError?'error':input.lastChaosWarning?'paused':lastChaos===null?'no-data':nowMs-lastChaos>STALE_GRACE?'stale':'healthy';
 const series=(input.chaosSamples||[]).filter(p=>numericTime(p?.at)!==null).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 let chaosObservedGaps=0,chaosLargestGapMinutes=0;
 for(let i=1;i<series.length;i++){
  const gap=Date.parse(series[i].at)-Date.parse(series[i-1].at);
  if(gap>2*CHAOS_INTERVAL){chaosObservedGaps++;chaosLargestGapMinutes=Math.max(chaosLargestGapMinutes,Math.round(gap/60000));}
 }
 const clans=input.clans||{};
 const candidateCount=Number.isInteger(input.candidateCount)?input.candidateCount:null;
 const cycleMs=Math.max(5,Number(input.cycleMinutes)||55)*60000;
 const details=Object.values(clans).map(c=>{
  const at=numericTime(c.lastSampleAt||c.samples?.at(-1)?.at);
  const age=at===null?null:Math.max(0,Math.floor((nowMs-at)/60000));
  const samples=Array.isArray(c.samples)?c.samples.length:0;
  const status=age===null?'not-sampled':nowMs-at>cycleMs+STALE_GRACE?'stale':'sampled';
  return {id:String(c.id),name:String(c.name||'Clan '+c.id),lastSampleAt:at===null?null:new Date(at).toISOString(),ageMinutes:age,samples,status};
 }).sort((a,b)=>(a.status==='stale'?0:1)-(b.status==='stale'?0:1)||(b.ageMinutes??0)-(a.ageMinutes??0));
 const staleClans=details.filter(c=>c.status==='stale');
 const attempts=(input.recentBatches||[]).filter(b=>numericTime(b?.attempted)!==null).sort((a,b)=>Date.parse(b.attempted)-Date.parse(a.attempted));
 const recentFailures=attempts.flatMap(b=>(Array.isArray(b.errors)?b.errors:[]).map(e=>({id:String(e.id),at:b.attempted,reason:String(e.reason||'Fetch failed').slice(0,100)}))).slice(-30).reverse();
 const requested=attempts.reduce((sum,b)=>sum+(Number(b.requested)||0),0);
 const succeeded=attempts.reduce((sum,b)=>sum+(Number(b.success)||0),0);
 const lastBatch=attempts.at(-1)||input.lastBatch||null;
 const lastBatchAt=numericTime(lastBatch?.attempted);
 const rotatingState=lastBatchAt===null?'not-started':nowMs-lastBatchAt>STALE_GRACE?'stale':Number(lastBatch.success)===0?'failed':'healthy';
 return {
  chaos:{state:chaosState,lastSuccess:input.lastChaosSuccess||null,lastError:input.lastChaosError||null,lastWarning:input.lastChaosWarning||null,ageMinutes:chaosAgeMinutes,snapshots:series.length,observedGaps:chaosObservedGaps,largestObservedGapMinutes:chaosLargestGapMinutes},
  rotating:{state:rotatingState,trackedToday:Number(input.trackedToday)||0,totalRankedOtherClans:candidateCount,cycleMinutes:Math.round(cycleMs/60000),lastBatch,attempts:attempts.length,requested,succeeded,failed:Math.max(0,requested-succeeded),recentFailures,staleCount:staleClans.length,staleClans:staleClans.slice(0,12),clansWithHistory:details.length},
  limitations:'A gap is computed only between stored observations. New clans and initial unsampled rotations are not classified as failed. Only recent batch results stored since this feature launched can be reported.'
 };
}
export async function monitoringHealthResponse(env){
 if(!env.GAINS)return Response.json({error:'Tracking KV is not configured'},{status:503});
 try{
  const now=new Date(),today=sgtDate(now),yesterday=sgtDate(new Date(now.getTime()-DAY)),state=await readSeasonState(env),season=state?.season||null;
  const [health,chaosToday,chaosYesterday,rotatingToday,rotatingYesterday]=await Promise.all([
   env.GAINS.get('tracking-health:3','json'),
   env.GAINS.get(storageKey('member-history',today,'3',season),'json'),
   env.GAINS.get(storageKey('member-history',yesterday,'3',season),'json'),
   readAllClanDay(env,today,season),readAllClanDay(env,yesterday,season)
  ]);
  const batches=[...(rotatingYesterday?.recentBatches||[]),...(rotatingToday?.recentBatches||[])].filter(b=>numericTime(b?.attempted)!==null&&Date.parse(b.attempted)>=now.getTime()-DAY);
  const byClan={...(rotatingYesterday?.clans||{}),...(rotatingToday?.clans||{})};
  const report=analyzeMonitoringHealth({
   lastChaosSuccess:health?.lastSuccess||null,
   lastChaosError:health?.lastError||null,
   lastChaosWarning:health?.lastWarning||null,
   chaosSamples:[...(chaosYesterday?.snapshots||[]),...(chaosToday?.snapshots||[])],
   clans:byClan,trackedToday:Object.keys(rotatingToday?.clans||{}).length,
   candidateCount:rotatingToday?.lastBatch?.totalCandidates??rotatingYesterday?.lastBatch?.totalCandidates??null,
   cycleMinutes:rotatingToday?.lastBatch?.cycleMinutes??rotatingYesterday?.lastBatch?.cycleMinutes??55,
   lastBatch:rotatingToday?.lastBatch||rotatingYesterday?.lastBatch||null,
   recentBatches:batches
  },now);
  return Response.json({date:today,season,generatedAt:now.toISOString(),...report},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:'Monitoring health unavailable',detail:String(error.message||error)},{status:502,headers:{'Cache-Control':'no-store'}});}
}
