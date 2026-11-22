export function enrichRankings(clans) {
 const ranked = [...clans].sort((a,b)=>a.rank-b.rank || b.reputation-a.reputation);
 const leader = ranked[0];
 return ranked.map((clan,index) => ({
  ...clan,
  gapToLeader: leader ? Math.max(0,leader.reputation-clan.reputation) : null,
  gapToAbove: index === 0 ? 0 : Math.max(0,ranked[index-1].reputation-clan.reputation),
  aboveClan: index === 0 ? null : ranked[index-1].name
 }));
}
export const formatGap = value => value === null || value === undefined ? '—' : value === 0 ? '—' : Number(value).toLocaleString('en-US');
