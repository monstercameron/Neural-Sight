export class WeaponMotionBlur {
  constructor() { this.previous = null; }
  update({x,y,roll,scale=1,dt,enabled=true,shutter=.5,maxPixels=12,historyMix=.15,key='',sprintAmount=0}) {
    scale=Math.max(.8,Math.min(1.8,Number(scale)||1));
    const current={x,y,roll,scale,key}, previous=this.previous;
    this.previous=current;
    const sprint=Math.max(0,Math.min(1,Number(sprintAmount)||0));
    const output={x:0,y:0,roll:0,zoom:0,maxPixels:Math.max(0,Math.min(24,maxPixels*(1+sprint*2/3))),historyMix:0};
    if(!enabled || dt<=0 || dt>.05 || !previous || previous.key!==key) return output;
    const baseAmount=Math.max(0,Math.min(1,shutter));
    const amount=baseAmount*(1+sprint);
    output.x=Math.max(-.04,Math.min(.04,(x-previous.x)*amount));
    output.y=Math.max(-.04,Math.min(.04,(y-previous.y)*amount));
    output.roll=Math.max(-.02,Math.min(.02,(roll-previous.roll)*amount));
    output.zoom=Math.max(-.15,Math.min(.15,(scale/previous.scale-1)*amount));
    // Extra sprint blur is spatial exposure, not stronger previous-frame ghosts.
    output.historyMix=Math.min(.3,Math.max(0,historyMix)*baseAmount*2);
    return output;
  }
}
// Source-space location of the bottom screen anchor, through the SAME aspect
// crop and inverse roll as the fragment transform. Zoom trails radiate from
// this point, not the image center or the separate grip rotation pivot.
export const weaponZoomMotionWGSL=`
fn weaponZoomVelocity(uv:vec2f)->vec2f {
  var anchor=vec2f(.5-p.x,1.0-p.y);
  let ratio=p.aspect/(1672.0/941.0);
  if(ratio<1.0){anchor.x=(anchor.x-.5)*ratio+.5;}
  else {anchor.y=(anchor.y-1.0)/ratio+1.0;}
  let local=(anchor-vec2f(.5,.88))*vec2f(1672.0/941.0,1);
  let cs=cos(p.roll);let sn=sin(p.roll);
  anchor=vec2f(cs*local.x+sn*local.y,-sn*local.x+cs*local.y)/vec2f(1672.0/941.0,1)+vec2f(.5,.88);
  return (uv-anchor)*p.photo.w;
}`;
