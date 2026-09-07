// Reserve screen space for the whole carry cone, not the current look offset.
// The gun can still travel freely; no look-dependent clamp drags it back down.
export function runFramingShrink(shrink,phase,boost=0) {
  const t=Math.max(0,Math.min(1,Number(phase)||0));
  const amount=Math.max(0,Math.min(.8,Number(boost)||0));
  // Signed shrink reuses the shared bottom-anchored transform. No source
  // stretching, no new camera delay, and the filmed phase survives reversals.
  return Math.max(-.8,Math.min(.2,(Number(shrink)||0)-amount*t*t*(3-2*t)));
}
export class RunFraming {
  constructor(){this.amount=0;this.correction=0;this.continuous=true;}
  update({shrink=0,phase=0,boost=0,dt=0,continuous=true}){
    const target=-runFramingShrink(0,phase,boost);
    if(!(Number(boost)>0)){this.amount=0;this.correction=0;this.continuous=continuous;return shrink;}
    if(dt>0){
      const decay=Math.exp(-Math.min(.05,dt)*18);
      if(continuous){
        // Rejoin a filmed edge from the current framing, not its cut target.
        if(!this.continuous)this.correction=this.amount-target;
        // Decay on THIS step before publishing; otherwise the next tiny step
        // inherits an entire previous frame's correction jump.
        this.correction*=decay;
        this.amount=Math.max(0,Math.min(.8,target+this.correction));
        this.correction=this.amount-target;
      }else{
        // Reload/unmatched cuts have no continuous source phase. Settle only
        // the optional framing contribution; never delay the gameplay action.
        this.amount=target+(this.amount-target)*decay;
        this.correction=0;
      }
      if(Math.abs(this.amount-target)<1e-5){this.amount=target;this.correction=0;}
      this.continuous=continuous;
    }
    return Math.max(-.8,Math.min(.2,shrink-this.amount));
  }
}
export class WeaponFraming {
  constructor() { this.angle=null;this.screenSpan=null; }
  update({dt,freeAngle=4,freeScreen=null,fov=75,ads=false,enabled=true}) {
    if(freeScreen!==null){
      // Retain at least the base region through ADS and its first release frame.
      const target=enabled?Math.max(0,Math.min(.7,freeScreen)):0;
      if(this.screenSpan===null)this.screenSpan=target;
      // Posture already eases expansion. A second filter would reserve less
      // space than the cone currently admits and activate the edge guard early.
      if(dt>0)this.screenSpan=target>this.screenSpan?target:
        this.screenSpan+(target-this.screenSpan)*(1-Math.exp(-Math.min(.05,dt)*14));
      return .025+this.screenSpan*.5;
    }
    const envelope=enabled?Math.min(14,Math.max(0,freeAngle)*1.75):0;
    // ADS must retain the base cone's reserve: releasing aim admits that cone
    // immediately, before an eased margin could grow. Only the sprint surplus
    // eases away. This avoids either an edge flash or a framing snap on release.
    const target=ads?Math.min(envelope,Math.max(0,freeAngle)):envelope;
    if(this.angle===null)this.angle=target;
    if(dt>0)this.angle+=(target-this.angle)*(1-Math.exp(-Math.min(.05,dt)*14));
    // Small permanent drop for all footage; only the sprint surplus eases out
    // during ADS. Use current FOV so screen compensation survives zoom changes.
    return .025+Math.tan(this.angle*.7*Math.PI/180)/(2*Math.tan(fov*Math.PI/360));
  }
}
