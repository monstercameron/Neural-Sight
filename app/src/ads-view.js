const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));
export class AdsView {
  constructor() { this.blend=0; }
  update({state,aim,dt,remaining=Infinity,manual=false,baseFov=75,
    zoomEnabled=true,tightening=40,blurEnabled=true,dofEnabled=true,blurStrength=39}) {
    let target=!manual && aim && ['raising','hipToADS','ads'].includes(state)?1:0;
    // Keep the scene open during reload, re-engage with its final filmed raise.
    if(!manual && aim && state==='reloadADS' && remaining<.4) {
      const t=clamp(1-remaining/.4,0,1);
      target=t*t*(3-2*t);
    }
    const step=clamp(dt,0,.05);
    this.blend+=(target-this.blend)*(1-Math.exp(-step*14));
    if(step>0 && Math.abs(this.blend-target)<.0001)this.blend=target;
    return {
      fov:baseFov*(1-(zoomEnabled?clamp(tightening,0,40)/100:0)*this.blend),
      peripheral:blurEnabled && dofEnabled?clamp(blurStrength,0,100)/100*this.blend:0,
      blend:this.blend,
    };
  }
}
