import * as pc from 'playcanvas';
import {groundNear,walkableEdge} from './zombie-navigation.js';
import {rayCapsule} from './zombie-physics.js';

const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
export const strikeWeight=time=>smooth((time-.25)/.39)*(1-smooth((time-.78)/.5));

export function advanceMelee(actor,player,dt,voxel,bounds,actors){
  // Commitment ends tracking: moving aside after windup is a real dodge.
  if(actor.time<.25||!actor.attackTarget){
    actor.attackTarget={x:player.x,y:player.y-.35,z:player.z};
  }
  const desired=.45*smooth((actor.time-.25)/.35),previous=actor.attackLunge??0;
  actor.attackLunge=desired;
  const step=Math.max(0,desired-previous);if(!step)return;
  const yaw=actor.yaw*Math.PI/180,p=groundNear(voxel,actor.p.x+Math.sin(yaw)*step,actor.p.y,actor.p.z+Math.cos(yaw)*step,bounds);
  if(!p)return;
  if(Math.hypot(p.x-player.x,p.z-player.z)<.53)return;
  if(actors.filter(b=>b!==actor&&!b.ragdoll).some(b=>Math.abs(b.p.y-p.y)<1.2&&Math.hypot(p.x-b.p.x,p.z-b.p.z)<.53))return;
  if(walkableEdge(voxel,actor.p,p,bounds))actor.p=p;
}

// Rotate two existing bone segments; never translate/scale them to fake reach.
export function poseMelee(actor){
  const weight=strikeWeight(actor.time),torsoWeight=smooth(actor.time/.18);
  if(!torsoWeight)return;
  // Support the chest for the ENTIRE attack, not just the contact window. The
  // source fury clip folds its torso almost horizontal during early windup and
  // arches backward on recovery. Retain its lower-body support and spine shape,
  // but aim Spine1→Neck toward a modest 8° ready / 16° committed forward lean.
  // The existing captured-pose handoff releases this support into locomotion.
  const torso=actor.bones.get('Spine1'),neck=actor.bones.get('Neck'),yaw=actor.yaw*Math.PI/180;
  const chestAxis=neck.getPosition().clone().sub(torso.getPosition()).normalize();
  const angle=(8+8*weight)*Math.PI/180;
  const forwardLean=new pc.Vec3(Math.sin(yaw)*Math.sin(angle),Math.cos(angle),Math.cos(yaw)*Math.sin(angle));
  const lean=new pc.Quat().slerp(pc.Quat.IDENTITY,new pc.Quat().setFromDirections(chestAxis,forwardLean),torsoWeight);
  torso.setRotation(lean.mul(torso.getRotation().clone()));
  if(!weight||!actor.attackTarget)return;
  const shoulder=actor.bones.get('R UpperArm'),elbow=actor.bones.get('R Forearm'),hand=actor.bones.get('R Hand');
  const s=shoulder.getPosition().clone(),e=elbow.getPosition().clone(),h=hand.getPosition().clone();
  const l1=e.clone().sub(s).length(),l2=h.clone().sub(e).length();
  if(l1<1e-5||l2<1e-5)return;
  const target=new pc.Vec3(actor.attackTarget.x,actor.attackTarget.y,actor.attackTarget.z);
  const axis=target.clone().sub(s),distance=Math.max(Math.abs(l1-l2)+.001,Math.min(l1+l2-.005,axis.length()));axis.normalize();
  const along=(l1*l1-l2*l2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const pole=new pc.Vec3(-Math.cos(yaw),-.45,Math.sin(yaw));
  pole.sub(axis.clone().mulScalar(pole.dot(axis)));if(pole.lengthSq()<1e-6)pole.set(0,1,0).sub(axis.clone().mulScalar(axis.y));pole.normalize();
  const nextElbow=s.clone().add(axis.clone().mulScalar(along)).add(pole.mulScalar(height));
  const nextHand=s.clone().add(axis.mulScalar(distance));
  const turn=new pc.Quat().setFromDirections(e.clone().sub(s).normalize(),nextElbow.clone().sub(s).normalize());
  shoulder.setRotation(new pc.Quat().slerp(pc.Quat.IDENTITY,turn,weight).mul(shoulder.getRotation().clone()));
  const currentElbow=elbow.getPosition().clone(),currentHand=hand.getPosition().clone();
  const bend=new pc.Quat().setFromDirections(currentHand.sub(currentElbow).normalize(),nextHand.sub(currentElbow).normalize());
  elbow.setRotation(new pc.Quat().slerp(pc.Quat.IDENTITY,bend,weight).mul(elbow.getRotation().clone()));
}

export function meleeContact(actor,player,eyeHeight,voxel){
  const a={x:player.x,y:player.y-eyeHeight+.2,z:player.z},b={x:player.x,y:player.y-.1,z:player.z};
  const capsules=[...actor.colliders];
  // Projectile arm capsules stop at the wrist. Melee also needs the actual
  // palm/finger reach, not an inflated forearm radius or an invisible extension.
  for(const side of ['L','R']){
    const hand=actor.bones.get(side+' Hand'),tip=hand?.findByName('Bip01 '+side+' Finger2Nub');
    if(tip)capsules.push({a:hand.getPosition(),b:tip.getPosition(),r:.055,part:'arm'});
  }
  for(const c of capsules){
    if(c.part!=='arm')continue;
    const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,dz=c.b.z-c.a.z,len=Math.hypot(dx,dy,dz);if(len<1e-6)continue;
    const d={x:dx/len,y:dy/len,z:dz/len};
    // Minkowski expansion tests the rendered arm capsule against the physical
    // 20 cm player capsule, including an arm endpoint already inside it.
    const py=Math.max(a.y,Math.min(b.y,c.a.y));
    const inside=Math.hypot(c.a.x-a.x,c.a.y-py,c.a.z-a.z)<=.2+c.r;
    const hit=inside||rayCapsule(c.a,d,a,b,.2+c.r,len);
    if(!hit)continue;
    const q=inside?c.a:hit.point,tx=player.x-q.x,ty=Math.max(a.y,Math.min(b.y,q.y))-q.y,tz=player.z-q.z,range=Math.hypot(tx,ty,tz);
    if(range<.01||!voxel.queryRay(q.x,q.y,q.z,tx/range,ty/range,tz/range,range))return true;
  }
  return false;
}
