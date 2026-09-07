const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
// Cosmetic head roll driven only by actual horizontal look input, not recoil
// or spawn orientation. Camera position and base mouse aim remain unchanged.
export class TurnTilt {
  constructor(){this.reset();}
  reset(){this.delta=0;this.rate=0;this.roll=0;}
  addTurn(degrees){if(Number.isFinite(degrees))this.delta+=degrees;}
  update({dt,ads=false,enabled=true}) {
    if(!enabled){this.reset();return 0;}
    if(!Number.isFinite(dt)||dt<=0)return this.roll;
    const step=Math.min(dt,.05);
    const speed=clamp(this.delta/step,-360,360);this.delta=0;
    this.rate+=(speed-this.rate)*(1-Math.exp(-step*18));
    const target=clamp(this.rate*.007,-1.2,1.2)*(ads?.22:1);
    this.roll+=(target-this.roll)*(1-Math.exp(-step*12));
    if(Math.abs(this.rate)<.001 && Math.abs(this.roll)<.0001)this.rate=this.roll=0;
    return this.roll;
  }
}
