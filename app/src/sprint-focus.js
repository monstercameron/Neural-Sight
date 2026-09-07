const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,Number(v)||0));
// Lens/depth strength must not silently change the ADS/run focus kernel.
export function peripheralFocusRadius(enabled, lensStrength, radius=6) {
  return enabled && Number(lensStrength)>0 ? clamp(radius,0,12) : 0;
}
export function borderWeight(u,v) {
  const t=clamp((Math.hypot(2*u-1,2*v-1)-.64)/.36,0,1);
  return t*t*(3-2*t);
}
export class SprintFocus {
  constructor() { this.amount=0; }
  update({running=false,moving=false,ads=false,enabled=true,dof=true,strength=.3,dt=0,preview=false}) {
    // Bypass and ADS clear immediately; walking/stopping settles smoothly.
    if(!enabled || !dof || ads) { this.amount=0; return 0; }
    const target=(preview || (running && moving))?clamp(strength,0,1):0;
    this.amount+=(target-this.amount)*(1-Math.exp(-clamp(dt,0,.05)*10));
    if(this.amount<.0001 && target===0)this.amount=0;
    return this.amount;
  }
}
