import {Quat} from 'playcanvas';

// Endpoint-preserving shortest-arc interpolation. The installed engine's
// small-angle slerp branch uses a 50/50 average regardless of alpha, which
// moves tiny joints even when a transition requests its exact starting pose.
// Keep this local to callers; do not monkey-patch the engine or its animations.
export function slerpRotation(a,b,alpha,out=new Quat()){
  if(!Number.isFinite(alpha))throw new Error('Cannot interpolate with an invalid blend amount');
  if(alpha<=0)return out.copy(a);
  if(alpha>=1)return out.copy(b);
  const an=Math.hypot(a.x,a.y,a.z,a.w),bn=Math.hypot(b.x,b.y,b.z,b.w);
  if(!Number.isFinite(an)||!Number.isFinite(bn)||an<1e-12||bn<1e-12)throw new Error('Cannot interpolate invalid rotations');
  const ax=a.x/an,ay=a.y/an,az=a.z/an,aw=a.w/an;
  let bx=b.x/bn,by=b.y/bn,bz=b.z/bn,bw=b.w/bn;
  let dot=ax*bx+ay*by+az*bz+aw*bw;
  if(dot<0){dot=-dot;bx=-bx;by=-by;bz=-bz;bw=-bw;}
  dot=Math.min(1,Math.max(0,dot));let left=1-alpha,right=alpha;
  if(dot<.9999995){const angle=Math.acos(dot),denominator=Math.sin(angle);left=Math.sin((1-alpha)*angle)/denominator;right=Math.sin(alpha*angle)/denominator;}
  return out.set(ax*left+bx*right,ay*left+by*right,az*left+bz*right,aw*left+bw*right).normalize();
}
