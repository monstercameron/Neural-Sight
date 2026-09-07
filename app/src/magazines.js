// Slot zero is loaded; the other slots are retained physical magazines.
export function fullestSpare(spares,loaded) {
  let best=-1;
  for(let i=0;i<spares.length;i++)if(spares[i]>loaded && (best<0||spares[i]>spares[best]))best=i;
  return best;
}
export function packingPair(rounds,capacity=30) {
  const partial=rounds.map((count,index)=>({count,index})).filter(m=>m.count>0&&m.count<capacity)
    .sort((a,b)=>b.count-a.count||a.index-b.index);
  if(partial.length<2)return null;
  return {target:partial[0].index,donor:partial.at(-1).index};
}
export function packRound(rounds,capacity=30) {
  const pair=packingPair(rounds,capacity);if(!pair)return false;
  rounds[pair.target]++;rounds[pair.donor]--;return true;
}
export function roundsToPack(rounds,capacity=30) {
  const draft=[...rounds];let steps=0;
  while(packRound(draft,capacity))steps++;
  return steps;
}
export const PACK_ROUND_SECONDS=.4;
