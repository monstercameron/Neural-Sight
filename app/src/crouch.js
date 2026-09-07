export const STANDING_EYE=1.5,CROUCH_EYE=.9,CROUCH_DURATION=.16;
// Locomotion posture is independent of weapon aim/reload/fire state.
export class Crouch {
  constructor(){this.reset();}
  reset(){this.amount=0;this.from=0;this.target=0;this.duration=CROUCH_DURATION;this.time=this.duration;this.blocked=false;}
  update({held,dt,canStand=true}) {
    const target=held || !canStand ? 1 : 0;
    this.blocked=!held&&!canStand;
    if(target!==this.target){this.target=target;this.from=this.amount;this.time=0;
      this.duration=Math.max(.04,(target?.16:.18)*Math.abs(target-this.amount));}
    this.time=Math.min(this.duration,this.time+Math.max(0,Math.min(.05,Number(dt)||0)));
    const t=this.time/this.duration,s=t*t*(3-2*t);
    this.amount=this.from+(this.target-this.from)*s;
    return this.amount;
  }
  get eyeHeight(){return STANDING_EYE-(STANDING_EYE-CROUCH_EYE)*this.amount;}
  get active(){return this.target===1 || this.amount>.001;}
  get phase(){return this.time<this.duration?(this.target?'enter':'exit'):'idle';}
  // Retarget/reverse footage from the visible body phase, not frame zero.
  get progress(){return this.target?this.amount:1-this.amount;}
  transitionFrame(clip,clips){
    if(!/^crouch(Enter|Exit)(Low|ADS)$/.test(clip??''))return null;
    const source=clip.replace('Exit','Enter'),forward=clips[source],selected=clips[clip];
    if(!forward||!selected)return null;
    // Only reuse explicitly derived reversals of this same take. Independently
    // authored exits retain their own footage and normal progress routing.
    if(source!==clip&&(!selected.derivedReverse||typeof forward.source!=='string'||!forward.source.trim()||selected.source!==forward.source||
      selected.frames.length!==forward.frames.length))return null;
    // Both directions quantize the SAME physical body phase once. Computing
    // floor(amount*N) and floor((1-amount)*N) separately can jump one image on
    // reversal; sharing the source also reuses already-decoded entry bitmaps.
    return {clip:source,phase:this.amount,direction:this.target?1:-1};
  }
  clip(weapon,moving=false) {
    // Committed weapon actions keep their existing clips while the body crouches.
    if(!['lowReady','ads','exitRun'].includes(weapon))return null;
    const stance=weapon==='ads'?'ADS':'Low';
    if(this.phase!=='idle')return `crouch${this.phase==='enter'?'Enter':'Exit'}${stance}`;
    return this.active?`crouch${moving?'Walk':'Idle'}${stance}`:null;
  }
}
