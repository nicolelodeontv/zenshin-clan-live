const memberUrl = id => 'https://ninjazenshin.online/clan-ranking/members/'+id;
const sgtDate=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'});
export async function membersResponse(request,env){
 const id=new URL(request.url).searchParams.get('id')||'3';
 if(!/^\d{1,7}$/.test(id))return Response.json({error:'Invalid clan ID'},{status:400});
 try{
  const upstream=await fetch(memberUrl(id),{headers:{Accept:'application/json','User-Agent':'ClanLiveDashboard/1.1'},signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!upstream.ok)throw Error('Member source HTTP '+upstream.status);
  const body=await upstream.json();
  if(!Array.isArray(body.members))throw Error('Invalid member list');
  const members=body.members.map(m=>({name:String(m.name||'').trim(),level:Number(m.level)||0,rep:Number(m.rep)||0})).filter(m=>m.name&&Number.isFinite(m.rep));
  if(!members.length)throw Error('No members received');
  const day=sgtDate(),key='member-baseline:'+day+':'+id;
  let baseline=null;
  if(env.GAINS) {
   try{baseline=await env.GAINS.get(key,'json');}catch(e){console.error('KV read failure',e);}
  }
  const current=Object.fromEntries(members.map(m=>[m.name,m.rep]));
  let baselineEstablished=false;
  if(!baseline||typeof baseline.values!=='object'||!baseline.values){
   baseline={capturedAt:new Date().toISOString(),values:current};
   baselineEstablished=true;
   if(env.GAINS){try{await env.GAINS.put(key,JSON.stringify(baseline),{expirationTtl:172800});}catch(e){console.error('KV write failure',e);}}
  }
  const enriched=members.map(m=>{const initial=baseline.values[m.name];return {...m,gain:initial===undefined?null:Math.max(0,m.rep-Number(initial)),tracked:initial!==undefined};}).sort((a,b)=>(b.gain??-1)-(a.gain??-1)||b.rep-a.rep);
  return Response.json({clanId:id,clanName:body.name||null,clanReputation:body.reputation??null,date:day,baselineAt:baseline.capturedAt,baselineEstablished,members:enriched,updatedAt:new Date().toISOString(),note:'Gain since the first stored snapshot of this SGT day, not necessarily midnight. New members need a baseline before gains appear.'},{headers:{'Cache-Control':'public,max-age=0,s-maxage=5,stale-while-revalidate=2'}});
 }catch(e){return Response.json({error:'Member data unavailable',detail:String(e.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});}
}
