// Suppress the extra cosmetic camera spring for the whole generated-effects
// mode, not individual frames. Gun recoil remains aligned with ballistic aim.
export function authoredRecoilReady(player, stance, enabled) {
  const clip=player.clips[stance==='ads'?'fireADS':'fireHip'];
  return !!(enabled && clip?.enabled!==false && clip?.generatedFlash && clip.frames.every(url=>player.cache.has(url)&&!player.failed.has(url)));
}
export class RecoilPresentation {
  constructor(){this.reset();}
  reset(){this.gain=null;}
  update({authored=false,dt=0}) {
    const target=authored?0:1;
    if(this.gain===null)this.gain=target;
    const elapsed=Math.max(0,Math.min(.05,dt));
    this.gain+=(target-this.gain)*(1-Math.exp(-elapsed*24));
    if(Math.abs(this.gain-target)<.001)this.gain=target;
    return this.gain;
  }
}
