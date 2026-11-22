import {storageKey,sgtDate,readSeasonState} from './season.js';
import {readAllClanDay} from './all-clans.js';
// Read-only analysis of recorded CHAOS snapshots. Missing coverage is not guessed.
const HOURS=[1,3,6,24];
const MIN_RATE_MS=5*60*1000;
const MAX_ANCHOR_GAP_MS=15*60*1000;
const DAY_MS=86400000;
function finite(x){return typeof x==='number'&&Number.isFinite(x)?x:null;}
function pointValue(p,name){return finite(p?.values?.[name]);}
export function analyzeSnapshots(snapshots,baseline={},now=new Date()){
 const ordered=snapshots.filter(p=>Number.isFinite(Date.parse(p.at))&&p.values&&typeof p.values==='object').sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const newest=ordered.at(-1),earliest=ordered[0];
 if(!newest)return {members:[],series:[],totalRatePerHour:null,coverageMinutes:0,hasHistory:false};
 const names=Object.keys(newest.values).sort();
 const elapsed=earliest?(Date.parse(newest.at)-Date.parse(earliest.at)):0;
 const metrics=names.map(name=>{
  const current=pointValue(newest,name);
  const starting=finite(baseline.values?.[name]);
  const gain=starting===null||current===null||current<starting?null:current-starting;
  let first=null,last=null,previous=null,lastIncreaseAt=null,reset=false;
  for(const point of ordered){
   const v=pointValue(point,name);
   if(v===null)continue;
   if(previous!==null&&v<previous)reset=true;
   if(previous!==null&&v>previous)lastIncreaseAt=point.at;
   if(!first)first={at:point.at,rep:v};
   last={at:point.at,rep:v};
   previous=v;
  }
  const span=first&&last?Date.parse(last.at)-Date.parse(first.at):0;
  const avgRate=span>=MIN_RATE_MS&&last.rep>=first.rep&&!reset?(last.rep-first.rep)/(span/3600000):null;
  const windows={};
  for(const hours of HOURS){
   const target=Date.parse(newest.at)-hours*3600000;
   const candidates=ordered.filter(p=>Date.parse(p.at)<=target&&target-Date.parse(p.at)<=MAX_ANCHOR_GAP_MS&&pointValue(p,name)!==null);
   const anchor=candidates.at(-1);
   const v=pointValue(anchor,name);
   windows[hours+'h']=v===null||current<v?null:current-v;
  }
  const progress=gain===null?null:Math.round(1000*Math.min(1,gain/10000))/10;
  return {name,rep:current,dayGain:gain,gainPerHour:avgRate,lastIncreaseAt,resetDetected:reset,progress10k:progress,remaining10k:gain===null?null:Math.max(0,10000-gain),windows};
 });
 const series=ordered.map(p=>({at:p.at,total:Object.values(p.values).reduce((sum,n)=>sum+(finite(n)||0),0),values:p.values}));
 const totalFirst=series[0],totalLast=series.at(-1);
 // Only calculate a comparable total pace with a stable roster and at least 5m coverage.
 const stable=ordered.length>=2&&ordered.every(p=>names.length===Object.keys(p.values).length&&names.every(n=>finite(p.values[n])!==null));
 const totalRatePerHour=stable&&elapsed>=MIN_RATE_MS&&totalLast.total>=totalFirst.total?(totalLast.total-totalFirst.total)/(elapsed/3600000):null;
 return {members:metrics,series,totalRatePerHour,coverageMinutes:Math.floor(elapsed/60000),hasHistory:ordered.length>=2,firstSnapshot:earliest.at,lastSnapshot:newest.at,snapshots:ordered.length};
}
export async function performanceResponse(request,env){
 const params=new URL(request.url).searchParams;
 const id=params.get('id')||'3';
 const expected=params.get('season');
 if(!/^[0-9]{1,7}$/.test(id))return Response.json({error:'Invalid clan ID'},{status:400,headers:{'Cache-Control':'no-store'}});
 if(!env.GAINS)return Response.json({error:'Tracking storage not configured'},{status:503});
 try{
  const state=await readSeasonState(env);const season=state?.season||null;
  if(expected&&/^[0-9]+$/.test(expected)&&Number(expected)!==season)return Response.json({error:'Season transition pending verification',expectedSeason:Number(expected),trackedSeason:season},{status:409,headers:{'Cache-Control':'no-store'}});
  const now=new Date(),today=sgtDate(now),yesterday=sgtDate(new Date(now.getTime()-DAY_MS));
  let prior,current,baseline,combined,coverageMode,cycleMinutes=null;
  if(id==='3'){
   const keys=[storageKey('member-history',yesterday,id,season),storageKey('member-history',today,id,season),storageKey('member-baseline',today,id,season)];
   [prior,current,baseline]=await Promise.all(keys.map(key=>env.GAINS.get(key,'json')));
   combined=[...(prior?.snapshots||[]),...(current?.snapshots||[])];
   coverageMode='5-minute CHAOS snapshots';
   cycleMinutes=5;
  }else{
   [prior,current,baseline]=await Promise.all([readAllClanDay(env,yesterday,season),readAllClanDay(env,today,season),env.GAINS.get(storageKey('member-baseline',today,id,season),'json')]);
   const previousSamples=prior?.clans?.[id]?.samples||[];
   const todaysSamples=current?.clans?.[id]?.samples||[];
   combined=[...previousSamples,...todaysSamples];
   const earliestToday=todaysSamples[0];
   if(earliestToday?.values&&(!baseline?.values||Date.parse(earliestToday.at)<Date.parse(baseline.capturedAt||'')))baseline={capturedAt:earliestToday.at,values:earliestToday.values};
   coverageMode='rotating ranked clan snapshots';
   cycleMinutes=current?.lastBatch?.cycleMinutes??prior?.lastBatch?.cycleMinutes??null;
  }
  combined=combined.filter(p=>Number.isFinite(Date.parse(p.at))&&Date.parse(p.at)>=now.getTime()-DAY_MS-1800000);
  const analysis=analyzeSnapshots(combined,baseline||{},now);
  return Response.json({clanId:id,season,date:today,baselineAt:baseline?.capturedAt||null,updatedAt:now.toISOString(),coverageMode,cycleMinutes,...analysis,disclaimer:'Rates and gains come from stored samples only. Other clans are sampled on a rotating schedule; missing history is never estimated.',target:10000},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:'History unavailable',detail:String(e.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});}
}
