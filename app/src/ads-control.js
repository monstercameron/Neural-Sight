const clamp=(value,limit)=>Math.max(-limit,Math.min(limit,value));
// A deterministic hand-response spring: mouse correction can cancel recoil,
// but an abrupt correction carries momentum and can overshoot the resting sight.
export class AdsControl {
  constructor() { this.reset(); }
  reset() {
    this.axes={x:{position:0,velocity:0},y:{position:0,velocity:0}};
    this.output={x:0,y:0,roll:0,stability:1};
  }
  update({dt,mouseX=0,mouseY=0,enabled=true,active=true,weight=.6,settling=1,recoil={x:0,y:0}}) {
    if(!enabled) {this.reset();return this.output;}
    dt=Math.max(0,Math.min(.05,dt));
    if(!dt) return this.output;
    const gain=Math.max(0,Math.min(1.5,weight));
    const frequency=24*Math.max(.5,Math.min(2,settling));
    const damping=.58, f=frequency*damping;
    const omega=frequency*Math.sqrt(1-damping*damping);
    const decay=Math.exp(-f*dt),c=Math.cos(omega*dt),s=Math.sin(omega*dt);
    for(const [name,mouse] of [['x',mouseX],['y',mouseY]]) {
      const axis=this.axes[name];
      // ADS exit stops accepting correction input, not the existing motion.
      // Its residual position/velocity must settle rather than disappear.
      // Mouse deltas accumulate over this interval, not at its beginning.
      // Integrate their constant rate analytically about the forced equilibrium.
      // A frame-start impulse made identical sweeps/reversals fight differently
      // at 30 and 240Hz. The rate cap is fixed in time, not per rendered frame.
      const rate=active?clamp(mouse/dt,12):0;
      const equilibrium=rate*18*gain/(frequency*frequency);
      const x=axis.position-equilibrium,v=axis.velocity;
      axis.position=equilibrium+decay*(x*c+(v+f*x)/omega*s);
      axis.velocity=decay*(v*c-(f*v+frequency*frequency*x)/omega*s);
      if(Math.abs(axis.position)>.014) {
        axis.position=clamp(axis.position,.014);
        // Do not bank invisible momentum behind the bound.
        if(axis.position*axis.velocity>0)axis.velocity=0;
      }
    }
    const x=this.axes.x.position,y=this.axes.y.position;
    const displacement=Math.hypot(x+recoil.x,y+recoil.y);
    const momentum=Math.hypot(this.axes.x.velocity,this.axes.y.velocity);
    this.output={x,y,roll:clamp(x*.25,.0035),stability:Math.max(0,1-displacement/.022-momentum*.35)};
    return this.output;
  }
}
