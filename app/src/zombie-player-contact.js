const clamp=x=>Math.max(0,Math.min(1,x));

// Closest bone point to the player's vertical capsule. Include each piece of
// the clamped vertical-distance function, not a handful of sampled bone points.
export function bodyPush(player,eyeHeight,capsule,fallback={x:1,z:0}){
  const low=player.y-eyeHeight+.2,high=player.y-.1,a=capsule.a,b=capsule.b;
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,h2=dx*dx+dz*dz,len2=h2+dy*dy;
  const candidates=[0,1];
  if(h2>1e-12)candidates.push(clamp(((player.x-a.x)*dx+(player.z-a.z)*dz)/h2));
  if(len2>1e-12)for(const y of [low,high])candidates.push(clamp(((player.x-a.x)*dx+(y-a.y)*dy+(player.z-a.z)*dz)/len2));
  if(Math.abs(dy)>1e-12)for(const y of [low,high])candidates.push(clamp((y-a.y)/dy));
  let best=null;
  for(const t of candidates){
    const x=a.x+dx*t,y=a.y+dy*t,z=a.z+dz*t,vertical=y-Math.max(low,Math.min(high,y)),px=player.x-x,pz=player.z-z,d2=px*px+pz*pz+vertical*vertical;
    if(!best||d2<best.d2)best={px,pz,vertical,d2};
  }
  const radius=.2+capsule.r;if(best.d2>=radius*radius)return null;
  const horizontal=Math.hypot(best.px,best.pz),amount=Math.sqrt(Math.max(0,radius*radius-best.vertical*best.vertical))-horizontal+.001;
  const length=Math.hypot(fallback.x,fallback.z)||1;
  return {x:(horizontal>1e-6?best.px/horizontal:fallback.x/length)*amount,z:(horizontal>1e-6?best.pz/horizontal:fallback.z/length)*amount};
}

function clearPlayer(voxel,player,eyeHeight,bounds){
  const r=.2,feet=player.y-eyeHeight;
  if(bounds&&(player.x-r<bounds.min[0]||player.x+r>bounds.max[0]||player.z-r<bounds.min[2]||player.z+r>bounds.max[2]||player.y+.1>bounds.max[1]))return false;
  const bottom=feet+r+.01,top=player.y-.1,push={x:0,y:0,z:0};
  const steps=Math.max(1,Math.ceil((top-bottom)/.1));
  for(let i=0;i<=steps;i++)if(voxel.querySphere(player.x,bottom+(top-bottom)*i/steps,player.z,r,push))return false;
  return true;
}

export function resolveBodyContacts(player,eyeHeight,actors,voxel,bounds){
  // Defeated ragdolls are intentionally non-blocking to player movement.
  // Their bone capsules remain available to shots, and world physics is
  // unchanged. Only an actively reviving body needs this player correction;
  // standing living actors have their separate encounter capsule resolution.
  // No vertical impulse or body teleport. Limit correction and sweep it against
  // the world, retaining crouch height; even a pile cannot launch the camera.
  // The game admits up to 50 ms of movement: a 5 m/s sprint can enter by
  // 25 cm in one update. A smaller fixed correction budget causes tunnelling
  // at 30 Hz. Cover that full step plus contact slop without unbounded shoves.
  let budget=.35;
  for(let pass=0;pass<3&&budget>1e-6;pass++)for(const actor of actors){
    if(actor.ragdoll||actor.mode!=='revive')continue;
    for(const capsule of actor.colliders){
      const fallback={x:player.x-actor.p.x,z:player.z-actor.p.z};if(Math.hypot(fallback.x,fallback.z)<1e-6)fallback.x=1;
      const push=bodyPush(player,eyeHeight,capsule,fallback);if(!push)continue;
      const length=Math.hypot(push.x,push.z),travel=Math.min(length,budget),steps=Math.ceil(travel/.02);
      for(let i=0;i<steps;i++){
        const step=travel/steps,next={x:player.x+push.x/length*step,y:player.y,z:player.z+push.z/length*step};
        if(!clearPlayer(voxel,next,eyeHeight,bounds))break;
        player.x=next.x;player.z=next.z;budget-=step;
      }
      if(budget<=1e-6)return;
    }
  }
}
