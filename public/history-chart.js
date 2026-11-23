// Recorded REP points only. Never interpolate a missing sample or silently join gaps.
export function historyPoints(series=[],player='',hours=3){
 const valid=series.filter(s=>s&&Number.isFinite(Date.parse(s.at))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 if(!valid.length)return [];
 const latest=Date.parse(valid.at(-1).at),earliest=latest-Math.max(1,Number(hours)||3)*3600000;
 return valid.filter(s=>Date.parse(s.at)>=earliest).map(s=>({
  t:Date.parse(s.at),
  v:player?s.values?.[player]:s.total
 })).filter(p=>typeof p.v==='number'&&Number.isFinite(p.v)&&p.v>=0);
}
export function historySegments(points,maxGapMs=15*60*1000){
 const groups=[];let active=[];
 for(const point of points){
  if(active.length&&point.t-active.at(-1).t>maxGapMs){groups.push(active);active=[];}
  active.push(point);
 }
 if(active.length)groups.push(active);
 return groups;
}
export function comparisonAt(primary,secondary,t){
 const nearest=(points)=>points.reduce((best,p)=>Math.abs(p.t-t)<Math.abs((best?.t??Infinity)-t)?p:best,null);
 const a=nearest(primary),b=nearest(secondary);
 return {primary:a,secondary:b,delta:a&&b&&Math.abs(a.t-b.t)<=15*60*1000?a.v-b.v:null};
}
