const rad=Math.PI/180;
const bound=(value,min,max,fallback=0)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
// Continuous, low-frequency breath/hand drift, never independent random frames.
// Angular amplitudes project through the current FOV, so mouse compensation has
// consistent meaning when the user changes zoom or viewport aspect ratio.
export class AdsSway {
  constructor() { this.phase=0;this.gain=0;this.output={x:0,y:0,roll:0}; }
  update({dt,active=false,enabled=true,strength=1,rate=1,fov=75,aspect=16/9}) {
    const step=bound(dt,0,.05);
    this.phase+=step*bound(rate,.5,2,1);
    if(!enabled) {this.gain=0;return this.output={x:0,y:0,roll:0};}
    if(!step)return this.output;
    this.gain+=((active?1:0)-this.gain)*(1-Math.exp(-step*7));
    if(!active && this.gain<.0001)this.gain=0;
    const t=this.phase*2*Math.PI,weight=this.gain*this.gain*bound(strength,0,2,1);
    if(weight===0)return this.output={x:0,y:0,roll:0};
    const yaw=(.13*Math.sin(t*.19)+.04*Math.sin(t*.47+.7))*weight;
    const pitch=(.18*Math.sin(t*.26+.9)+.035*Math.sin(t*.41+1.7))*weight;
    const projection=2*Math.tan(bound(fov,30,100,75)*rad/2);
    this.output={
      x:Math.tan(yaw*rad)/(projection*bound(aspect,.5,4,16/9)),
      y:Math.tan(pitch*rad)/projection,
      roll:.0006*Math.sin(t*.19+.4)*weight,
    };
    return this.output;
  }
}
