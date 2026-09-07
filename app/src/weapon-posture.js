import {HIP_PHASE,HIP_TRANSITIONS} from './hip-pose.js';
export class WeaponPosture {
  constructor() { this.y=0; this.reloadBlend=0; this.reloadLower=.25;this.hipBlend=0;this.hipSag=0;this.runBlend=0;this.runConeBlend=0; }
  update({state,dt,freeAngle=4,remaining=Infinity,progress=1,authoredRun=false,running=['enterRun','run'].includes(state),aiming=false,hipFraming=null,aspect=16/9,posePhase=null}) {
    const reloading=['reload','reloadADS','repack'].includes(state);
    // This low-ready clip is already carried low. Preserve its handwork; ADS
    // reload keeps the user's deeper framing. Retain the value during fade-out.
    if(reloading)this.reloadLower=state==='reload'?.08:.25;
    const lowReady=['lowReady','lowering','exitRun','enterRun','run'].includes(state);
    const target=lowReady?.015:0;
    const step=Math.max(0,Math.min(.05,dt));
    // Separate from framing: authored run footage still gets the larger cone.
    const tightAim=aiming||state==='ads';
    this.runConeBlend+=((running&&!tightAim&&!reloading?1:0)-this.runConeBlend)*(1-Math.exp(-step*14));
    this.y+=(target-this.y)*(1-Math.exp(-step*10));
    this.runBlend+=((!authoredRun&&['enterRun','run'].includes(state)?1:0)-this.runBlend)*(1-Math.exp(-step*14));
    const hip=state==='hipFire'||['hipRaise','adsToHip'].includes(state);
    const t=Math.max(0,Math.min(1,progress));
    // Use the actual filmed pose on interrupted/re-timed paths; progress can
    // restart at zero while the gun is already halfway down.
    const hipTarget=hipFraming===null?(hip?1:state==='hipLower'?1-t*t*(3-2*t):0):Math.max(0,Math.min(1,hipFraming));
    this.hipBlend+=(hipTarget-this.hipBlend)*(1-Math.exp(-step*20));
    // The approved raise's middle frames lift the barrel ~90px above the
    // endpoint carry path (720px source). Counter that arch on the HIP route,
    // including an ADS interruption traversing those same source frames.
    // Follow the already-eased filmed phase exactly: a second time filter leaves
    // a 30–40px tail that makes the gun rise after the transition has finished.
    const sourcePhase=posePhase??(['hipRaise','hipLower'].includes(state)?hipTarget*HIP_PHASE:HIP_PHASE);
    const carry=HIP_TRANSITIONS.includes(state)?Math.max(0,Math.min(1,sourcePhase/HIP_PHASE)):0;
    if(step>0)this.hipSag=.5*carry*(1-carry);
    this.reloadBlend+=((reloading?1:0)-this.reloadBlend)*(1-Math.exp(-step*12));
    // Restore framing during the filmed final raise, before ADS takes control.
    // Freeze when paused; an interrupted reload still eases back normally.
    if(reloading && step>0 && remaining<.4) {
      const t=Math.max(0,remaining/.4);
      this.reloadBlend=Math.min(this.reloadBlend,t*t*(3-2*t));
    }
    const shrink=Math.max(.12*this.hipBlend,.2*this.reloadBlend);
    const carrySag=this.hipSag*Math.max(1,aspect/(1672/941))*(1-shrink);
    return {y:this.y,shrink,
      lower:Math.min(.25,(.1*this.hipBlend+carrySag)*(1-this.reloadBlend)+this.reloadLower*this.reloadBlend+.025*this.runBlend*(1-this.reloadBlend)),
      freeAngle:freeAngle*(reloading?1.25:tightAim?1:1+.75*this.runConeBlend),reloading};
  }
}
