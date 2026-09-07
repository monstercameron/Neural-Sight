import {groundNear,walkableEdge} from './zombie-navigation.js';

const clearance=.53;
export function chooseCrowdStep(actor,aim,actors,voxel,bounds,dt){
  const dx=aim.x-actor.p.x,dz=aim.z-actor.p.z,length=Math.hypot(dx,dz);
  const step=Math.min(length,actor.speed*dt*(actor.stagger>0?.25:1));
  if(step<1e-7)return null;
  const ux=dx/length,uz=dz/length;
  const neighbors=actors.filter(b=>b!==actor&&!b.ragdoll&&Math.abs(b.p.y-actor.p.y)<1.2&&Math.hypot(b.p.x-actor.p.x,b.p.z-actor.p.z)<1.6);
  // Terrain needs local avoidance even for a lone actor. A blocked straight
  // step must not leave it retrying the same waypoint forever; clear straight
  // movement still exits before any extra candidate collision query.
  const turns=neighbors.length?[0,25,-25,50,-50,75,-75,90,-90]:[0,25,-25,50,-50,75,-75,90,-90,110,-110,135,-135];
  let best=null,bestScore=-Infinity;
  for(const turn of turns){
    const angle=turn*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),vx=ux*c-uz*s,vz=ux*s+uz*c;
    const x=actor.p.x+vx*step,z=actor.p.z+vz*step;
    let gap=1.6,blocked=false;
    for(const b of neighbors){
      const now=Math.hypot(actor.p.x-b.p.x,actor.p.z-b.p.z),end=Math.hypot(x-b.p.x,z-b.p.z);
      // An existing overlap may separate, but must never deepen.
      if(end<Math.min(clearance,now)-1e-6){blocked=true;break;}
      // Anticipate an obstacle along the next half metre, not just this frame.
      const bx=b.p.x-actor.p.x,bz=b.p.z-actor.p.z,t=Math.max(0,Math.min(.55,bx*vx+bz*vz));
      gap=Math.min(gap,Math.hypot(bx-vx*t,bz-vz*t));
    }
    if(blocked)continue;
    // Permit a small outward step to stay on the same side of a wall. Limiting
    // turns to 90° about a changing goal direction alternates sides in place.
    const progress=ux*vx+uz*vz,sidePenalty=turn&&Math.sign(turn)!==(actor.avoidSide||1)?(neighbors.length?.18:1):0;
    const score=progress+Math.min(1,gap/clearance)*1.8-sidePenalty;
    // Collision queries dominate live-NPC CPU cost. A candidate that cannot
    // beat an already valid move needs no ground/capsule queries at all.
    if(score<=bestScore)continue;
    const next=groundNear(voxel,x,actor.p.y,z,bounds);
    if(!next||!walkableEdge(voxel,actor.p,next,bounds))continue;
    if(turn){
      const ahead=groundNear(voxel,actor.p.x+vx*.35,actor.p.y,actor.p.z+vz*.35,bounds);
      if(!ahead||!walkableEdge(voxel,actor.p,ahead,bounds))continue;
    }
    bestScore=score;best={p:next,distance:step,turn,direction:{x:vx,z:vz}};
    if(score>=2.8)break; // Maximum possible score; later candidates cannot win.
  }
  return best;
}
