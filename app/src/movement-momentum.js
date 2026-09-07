// Resolve camera-relative intent before converting movement into world space.
// Diagonals blend the directional limits without a diagonal speed bonus.
export function sprintDirectionScale(strafe=0,forward=0) {
  const length=Math.hypot(strafe,forward);
  if(!length)return 1;
  return Math.hypot(strafe/length*.75,forward/length*(forward>=0?1:.6));
}
// World-space horizontal velocity: turning the camera cannot rotate momentum.
export class MovementMomentum {
  constructor(){this.reset();}
  reset(){this.x=0;this.z=0;}
  get speed(){return Math.hypot(this.x,this.z);}
  update({x=0,z=0,dt=0,running=false,sprintScale=1,ads=false,crouching=false,grounded=true}) {
    dt=Math.max(0,Math.min(.05,Number(dt)||0));
    if(!dt)return {x:0,z:0};
    const length=Math.hypot(x,z),input=length>0;
    const scale=Number.isFinite(sprintScale)?Math.max(.6,Math.min(1,sprintScale)):1;
    const speed=crouching?1.1:running?5*scale:2;
    const tx=input?x/length*speed:0,tz=input?z/length*speed:0;
    // Keep ballistic horizontal carry while airborne, with reduced steering.
    if(!grounded && !input)return {x:this.x*dt,z:this.z*dt};
    const heavy=running || this.speed>2.2;
    const reversing=input && this.x*tx+this.z*tz<0;
    let acceleration=!input?32:crouching?44:ads?48:heavy?(reversing?28:26):36;
    if(!grounded)acceleration*=.35;
    const dx=tx-this.x,dz=tz-this.z,difference=Math.hypot(dx,dz);
    if(difference<1e-8){this.x=tx;this.z=tz;return {x:tx*dt,z:tz*dt};}
    const time=Math.min(dt,difference/acceleration);
    const ax=dx/difference*acceleration,az=dz/difference*acceleration;
    // Integrate the ramp and any remainder at target speed exactly.
    const motion={x:this.x*time+.5*ax*time*time+tx*(dt-time),
      z:this.z*time+.5*az*time*time+tz*(dt-time)};
    this.x+=ax*time;this.z+=az*time;
    if(time<dt || Math.hypot(tx-this.x,tz-this.z)<1e-8){this.x=tx;this.z=tz;}
    return motion;
  }
  resolveCollision(requested,actual) {
    // Remove blocked velocity, retain tangential wall sliding. Never turn
    // collision depenetration into new acceleration or stored wall pressure.
    for(const axis of ['x','z']) {
      const want=requested[axis];
      if(Math.abs(want)<1e-7)continue;
      const ratio=actual[axis]/want;
      if(ratio<.95)this[axis]*=Math.max(0,Math.min(1,ratio));
    }
  }
}
