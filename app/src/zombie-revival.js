import * as pc from 'playcanvas';
import {slerpRotation} from './rotation-interpolation.js';
const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
export const REVIVAL_ALIGN=.55;
export const REVIVAL_DURATION=3.4;

export function chooseRevivalHeading(actor){
  const alignment=actor.revivalAlignment;if(!alignment||alignment.headingChosen)return;
  const pelvis=actor.bones.get('Pelvis'),neck=actor.bones.get('Neck');
  const from=alignment.world.get(neck).p.clone().sub(alignment.world.get(pelvis).p),to=neck.getPosition().clone().sub(pelvis.getPosition());
  if(Math.hypot(from.x,from.z)>.1&&Math.hypot(to.x,to.z)>.1){
    let delta=Math.atan2(from.x,from.z)-Math.atan2(to.x,to.z);delta=Math.atan2(Math.sin(delta),Math.cos(delta));
    actor.yaw+=delta*180/Math.PI;actor.root.setEulerAngles(0,actor.yaw,0);
  }
  // Adapt the animation to the fallen body rather than sweeping the corpse
  // around to its old standing heading. Normal AI steering turns after rising.
  alignment.headingChosen=true;
}

// Local quaternion blending can sweep an entire leg through the floor when a
// settled corpse faces away from the clip entry. Align in world space, project
// the intermediate joints through the existing articulated collision solver,
// then reconstruct bone rotations. Unload the projection continuously as the
// fixed, supported entry pose is reached; do not hoist the whole corpse to
// compensate for an interpolated limb passing through the ground.
export function alignRevivalPose(actor,weight,voxel,bounds,names,links){
  const alignment=actor.revivalAlignment;if(!alignment)return;
  const rig=alignment.physics,pelvis=actor.bones.get('Pelvis'),neck=actor.bones.get('Neck');
  const fromPelvis=alignment.world.get(pelvis).p,toPelvis=pelvis.getPosition().clone();
  const fromAxis=alignment.world.get(neck).p.clone().sub(fromPelvis),toAxis=neck.getPosition().clone().sub(toPelvis);
  let yaw=Math.atan2(toAxis.x,toAxis.z)-Math.atan2(fromAxis.x,fromAxis.z);yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));
  const unturn=new pc.Quat().setFromAxisAngle(pc.Vec3.UP,-yaw*180/Math.PI),turn=new pc.Quat().setFromAxisAngle(pc.Vec3.UP,yaw*weight*180/Math.PI),pivot=new pc.Vec3().lerp(fromPelvis,toPelvis,weight);
  // Turn the reclined body around its pelvis before changing its shape. A
  // straight world-position interpolation between opposite headings collapses
  // the torso, forcing the constraint solver to expand it upward off the floor.
  const desired=names.map(name=>{
    const bone=actor.bones.get(name),from=alignment.world.get(bone),localTarget=unturn.transformVector(bone.getPosition().clone().sub(toPelvis));
    const relative=new pc.Vec3().lerp(from.p.clone().sub(fromPelvis),localTarget,weight);
    return {p:turn.transformVector(relative).add(pivot),q:turn.clone().mul(slerpRotation(from.q,unturn.clone().mul(bone.getRotation().clone()),weight))};
  });
  for(const old of actor.revive??[])if(old.node.name.startsWith('Bip01 ')&&!names.includes(old.node.name.slice(6))){
    old.node.setLocalRotation(slerpRotation(old.q,old.node.getLocalRotation().clone(),weight));
  }
  for(let i=0;i<names.length;i++)actor.bones.get(names[i]).setRotation(desired[i].q);
  pelvis.setPosition(pivot);
  const actual=names.map(name=>actor.bones.get(name).getPosition().clone());
  for(let i=0;i<rig.points.length;i++){
    const p=desired[i].p;rig.points[i].p={x:p.x,y:p.y,z:p.z};rig.points[i].prev={...rig.points[i].p};
  }
  rig.step(1/120,voxel,bounds);
  const projection=1-smooth((weight-.8)/.2),solved=rig.points.map((p,i)=>new pc.Vec3().lerp(desired[i].p,new pc.Vec3(p.p.x,p.p.y,p.p.z),projection));
  function torsoFrame(points){
    const y=points[names.indexOf('Neck')].clone().sub(points[0]).normalize();
    const x=points[names.indexOf('R UpperArm')].clone().sub(points[names.indexOf('L UpperArm')]);x.sub(y.clone().mulScalar(x.dot(y))).normalize();
    const z=new pc.Vec3().cross(x,y).normalize(),m=new pc.Mat4();m.set([x.x,x.y,x.z,0,y.x,y.y,y.z,0,z.x,z.y,z.z,0,0,0,0,1]);return new pc.Quat().setFromMat4(m);
  }
  pelvis.setPosition(solved[0]);
  // Fit the actual reconstructed skeleton, not the interpolated particle
  // positions: those two frames differ when the old and new torso bend.
  // Rotate the entire torso hierarchy once, retaining every local joint angle.
  const frameDelta=torsoFrame(solved).mul(torsoFrame(actual).invert());
  pelvis.setRotation(frameDelta.mul(pelvis.getRotation().clone()));
  for(let i=0;i<names.length;i++){
    const bone=actor.bones.get(names[i]),child=links.find(([from])=>from===names[i])?.[1];
    const torso=names[i]==='Pelvis'||names[i].startsWith('Spine')||names[i]==='Neck';
    if(child&&!torso){const origin=bone.getPosition(),from=actor.bones.get(child).getPosition().clone().sub(origin),to=solved[names.indexOf(child)].clone().sub(origin);if(from.lengthSq()>1e-10&&to.lengthSq()>1e-10)bone.setRotation(new pc.Quat().setFromDirections(from.normalize(),to.normalize()).mul(bone.getRotation().clone()));}
    // Only the pelvis translates. All other bones retain authored local
    // offsets, so fading the projection cannot shorten calves or upper arms.
  }
}

// Hold a fixed reclined pose while aligning the corpse, then give the source
// clip's very fast .70–1.05 s rise enough real time for a support transfer.
// Monotone cubic segments share endpoint velocities (no clock jumps/rewinds).
export function revivalClipTime(time,duration){
  const knots=[[REVIVAL_ALIGN,0,0],[.9,.7,.85],[1.55,1.05,.82],[REVIVAL_DURATION,duration,1.7]];
  if(time<=REVIVAL_ALIGN)return 0;
  if(time>=REVIVAL_DURATION)return duration;
  const i=knots.findIndex((k,i)=>i<knots.length-1&&time<knots[i+1][0]),a=knots[i],b=knots[i+1],h=b[0]-a[0],t=(time-a[0])/h;
  return (2*t*t*t-3*t*t+1)*a[1]+(t*t*t-2*t*t+t)*h*a[2]+(-2*t*t*t+3*t*t)*b[1]+(t*t*t-t*t)*h*b[2];
}

export function braceRevivalHand(actor,voxel){
  actor.revivalHandWeight=0;
  const phase=smooth((actor.time-.62)/.18)*(1-smooth((actor.time-1.3)/.25));
  if(!phase)return;
  const yaw=actor.yaw*Math.PI/180,forward=new pc.Vec3(Math.sin(yaw),0,Math.cos(yaw));
  if(!actor.revivalHand){
    const choices=[];
    for(const side of ['L','R']){
      const shoulder=actor.bones.get(side+' UpperArm'),elbow=actor.bones.get(side+' Forearm'),hand=actor.bones.get(side+' Hand');
      const s=shoulder.getPosition(),e=elbow.getPosition(),h=hand.getPosition(),sign=side==='L'?1:-1;
      const x=s.x+Math.cos(yaw)*.12*sign+forward.x*.08,z=s.z-Math.sin(yaw)*.12*sign+forward.z*.08;
      const ground=voxel.queryRay(x,actor.p.y+.65,z,0,-1,0,1.2);if(!ground)continue;
      const goal=new pc.Vec3(x,ground.y+.055,z),reach=s.clone().sub(e).length()+e.clone().sub(h).length(),distance=goal.clone().sub(s).length();
      if(distance<reach-.015)choices.push({side,goal,reach,distance});
    }
    choices.sort((a,b)=>a.distance-b.distance);actor.revivalHand=choices[0]??null;
  }
  const plant=actor.revivalHand;if(!plant)return;
  const side=plant.side,shoulder=actor.bones.get(side+' UpperArm'),elbow=actor.bones.get(side+' Forearm'),hand=actor.bones.get(side+' Hand');
  const s=shoulder.getPosition().clone(),e=elbow.getPosition().clone(),h=hand.getPosition().clone();
  const l1=e.clone().sub(s).length(),l2=h.clone().sub(e).length(),axis=plant.goal.clone().sub(s),range=axis.length();
  // Release as the shoulder rises beyond reach. No hand teleport, limb scaling
  // or impossible floor anchor after weight has moved onto the standing foot.
  const weight=phase*(1-smooth((range-(l1+l2-.05))/.14));
  if(weight<=0){actor.revivalHandWeight=0;return;}
  axis.normalize();const distance=Math.max(Math.abs(l1-l2)+.001,Math.min(l1+l2-.003,range));
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const sign=side==='L'?1:-1,pole=new pc.Vec3(Math.cos(yaw)*sign,.25,-Math.sin(yaw)*sign);
  pole.sub(axis.clone().mulScalar(pole.dot(axis)));if(pole.lengthSq()<1e-8)return;pole.normalize();
  const desiredElbow=s.clone().add(axis.clone().mulScalar(along)).add(pole.mulScalar(height)),desiredHand=s.clone().add(axis.mulScalar(distance));
  const turn=new pc.Quat().setFromDirections(e.clone().sub(s).normalize(),desiredElbow.sub(s).normalize());
  shoulder.setRotation(slerpRotation(pc.Quat.IDENTITY,turn,weight).mul(shoulder.getRotation().clone()));
  const actualElbow=elbow.getPosition().clone(),actualHand=hand.getPosition().clone();
  const bend=new pc.Quat().setFromDirections(actualHand.sub(actualElbow).normalize(),desiredHand.sub(actualElbow).normalize());
  elbow.setRotation(slerpRotation(pc.Quat.IDENTITY,bend,weight).mul(elbow.getRotation().clone()));
  const finger=hand.findByName('Bip01 '+side+' Finger2Nub');
  if(finger){const from=finger.getPosition().clone().sub(hand.getPosition()).normalize(),flat=new pc.Vec3(from.x,0,from.z);if(flat.lengthSq()>1e-8)hand.setRotation(slerpRotation(pc.Quat.IDENTITY,new pc.Quat().setFromDirections(from,flat.normalize()),weight).mul(hand.getRotation().clone()));}
  actor.revivalHandWeight=weight;
}
