const clamp = (x, limit) => Math.max(-limit, Math.min(limit, x));
// Ease toward framing limits instead of clipping sustained hip-fire arcs into flat stops.
const softLimit = (x, limit) => limit * Math.tanh(x / limit);
// Reproducible shot noise, not frame-rate-dependent camera jitter.
function noise(shot, salt) {
  let n = Math.imul(shot ^ salt, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
}
function spring(axis, dt, frequency, damping) {
  const decay = Math.exp(-damping * frequency * dt);
  const omega = frequency * Math.sqrt(1 - damping * damping);
  const c = Math.cos(omega * dt), s = Math.sin(omega * dt);
  const x = axis.x, v = axis.v, f = damping * frequency;
  axis.x = decay * (x * c + (v + f * x) / omega * s);
  axis.v = decay * (v * c - (f * v + frequency * frequency * x) / omega * s);
}
const motionAxes=['kickX','kickY','twist','driftX','driftY'];
function advanceMotion(axes,dt,speed,hip) {
  spring(axes.kickX,dt,18*speed,hip?.78:.86);
  spring(axes.kickY,dt,38*speed,hip?.6:.68);
  spring(axes.twist,dt,16*speed,hip?.82:.90);
  spring(axes.driftX,dt,8*speed,.95);
  spring(axes.driftY,dt,10*speed,.95);
}
function motionPose(axes,hip) {
  return {x:softLimit(axes.kickX.x+axes.driftX.x,hip?.024:.012),
    y:clamp(axes.kickY.x+axes.driftY.x,hip?.03:.023),
    roll:softLimit(axes.twist.x,hip?.012:.008)};
}
export class GunRecoil {
  constructor() { this.reset(); }
  reset(shots = 0) {
    this.shots = shots;
    this.heat = 0;
    this.bias = 0;
    this.hipProfile = false;
    this.kickX = {x:0,v:0}; this.kickY = {x:0,v:0};
    this.driftX = {x:0,v:0}; this.driftY = {x:0,v:0};
    this.twist = {x:0,v:0};
    this.output = {x:0,y:0,roll:0};
    this.shotPose={...this.output};
  }
  update({shots,dt,ads=false,hipFire=false,hipChaos=2.2,enabled=true,strength=1,variation=1,recovery=1}) {
    if (!enabled || shots < this.shots) {
      this.reset(shots);
      return this.output;
    }
    dt = Math.max(0,Math.min(.05,dt));
    if (!dt) return this.output;
    // Aim uses the existing recoil carried into this shot, advanced to this
    // frame. A bullet cannot be redirected by the impulse it creates itself.
    // Copy only on shot events; rendering keeps the same punch/erratic springs.
    const before=shots>this.shots?Object.fromEntries(motionAxes.map(key=>[key,{...this[key]}])):null;
    this.heat *= Math.exp(-dt * 2.2);
    // Single, burst and auto share shot physics. Cadence creates their differences.
    for (let shot=this.shots+1; shot<=shots; shot++) {
      this.hipProfile = hipFire;
      this.heat = Math.min(1, this.heat + .22);
      const chaos = hipFire ? Math.max(1,Math.min(3,hipChaos)) : 1;
      const side = noise(shot, 0x1987) * Math.max(0,Math.min(2,variation)) * chaos;
      // Carry a little more direction between shots, without making the pattern periodic.
      const memory = hipFire ? .40 : .62;
      this.bias = this.bias * memory + side * (1-memory);
      const weight = (hipFire ? 1.15 : ads ? .8 : 1) * (1 + this.heat * (hipFire?.3:.15)) * Math.max(0,Math.min(2,strength));
      // Lower lateral impulses balance the slower springs: heavier arcs, not larger swings.
      this.kickX.v += (side * .30 + this.bias * .12) * weight * .64;
      this.kickY.v -= (.82 + noise(shot, 0x4321) * .13 * chaos) * weight;
      this.twist.v += (side * .24 + noise(shot, 0x7253) * .16 * variation * chaos) * weight * .64;
      this.driftX.v += this.bias * .052 * weight;
      this.driftY.v -= .05 * weight;
    }
    this.shots = shots;
    const speed=Math.max(.5,Math.min(2,recovery))*(this.hipProfile?.88:1);
    // Smooth the erratic horizontal/roll envelope independently of the sharp firing kick.
    advanceMotion(this,dt,speed,this.hipProfile);
    // Small bounded roll stays within the existing bottom framing reserve.
    this.output = motionPose(this,this.hipProfile);
    if(before)advanceMotion(before,dt,speed,this.hipProfile);
    this.shotPose=before?motionPose(before,this.hipProfile):this.output;
    return this.output;
  }
}
