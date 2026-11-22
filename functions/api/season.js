// Season-aware storage. Never interpret an unnumbered closed page as a new season.
export const SEASON_STATE_KEY='season-state:v1';
export const ARCHIVE_INDEX_KEY='season-archive-index:v1';
export function seasonNamespace(season){return Number.isInteger(season)&&season>0?'season-'+season:'legacy';}
export function storageKey(kind,day,clanId,season){
 const ns=seasonNamespace(season);
 return ns==='legacy'?kind+':'+day+':'+clanId:kind+':'+ns+':'+day+':'+clanId;
}
export function sgtDate(date=new Date()){
 const x=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return x.year+'-'+x.month+'-'+x.day;
}
export function decideTransition(state,officialSeason){
 const prior=Number.isInteger(state?.season)&&state.season>0?state.season:null;
 const observed=Number.isInteger(officialSeason)&&officialSeason>0?officialSeason:null;
 if(observed===null)return {season:prior,pending:false,changed:false,confirmed:false};
 if(prior===observed)return {season:prior,pending:false,changed:false,confirmed:true};
 // Initial recognized season is isolated from legacy on its first observation.
 if(prior===null)return {season:observed,pending:false,changed:true,confirmed:true};
 // Confirm an actual transition on two separate scheduled observations.
 if(state?.pendingSeason===observed&&state?.pendingCount>=1)return {season:observed,pending:false,changed:true,confirmed:true};
 return {season:prior,pending:true,pendingSeason:observed,pendingCount:1,changed:false,confirmed:false};
}
export function detectMassRepReset(before={},after={}){
 const overlapping=Object.keys(after).filter(name=>Number.isFinite(before[name])&&Number.isFinite(after[name]));
 if(overlapping.length<10)return false;
 const drops=overlapping.filter(name=>after[name]<before[name]).length;
 return drops/overlapping.length>=0.6;
}
export async function readSeasonState(env){return await env.GAINS?.get(SEASON_STATE_KEY,'json')||null;}
export async function archiveSeason(env,state,at){
 const ns=seasonNamespace(state?.season);
 const archiveKey='season-archive:'+ns;
 const existing=await env.GAINS.get(archiveKey,'json');
 if(existing)return existing;
 const data={season:state?.season||null,seasonLabel:ns==='legacy'?'Unverified previous season':'Season '+state.season,archivedAt:at,recordedAt:state?.lastRecordedAt||null,clanId:'3',clanName:'Chaos',lastObservedMemberRep:state?.lastMemberValues||{},lastObservedClanRep:state?.lastClanRep??null,lastObservedRank:state?.lastRank??null,scope:'Last observed snapshot only; not verified official season-end totals or final standings'};
 await env.GAINS.put(archiveKey,JSON.stringify(data)); // permanent archive summary
 const index=await env.GAINS.get(ARCHIVE_INDEX_KEY,'json')||[];
 const next=[...new Set([ns,...(Array.isArray(index)?index:[])])].slice(0,80);
 await env.GAINS.put(ARCHIVE_INDEX_KEY,JSON.stringify(next));
 return data;
}
export async function seasonArchiveResponse(env){
 if(!env.GAINS)return Response.json({error:'Storage not configured'},{status:503});
 try{
  const index=await env.GAINS.get(ARCHIVE_INDEX_KEY,'json')||[];
  const archives=await Promise.all((Array.isArray(index)?index:[]).slice(0,30).map(ns=>env.GAINS.get('season-archive:'+ns,'json')));
  const state=await readSeasonState(env);
  return Response.json({currentSeason:state?.season||null,pendingSeason:state?.pendingSeason||null,archives:archives.filter(Boolean),note:'Archives preserve last observed CHAOS results, not certified official final standings.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:'Archive unavailable',detail:String(e.message||e)},{status:502});}
}
