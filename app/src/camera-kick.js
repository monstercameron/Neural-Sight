const bounded=(v,lo,hi,fallback)=>Number.isFinite(Number(v))?Math.max(lo,Math.min(hi,Number(v))):fallback;

// Analytic underdamped spring: fast upward impulse, one small rebound, then
// rest. Rotation only: never displace the collision capsule through a wall.
function step(axis,dt,speed) {
  const frequency=85*speed,damping=.5,omega=frequency*Math.sqrt(1-damping*damping);
  const decay=Math.exp(-damping*frequency*dt),c=Math.cos(omega*dt),s=Math.sin(omega*dt);
  const x=axis.x,v=axis.v,f=damping*frequency;
  axis.x=decay*(x*c+(v+f*x)/omega*s);
  axis.v=decay*(v*c-(f*v+frequency*frequency*x)/omega*s);
  if(Math.abs(axis.x)<1e-5 && Math.abs(axis.v)<1e-4)axis.x=axis.v=0;
}

export class CameraKick {
  constructor(){this.reset();}
  reset(shots=0){
    this.shots=shots;
    this.pitch={x:0,v:0};this.yaw={x:0,v:0};this.roll={x:0,v:0};
    this.output={pitch:0,yaw:0,roll:0};
  }
  update({shots,dt,ads=false,enabled=true,suppressed=false,strength=1,recovery=1}) {
    const amount=bounded(strength,0,2,1);
    if(!enabled || amount===0 || shots<this.shots){this.reset(shots);return this.output;}
    const elapsed=bounded(dt,0,.05,0);
    if(!elapsed)return this.output;
    const speed=bounded(recovery,.5,2,1);
    const fresh=!suppressed&&shots>this.shots;
    for(let id=this.shots+1;!suppressed&&id<=shots;id++) {
      const weight=amount*(ads?.72:1),side=Math.sin(id*2.399963);
      // Scale velocity with recovery so snappier settings retain peak strength.
      this.pitch.v+=95*weight*speed;
      this.yaw.v+=12*side*weight*speed;
      this.roll.v+=16*side*weight*speed;
    }
    this.shots=shots;
    // A slow frame may skip the entire positive attack. Present an early
    // sample once for a fresh visible shot, while advancing the stored spring
    // by the full elapsed time so recovery does not run in slow motion.
    const presented=fresh&&elapsed>1/60?
      [this.pitch,this.yaw,this.roll].map(axis=>{const sample={...axis};step(sample,1/60,speed);return sample;}):null;
    for(const axis of [this.pitch,this.yaw,this.roll])step(axis,elapsed,speed);
    const [pitch,yaw,roll]=presented??[this.pitch,this.yaw,this.roll];
    this.output={pitch:bounded(pitch.x,-1.5,1.5,0),
      yaw:bounded(yaw.x,-.3,.3,0),roll:bounded(roll.x,-.35,.35,0)};
    return this.output;
  }
}
