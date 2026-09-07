// Shared nodes and reversible filmed edges. All clips join on canonical images.
export const CARRY_EDGES=[
  {clip:'raising',a:'lowReady',b:'ads',duration:.28},
  {clip:'runFromLow',a:'lowReady',b:'run',duration:.24},
  {clip:'runFromADS',a:'ads',b:'run',duration:.28},
];
export function carryEdge(a,b){return CARRY_EDGES.find(e=>[e.a,e.b].includes(a)&&[e.a,e.b].includes(b));}
export function carryPhase(edge,time){
  const t=Math.max(0,Math.min(1,(time-edge.lead)/Math.max(.001,edge.travel)));
  return edge.from+(edge.to-edge.from)*t;
}
export function carryFrame(edge,time){
  if(edge.lead>0 && time<edge.lead){
    const t=Math.max(0,time/edge.lead),s=t*t*(3-2*t);
    return {clip:'runLateral',phase:edge.loopFrom+(edge.loopTo-edge.loopFrom)*s,direction:Math.sign(edge.loopTo-edge.loopFrom)};
  }
  return {clip:edge.clip,phase:carryPhase(edge,time),direction:Math.sign(edge.to-edge.from)};
}
