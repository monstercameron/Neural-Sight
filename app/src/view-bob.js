// Deterministic per-stride amplitude variation, not new random jitter each frame.
function swingNoise(index){
  let n=Math.imul(index+73,0x45d9f3b);n=Math.imul(n^(n>>>16),0x45d9f3b);
  return ((n^(n>>>16))>>>0)/0xffffffff;
}
export function swingVariation(index,progress){
  const t=Math.max(0,Math.min(1,progress)),ease=t*t*(3-2*t);
  return .72+.70*(swingNoise(index)*(1-ease)+swingNoise(index+1)*ease);
}
// Radians for the screen-space weapon, independently salted from lateral sway.
// Smooth interpolation keeps each footfall from introducing a rotation snap.
export function swingAngle(index,progress,phase,turn=0){
  const t=Math.max(0,Math.min(1,progress)),ease=t*t*(3-2*t);
  const noise=salt=>swingNoise(index+salt)*(1-ease)+swingNoise(index+salt+1)*ease;
  const degrees=Math.sin(phase)*(2+1.5*noise(211))+(noise(491)-.5)*1.2+turn*.4;
  return Math.max(-4,Math.min(4,degrees))*Math.PI/180;
}
// Foot plant at each integer stride: slower rise, quicker weighted landing.
// Both segments have zero velocity at their shared apex and at ground contact.
export function runningStepHeight(phase){
  const p=((phase/Math.PI)%1+1)%1;
  return p<.62?-Math.cos(Math.PI*p/.62):Math.cos(Math.PI*(p-.62)/.38);
}
// Visual offsets only: never feed these back into the player/collision position.
export class ViewBob {
  constructor() { this.reset(); }
  reset() {
    this.phase = 0;
    this.gain=0;this.heightAmplitude=.018;this.pitchAmplitude=.1;this.runProfile=0;
    this.swingTravel=0;this.turnWeight=0;this.turnLag=0;
    this.value = {height:0, lateral:0, pitch:0, roll:0, weaponX:0, weaponY:0, weaponRoll:0};
  }
  update({dt, distance=0, moving=false, grounded=false, running=false, ads=false, enabled=true, strength=1,authoredRun=false,stride=null,turnRate=0,runCarryWeight=running?1:0}) {
    if (!enabled) { this.reset(); return this.value; }
    dt = Math.max(0, Math.min(.05, dt));
    if (!dt) return this.value;
    const speed = Math.max(0, distance) / dt;
    const active = moving && grounded && speed > .08;
    if(active)this.swingTravel+=Math.min(distance,dt*6)/(running?1.4:.85);
    if(stride)this.phase=stride.phase;
    else if (active) {
      // Same nominal foot spacing as the audio director: two steps per sway cycle.
      this.phase = (this.phase + Math.min(distance,dt*6)*Math.PI/(running?1.4:.85)) % (Math.PI*2);
    }
    const gain = active ? Math.min(1,speed/(running?5:2))*Math.max(0,Math.min(1.5,Number(strength)||0))*(ads?.25:1) : 0;
    const sway = Math.sin(this.phase), step = Math.cos(this.phase*2);
    const swingIndex=stride?.swingIndex??Math.floor(this.swingTravel);
    const swingProgress=stride?.swingProgress??(this.swingTravel%1);
    const variation=swingVariation(swingIndex,swingProgress);
    const turn=Math.max(-1,Math.min(1,(Number(turnRate)||0)/150));
    const turnEase=1-Math.exp(-dt*7);
    this.turnWeight+=((running&&!ads?Math.abs(turn):0)-this.turnWeight)*turnEase;
    this.turnLag+=((running&&!ads?turn*.009:0)-this.turnLag)*turnEase;
    const runSwing=.064*variation*(1+.6*this.turnWeight);
    const carry=Math.max(0,Math.min(1,runCarryWeight));
    const ease = 1-Math.exp(-dt*12);
    this.runProfile+=((running?1:0)-this.runProfile)*ease;
    const vertical=-step*(1-this.runProfile)+runningStepHeight(this.phase)*this.runProfile;
    const target = {
      height: vertical*(running?.045:.018)*gain,
      lateral: sway*(running?.013:.006)*gain,
      pitch: -vertical*(running?.32:.10)*gain,
      roll: sway*(running?.28:.075)*gain,
      // Low carry swings across the body, not vertically like a piston. The old
      // independently generated run loop is bypassed, so there is no doubled bob.
      weaponX: ((authoredRun?0:.105*Math.tanh((sway*runSwing+this.turnLag)/.105))*carry+sway*.0035*(1-carry))*gain,
      weaponY: step*(running?0:.005)*gain,
      weaponRoll: !ads&&!authoredRun
        ? Math.max(-4*Math.PI/180,Math.min(4*Math.PI/180,swingAngle(swingIndex,swingProgress,this.phase,this.turnLag/.009)*gain*carry)) : 0,
    };
    for (const key of Object.keys(target)) this.value[key] += (target[key]-this.value[key])*ease;
    if(stride){
      // Ease amplitudes, not the contact phase: low-pass filtering the phase made
      // the head dip trail the sound. Foot plants now coincide with the dip.
      this.gain+=(gain-this.gain)*ease;
      this.heightAmplitude+=((running?.045:.018)-this.heightAmplitude)*ease;
      this.pitchAmplitude+=((running?.32:.10)-this.pitchAmplitude)*ease;
      this.value.height=vertical*this.heightAmplitude*this.gain;
      this.value.pitch=-vertical*this.pitchAmplitude*this.gain;
    }
    return this.value;
  }
}
