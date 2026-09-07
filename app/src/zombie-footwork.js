import * as pc from 'playcanvas';
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};

function footGround(voxel,x,y,z,bounds){
  // A shoe needs local support/clearance, not the entire standing NPC capsule
  // used by navigation (which incorrectly rejected planted feet beside walls).
  const hit=voxel.queryRay(x,y+.42,z,0,-1,0,.95);
  if(!hit||Math.abs(hit.y-y)>.43)return null;
  if(bounds&&(x-.06<bounds.min[0]||x+.06>bounds.max[0]||z-.06<bounds.min[2]||z+.06>bounds.max[2]))return null;
  if(voxel.querySphere(x,hit.y+.1,z,.06,{x:0,y:0,z:0}))return null;
  const gx=voxel.queryRay(x+.1,hit.y+.42,z,0,-1,0,.95),gz=voxel.queryRay(x,hit.y+.42,z+.1,0,-1,0,.95);
  const normal=gx&&gz?new pc.Vec3(-(gx.y-hit.y)/.1,1,-(gz.y-hit.y)/.1).normalize():pc.Vec3.UP;
  return {y:hit.y+.025,normal};
}

export function beginMeleeFeet(actor){
  actor.attackFootRoot={...actor.p};
  actor.attackPelvisHeight=actor.bones.get('Pelvis').getPosition().y-actor.p.y;
  actor.attackStepEvents=new Set();
  actor.attackFeet=['L','R'].map(side=>{
    const foot=actor.bones.get(side+' Foot');
    const toe=actor.bones.get(side+' Toe0'),p=foot.getPosition().clone(),direction=toe.getPosition().clone().sub(p);
    const flat=new pc.Vec3(direction.x,0,direction.z).normalize();
    const q=new pc.Quat().setFromDirections(direction.normalize(),flat).mul(foot.getRotation().clone());
    return {side,p,q};
  });
}

export function poseMeleeFeet(actor,voxel,bounds,onPlant=()=>{}){
  if(!actor.attackFeet)return;
  const weight=smooth(actor.time/.12),recovery=smooth((actor.time-1.1)/.3);
  if(!weight)return;
  const authoredFeet=new Map(actor.attackFeet.map(({side})=>[side,actor.bones.get(side+' Foot').getPosition().clone()]));
  // The source fury clip contains a deep squat/roar. Retain a small weight
  // shift, but do not let the attack vanish below the first-person weapon.
  // Soft saturation preserves continuous motion; leg IK below owns support.
  const pelvis=actor.bones.get('Pelvis'),pelvisPosition=pelvis.getPosition().clone(),baseline=actor.p.y+(actor.attackPelvisHeight??pelvisPosition.y-actor.p.y),drop=baseline-pelvisPosition.y;
  if(drop>0)pelvis.setPosition(pelvisPosition.x,pelvisPosition.y+(drop-.14*Math.tanh(drop/.14))*weight,pelvisPosition.z);
  const root=actor.attackFootRoot,dx=actor.p.x-root.x,dz=actor.p.z-root.z;
  const yaw=actor.yaw*Math.PI/180;
  const plans=[];
  for(const planted of actor.attackFeet){
    const lead=planted.side==='R',phase=clamp((actor.time-(lead?.25:.72))/(lead?.35:.38));
    const advance=lead?1:smooth(phase);
    const stepAhead=lead?.42*smooth(phase):0;
    const thigh=actor.bones.get(planted.side+' Thigh'),calf=actor.bones.get(planted.side+' Calf'),foot=actor.bones.get(planted.side+' Foot');
    // Use the clip's original lift, not the whole-skeleton translation applied
    // above. Otherwise recovery mistakes the raised pelvis for a lifted foot.
    const authored=authoredFeet.get(planted.side);
    const plantedX=planted.p.x+dx*advance+Math.sin(yaw)*stepAhead,plantedZ=planted.p.z+dz*advance+Math.cos(yaw)*stepAhead;
    // Release the world-space plant into the authored horizontal recovery,
    // not the terrain support. Turning off the whole solver let shoes sink.
    const x=plantedX+(authored.x-plantedX)*recovery,z=plantedZ+(authored.z-plantedZ)*recovery;
    const ground=footGround(voxel,x,actor.p.y,z,bounds);if(!ground)continue;
    const sole=.075;
    const lift=.09*Math.sin(Math.PI*phase),plantedY=ground.y+sole+lift;
    // This is a grounded strike, not the source roar's small two-foot hop.
    // Only the explicit lead/trailing step phases lift a foot. Recovery may
    // release horizontal targets but must not lift both shoes off support.
    const goal=new pc.Vec3(x,plantedY,z);
    const hip=thigh.getPosition().clone(),knee=calf.getPosition().clone(),ankle=foot.getPosition().clone();
    const l1=knee.clone().sub(hip).length(),l2=ankle.clone().sub(knee).length();
    plans.push({planted,ground,goal,thigh,calf,foot,l1,l2,phase});
  }
  solveLegPlans(actor,plans,weight,yaw,onPlant);
}

// Terrain support is independent of the attack state. Preserve the walk's
// authored lift and horizontal stride, while moving its ground plane under
// each foot onto the actual local surface.
export function poseLocomotionFeet(actor,voxel,bounds){
  const plans=[];
  for(const side of ['L','R']){
    const thigh=actor.bones.get(side+' Thigh'),calf=actor.bones.get(side+' Calf'),foot=actor.bones.get(side+' Foot'),toe=actor.bones.get(side+' Toe0');
    const ankle=foot.getPosition().clone(),ground=footGround(voxel,ankle.x,actor.p.y,ankle.z,bounds);if(!ground)continue;
    const direction=toe.getPosition().clone().sub(ankle).normalize(),flat=new pc.Vec3(direction.x,0,direction.z).normalize();
    let q=new pc.Quat().setFromDirections(direction,flat).mul(foot.getRotation().clone());
    const lift=Math.max(0,ankle.y-actor.p.y-.075),goal=new pc.Vec3(ankle.x,ground.y+.075+lift,ankle.z);
    const handoff=actor.footHandoff,previous=handoff?.feet.find(f=>f.side===side);
    if(previous){
      const blend=smooth((actor.handoffTime??0)/.18),from=previous.p.clone();from.x+=actor.p.x-handoff.root.x;from.y+=actor.p.y-handoff.root.y;from.z+=actor.p.z-handoff.root.z;
      goal.lerp(from,goal.clone(),blend);
      // solveLegPlans applies the terrain normal below; remove it from the
      // captured rotation before blending so the entry pose is not tilted twice.
      const unground=new pc.Quat().setFromDirections(ground.normal,pc.Vec3.UP);
      q=new pc.Quat().slerp(unground.mul(previous.q.clone()),q,blend);
    }
    const hip=thigh.getPosition(),knee=calf.getPosition();
    plans.push({planted:{side,p:ankle,q},ground,goal,thigh,calf,foot,l1:knee.clone().sub(hip).length(),l2:ankle.clone().sub(knee).length(),phase:0,rotationWeight:1-smooth(lift/.15)});
  }
  solveLegPlans(actor,plans,1,actor.yaw*Math.PI/180,()=>{});
  if(actor.footHandoff&&(actor.handoffTime??0)>=.18)actor.footHandoff=null;
}

function solveLegPlans(actor,plans,weight,yaw,onPlant){
  // Uphill lunges raise the root while the trailing foot is still planted.
  // Let the pelvis yield to the stance leg instead of stretching it or lifting
  // its foot off the ground to follow an unreachable IK target.
  let lower=0;
  for(const {goal,thigh,l1,l2} of plans){
    const hip=thigh.getPosition(),horizontal=(hip.x-goal.x)**2+(hip.z-goal.z)**2;
    const reach=l1+l2-.004,vertical=Math.sqrt(Math.max(0,reach*reach-horizontal));
    lower=Math.max(lower,hip.y-goal.y-vertical);
  }
  const pelvis=actor.bones.get('Pelvis'),position=pelvis.getPosition().clone();
  pelvis.setPosition(position.x,position.y-Math.min(.22,lower)*weight,position.z);
  for(const {planted,ground,goal,thigh,calf,foot,l1,l2,phase,rotationWeight=1} of plans){
    const hip=thigh.getPosition().clone(),knee=calf.getPosition().clone();
    const axis=goal.clone().sub(hip),distance=Math.max(Math.abs(l1-l2)+.001,Math.min(l1+l2-.002,axis.length()));axis.normalize();
    const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    const pole=new pc.Vec3(Math.sin(yaw),0,Math.cos(yaw));pole.sub(axis.clone().mulScalar(pole.dot(axis)));
    if(pole.lengthSq()<1e-6)continue;pole.normalize();
    const kneeGoal=hip.clone().add(axis.clone().mulScalar(along)).add(pole.mulScalar(height));
    const ankleGoal=hip.clone().add(axis.mulScalar(distance));
    const q=new pc.Quat().setFromDirections(knee.sub(hip).normalize(),kneeGoal.sub(hip).normalize());
    thigh.setRotation(new pc.Quat().slerp(pc.Quat.IDENTITY,q,weight).mul(thigh.getRotation().clone()));
    const currentKnee=calf.getPosition().clone(),currentAnkle=foot.getPosition().clone();
    const bend=new pc.Quat().setFromDirections(currentAnkle.sub(currentKnee).normalize(),ankleGoal.sub(currentKnee).normalize());
    calf.setRotation(new pc.Quat().slerp(pc.Quat.IDENTITY,bend,weight).mul(calf.getRotation().clone()));
    const groundedRotation=new pc.Quat().setFromDirections(pc.Vec3.UP,ground.normal).mul(planted.q.clone());
    foot.setRotation(new pc.Quat().slerp(foot.getRotation().clone(),groundedRotation,weight*rotationWeight));
    if(phase===1&&weight>.99&&!actor.attackStepEvents.has(planted.side)&&Math.hypot(goal.x-planted.p.x,goal.z-planted.p.z)>.02&&foot.getPosition().clone().sub(goal).length()<.02){
      actor.attackStepEvents.add(planted.side);onPlant(planted.side);
    }
  }
}
