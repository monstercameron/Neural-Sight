// One distance-driven clock supplies foot plants to both camera bob and audio.
export class StrideCycle {
  constructor(){this.count=0;this.reset();}
  reset(){this.fraction=0;this.phase=0;this.foot=0;}
  update({distance=0,dt=0,grounded=false,running=false,active=true}){
    const footfalls=[];
    if(dt>0 && active && grounded && distance>0){
      this.fraction+=Math.min(distance,6*dt)/(running?1.4:.85);
      while(this.fraction>=1-1e-10){
        this.fraction=Math.max(0,this.fraction-1);
        footfalls.push({id:++this.count,pan:this.foot===0?-.12:.12,running});
        this.foot=1-this.foot;
      }
      this.phase=(this.foot+this.fraction)*Math.PI;
    }
    return {phase:this.phase,footfalls,swingIndex:this.count,swingProgress:this.fraction};
  }
}
