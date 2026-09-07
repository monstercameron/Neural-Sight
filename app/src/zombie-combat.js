export function attackOpportunity(actor,player,eyeHeight,voxel,range=1.3){
  const dx=player.x-actor.p.x,dz=player.z-actor.p.z,dist=Math.hypot(dx,dz),dy=player.y-eyeHeight-actor.p.y;
  if(dist>range||Math.abs(dy)>.6)return {visible:false,facing:false};
  const y=player.y-actor.p.y-1.2,len=Math.hypot(dx,y,dz),rad=actor.yaw*Math.PI/180;
  const visible=len<.01||!voxel.queryRay(actor.p.x,actor.p.y+1.2,actor.p.z,dx/len,y/len,dz/len,Math.max(0,len-.12));
  return {visible,facing:dist<.01||(Math.sin(rad)*dx+Math.cos(rad)*dz)/dist>.65};
}
export function clearOfPlayer(point,player){return !player||Math.abs(point.y-player.y)>1.8||Math.hypot(point.x-player.x,point.z-player.z)>.8;}
