// Site-only event notices. No Discord webhook or unsolicited external delivery.
const EVENTS_KEY='tracking-alerts:v1';
const STATE_KEY='tracking-alert-observed:v1';
const LIMIT=35;
const KEEP_MS=30*24*60*60*1000;
const validateTimestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
export function deriveEvents(previous,observation,at){
 const events=[];
 const emit=(kind,severity,title,detail)=>events.push({id:kind+':'+at,kind,severity,title,detail,at});
 if(previous){
  if(previous.seasonStatus!==observation.seasonStatus&&observation.seasonStatus==='closed')
   emit('season-closed','info','Official season closed','The official ranking page reports that the season is closed.');
  if(observation.season&&previous.season!==observation.season)
   emit('season-number','info','Season '+observation.season+' detected','The official ranking page now identifies Season '+observation.season+'. REP baselines will switch only after scheduled verification.');
  if(observation.seasonEndAt&&observation.seasonEndAt!==previous.seasonEndAt)
   emit('season-end-date','info','Season-end deadline announced','Official deadline: '+observation.seasonEndAt+' (displayed in SGT on the site).');
  if(observation.nextSeasonStartAt&&observation.nextSeasonStartAt!==previous.nextSeasonStartAt)
   emit('next-season-date','info','Next-season start announced','Official next-season start: '+observation.nextSeasonStartAt+' (displayed in SGT on the site).');
 }
 if(observation.trackingState==='error'&&previous?.trackingState!=='error')
  emit('tracking-error','warning','CHAOS background tracking failed',observation.error||'The latest scheduled collection failed.');
 if(observation.trackingState==='paused'&&previous?.trackingState!=='paused')
  emit('tracking-paused','warning','REP capture paused',observation.warning||'Season verification is protecting REP baselines.');
 if(observation.trackingState==='healthy'&&previous&&previous.trackingState!=='healthy')
  emit('tracking-recovered','info','CHAOS tracking resumed','A scheduled CHAOS member snapshot was saved successfully.');
 return events;
}
export async function recordTrackingAlerts(env,metadata={}){
 if(!env.GAINS)throw Error('GAINS KV binding required');
 const now=metadata.now||new Date().toISOString();
 const previous=await env.GAINS.get(STATE_KEY,'json');
 const observed={
  season:Number.isInteger(metadata.official?.season)?metadata.official.season:null,
  seasonStatus:metadata.official?.seasonStatus||'unknown',
  seasonEndAt:validateTimestamp(metadata.official?.seasonEndAt),
  nextSeasonStartAt:validateTimestamp(metadata.official?.nextSeasonStartAt),
  trackingState:metadata.error?'error':metadata.skipped?'paused':'healthy',
  error:metadata.error||null,warning:metadata.warning||null
 };
 const next=deriveEvents(previous,observed,now);
 if(next.length){
  const stored=await env.GAINS.get(EVENTS_KEY,'json');
  const old=Array.isArray(stored)?stored:[];
  const cutoff=Date.parse(now)-KEEP_MS;
  const events=[...next,...old].filter(e=>e&&Number.isFinite(Date.parse(e.at))&&Date.parse(e.at)>=cutoff).slice(0,LIMIT);
  await env.GAINS.put(EVENTS_KEY,JSON.stringify(events));
 }
 await env.GAINS.put(STATE_KEY,JSON.stringify(observed));
 return {newEvents:next.length,trackingState:observed.trackingState};
}
export async function alertsResponse(env){
 if(!env.GAINS)return Response.json({error:'Tracking storage unavailable'},{status:503});
 try{
  const [history,observed,health]=await Promise.all([
   env.GAINS.get(EVENTS_KEY,'json'),env.GAINS.get(STATE_KEY,'json'),env.GAINS.get('tracking-health:3','json')
  ]);
  const now=Date.now(),last=health?.lastSuccess||null;
  const stale=!last||!Number.isFinite(Date.parse(last))||now-Date.parse(last)>15*60*1000;
  const liveWarning=stale?{id:'tracking-stale',kind:'tracking-stale',severity:'warning',title:'CHAOS background snapshots are stale',detail:last?'Last successful snapshot: '+last+'. The scheduler may be delayed or unavailable.':'No successful scheduled snapshot has been confirmed.',at:new Date().toISOString(),ephemeral:true}:null;
  const historyEvents=Array.isArray(history)?history.filter(e=>e&&Number.isFinite(Date.parse(e.at))&&Date.parse(e.at)>=now-KEEP_MS):[];
  return Response.json({events:liveWarning?[liveWarning,...historyEvents]:historyEvents,trackingHealthy:!stale,lastSuccess:last,official:observed?{season:observed.season,seasonStatus:observed.seasonStatus,seasonEndAt:observed.seasonEndAt,nextSeasonStartAt:observed.nextSeasonStartAt}:null,updatedAt:new Date().toISOString(),note:'Notices appear on the website only; they are not Discord or push notifications.'},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:'Alert records unavailable',detail:String(error.message||error)},{status:502,headers:{'Cache-Control':'no-store'}});}
}
