import {distance} from './zombie-navigation.js';

export function routeLength(start,path){let total=0;for(const p of path){total+=distance(start,p);start=p;}return total;}

// Compare an implausibly long coarse detour with the bounded local planner.
// Never abandon a valid coarse route indefinitely while waiting for fine work.
// time is the encounter's simulation clock, in seconds.
export function chooseZombieRoute(actor,nav,local,goal,obstacles,time){
  const start=actor.p,eligible=distance(start,goal)>1.1&&distance(start,goal)<4&&obstacles.length;
  let comparison=actor.localDetour;
  const fallback=()=>{
    local.cancel(actor.id);actor.localDetour=null;actor.detourRetryAt=time+3;
    return {path:nav.path(start,goal,{obstacles,allowPartial:true}),local:false,waiting:false};
  };
  if(comparison&&(time-comparison.started>=2.5||!eligible||distance(comparison.goal,goal)>.3))return fallback();
  let coarse=[];
  if(!comparison){
    coarse=eligible&&local.pending(actor.id)?[]:nav.path(start,goal,{obstacles,allowPartial:true});
    const length=routeLength(start,coarse);
    // Ordinary short routes keep their current cadence and never pay for a
    // second search. The 66m/3.4m frozen San Juan case crosses this by far.
    if(eligible&&coarse.length&&length>Math.max(6,distance(start,goal)*2.5)&&time>=(actor.detourRetryAt??0)){
      comparison={started:time,goal:{...goal},length};actor.localDetour=comparison;
    }
  }
  if(comparison||(!coarse.length&&eligible)){
    const candidate=local.request(actor.id,start,goal,obstacles);
    if(candidate===null)return {path:[],local:false,waiting:true};
    if(comparison){
      // A safe partial frontier is not necessarily a replacement for a route
      // that truly reaches the target. Require a short, near-target endpoint.
      if(!candidate.length||distance(candidate.at(-1),goal)>=1.35||routeLength(start,candidate)>=comparison.length*.8)return fallback();
      actor.localDetour=null;
    }
    return {path:candidate,local:!!candidate.length,waiting:false};
  }
  local.cancel(actor.id);
  return {path:coarse,local:false,waiting:false};
}
