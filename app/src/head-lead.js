const rad = Math.PI / 180;
// Preserve the entire largest requested cone, irrespective of aspect/FOV.
// Limit only extreme spring stretch beyond 14°; safety is angular, not pixels.
const softAngle=(value,cone=14)=>{
  const knee=Math.max(14,cone),tail=6,magnitude=Math.abs(value);
  return magnitude<=knee?value:Math.sign(value)*(knee+tail*Math.tanh((magnitude-knee)/tail));
};
export function headCone({freeAngle=3,freeScreen=null,aspect=16/9,fov=75}={}) {
  if(freeScreen===null){const yaw=Math.max(0,Math.min(14,freeAngle));return {yaw,pitch:yaw*.7,screen:null};}
  const screen=Math.max(0,Math.min(.7,freeScreen))*.5;
  const projection=2*Math.tan(fov*rad/2);
  return {yaw:Math.atan(screen*projection*Math.max(.5,aspect))/rad,
    pitch:Math.atan(screen*projection)/rad,screen};
}

// Camera look stays immediate. The carried weapon direction also feeds the
// matched screen-space shot ray; transitions must preserve that registration.
export class HeadLead {
  constructor() { this.reset(); }
  reset(yaw=0, pitch=0) {
    this.yaw=this.targetYaw=yaw;
    this.pitch=this.targetPitch=pitch;
    this.vYaw=0; this.vPitch=0;
    this.offset={x:0,y:0};
    this.offsetVelocity={x:0,y:0};
  }
  update({dt,yaw,pitch,ads=false,enabled=true,freeAngle=3,freeScreen=null,aspect=16/9,fov=75}) {
    if (!enabled) { this.reset(yaw,pitch); return this.offset; }
    dt=Math.max(0,Math.min(.05,dt));
    if (!dt) return this.offset;
    // The 0–8° base slider can reach 14° with the running 1.75× multiplier.
    const cone=headCone({freeAngle,freeScreen,aspect,fov});
    // One projection safety envelope for all screen-mode stances: changing
    // sprint/ADS intent must not reveal a different clamp on a stretched spring.
    const safety=freeScreen===null?{yaw:14,pitch:14}:headCone({freeScreen:.7,aspect,fov});
    const radius=cone.yaw,verticalRadius=cone.pitch;
    const projection=2*Math.tan(fov*rad/2);
    if (ads || radius<=0) {
      // ADS has no free-look cone or queued delay, just a very stiff weight spring.
      this.targetYaw=yaw;
      this.targetPitch=pitch;
    } else {
      const dx=yaw-this.targetYaw, dy=pitch-this.targetPitch;
      // The screen-mode ring is an exact ellipse in viewport coordinates,
      // not a fixed angular cone that changes size on zoom or ultrawide.
      const tx=Math.tan(Math.max(-89,Math.min(89,dx))*rad);
      const ty=Math.tan(Math.max(-89,Math.min(89,dy))*rad);
      const distance=cone.screen===null?Math.hypot(dx/radius,dy/verticalRadius):
        Math.hypot(tx/(projection*Math.max(.5,aspect)*cone.screen),ty/(projection*cone.screen));
      if (distance>1) {
        // Move the held direction only by the amount outside the cone.
        // This target is continuous at the boundary, so follow starts gently.
        this.targetYaw=yaw-(cone.screen===null?dx/distance:Math.atan(tx/distance)/rad);
        this.targetPitch=pitch-(cone.screen===null?dy/distance:Math.atan(ty/distance)/rad);
      }
    }
    const elastic=!ads&&radius>0;
    const frequency=ads?80:elastic?12:18;
    const project=(gunYaw,gunPitch)=>({
      x:-Math.tan(softAngle(gunYaw-yaw,safety.yaw)*rad)/(projection*Math.max(.5,aspect)),
      y:-Math.tan(softAngle(gunPitch-pitch,safety.pitch)*rad)/projection,
    });
    for(const [axis,velocity,target] of [
      ['yaw','vYaw','targetYaw'],['pitch','vPitch','targetPitch']
    ]) {
      const error=this[axis]-this[target];
      if(elastic){
        // Analytic underdamped spring: soft pull, preserved inertia on reversal,
        // and ~1% rebound. No frame-dependent Euler integration or velocity reset.
        const damping=.82,decayRate=frequency*damping;
        const angular=frequency*Math.sqrt(1-damping*damping);
        const decay=Math.exp(-decayRate*dt),cos=Math.cos(angular*dt),sin=Math.sin(angular*dt);
        const velocityNow=this[velocity];
        this[axis]=this[target]+decay*(error*cos+(velocityNow+decayRate*error)*sin/angular);
        this[velocity]=decay*(velocityNow*cos-(decayRate*velocityNow+frequency*frequency*error)*sin/angular);
      }else{
        // ADS retains its original fast critically damped tracking response.
        const c=this[velocity]+frequency*error;
        const decay=Math.exp(-frequency*dt);
        this[axis]=this[target]+(error+c*dt)*decay;
        this[velocity]=(this[velocity]-frequency*c*dt)*decay;
      }
    }
    // Bound projection angles, never the underlying angular spring state.
    const projected=project(this.yaw,this.pitch);
    // Camera-relative compensation is geometry, not weapon motion. Filtering
    // it dragged a world-held gun with the camera, then drifted it back. Apply
    // it immediately; elasticity lives in the angular boundary spring above.
    // Both ADS and carry share this projection, so no hidden screen spring or
    // corrective handoff can be exposed when aim is pressed/released.
    this.offset=projected;
    const epsilon=1e-5,next=project(this.yaw+this.vYaw*epsilon,this.pitch+this.vPitch*epsilon);
    for(const axis of ['x','y'])this.offsetVelocity[axis]=(next[axis]-projected[axis])/epsilon;
    return this.offset;
  }
}
