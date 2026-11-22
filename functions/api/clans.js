const SOURCE='https://ninjazenshin.online/clan-ranking';
const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(full,item)=>{if(item[0]==='#'){let n=item[1]?.toLowerCase()==='x'?parseInt(item.slice(2),16):parseInt(item.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):full;}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[item.toLowerCase()]??full;});
const plain=s=>decode(s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
export function parse(html){
 const season=+(html.match(/Season\s*(\d+)/i)?.[1]||0)||null;
 const table=[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].find(m=>/Reputation/i.test(plain(m[1]))&&/Clan/i.test(plain(m[1])));
 if(!table)throw Error('Ranking table not found');
 const clans=[];
 for(const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m=>plain(m[1]));
  if(cells.length<5)continue;
  const rank=Number(cells[0].replace(/[^\d]/g,'')),reputation=Number(cells[4].replace(/[^\d]/g,''));
  if(!rank||!cells[1]||!Number.isFinite(reputation))continue;
  const members=cells[3].match(/(\d+)\s*\/\s*(\d+)/);
  const id=row[1].match(/data-clan\s*=\s*["'](\d+)["']/i)?.[1]||row[1].match(/\/clan-ranking\/members\/(\d+)/)?.[1]||null;
  clans.push({id,rank,name:cells[1],master:cells[2],members:members?+members[1]:null,capacity:members?+members[2]:null,reputation});
 }
 if(clans.length<2)throw Error('Ranking data incomplete');
 return {season,clans,updatedAt:new Date().toISOString(),source:SOURCE};
}
export async function onRequestGet(){
 try{
  const r=await fetch(SOURCE,{headers:{Accept:'text/html','User-Agent':'Mozilla/5.0 (compatible; ClanLiveDashboard/1.0)'},signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!r.ok)throw Error('Source returned HTTP '+r.status);
  return Response.json(parse(await r.text()),{headers:{'Cache-Control':'public, max-age=0, s-maxage=5, stale-while-revalidate=2'}});
 }catch(e){return Response.json({error:'Ranking source unavailable',detail:String(e.message||e)},{status:502,headers:{'Cache-Control':'no-store'}});}
}