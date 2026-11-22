// Read-only analysis of recorded CHAOS snapshots. Missing coverage is not guessed.
const HOURS=[1,3,6,24];
const MIN_RATE_MS=5*60*1000;
const MAX_ANCHOR_GAP_MS=15*60*1000;
const DAY_MS=86400000;
function sgtDay(date){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
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
 const id=new URL(request.url).searchParams.get('id')||'3';
 if(id!=='3')return Response.json({error:'Scheduled history is currently available for CHAOS (ID 3) only.'},{status:400,headers:{'Cache-Control':'no-store'}});
 if(!env.GAINS)return Response.json({error:'Tracking storage not configured'},{status:503});
 try{
  const now=new Date(),today=sgtDay(now),yesterday=sgtDay(new Date(now.getTime()-DAY_MS));
  const keys=['member-history:'+yesterday+':3','member-history:'+today+':3','member-baseline:'+today+':3'];
  const [prior,current,baseline]=await Promise.all(keys.map(key=>env.GAINS.get(key,'json')));
  const combined=[...(prior?.snapshots||[]),...(current?.snapshots||[])].filter(p=>Date.parse(p.at)>=now.getTime()-DAY_MS-1800000);
  const analysis=analyzeSnapshots(combined,baseline||{},now);
  return Response.json({clanId:'3',date:today,baselineAt:baseline?.capturedAt||null,updatedAt:now.toISOString(),...analysis,disclaimer:'REP gains are observed from stored snapshots only. No samples, exact inactivity time, or competitor rates are inferred.',target:10000},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:'History unavailable',detail:String(e.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});}
}
