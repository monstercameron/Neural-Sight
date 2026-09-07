// Presentation track driven by real shot events, never a timer that creates shots.
// Locomotion, ammo, reload, aim and recoil remain owned by WeaponState.
export class FiringPlayback {
  constructor(){this.reset();}
  reset(shots=0){this.shots=shots;this.active=null;this.time=0;}
  update({shots=0,stance='hipFire',state='lowReady',busy=false,dt=0,enabled=true,clips={}}){
    if(shots<this.shots)this.reset(shots);
    if(!enabled||busy||!['ads','hipFire'].includes(state)){
      this.reset(shots);return null;
    }
    if(dt<=0)return this.frame(clips);
    if(shots>this.shots){
      this.shots=shots;this.time=0;
      const clip=stance==='ads'?'fireADS':'fireHip';
      this.active=clips[clip] && clips[clip].enabled!==false?clip:null;
    }else this.time+=Math.min(dt,.1);
    return this.frame(clips);
  }
  frame(clips){
    const clip=clips[this.active];
    if(!clip||clip.enabled===false||this.time>=clip.duration){this.active=null;return null;}
    return {clip:this.active,phase:Math.min(1,this.time/clip.duration)};
  }
}
