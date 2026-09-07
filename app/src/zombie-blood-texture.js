// Deterministic irregular stains, not a repeated circular stamp. Main lobes,
// torn gaps and separated satellite drops survive at different viewing scales.
export function bloodTextureData(variant,width=64){
  let seed=(variant+1)*7919;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const lobes=Array.from({length:18},(_,i)=>({x:(random()-.5)*(i<7?.55:1.55),y:(random()-.5)*(i<7?.4:1.55),rx:i<7?.12+random()*.25:.02+random()*.06,ry:i<7?.08+random()*.18:.02+random()*.05}));
  const holes=Array.from({length:6},()=>({x:(random()-.5)*.8,y:(random()-.5)*.6,r:.02+random()*.06}));
  const data=new Uint8Array(width*width*4);
  for(let y=0;y<width;y++)for(let x=0;x<width;x++){
    const px=(x+.5)/width*2-1,py=(y+.5)/width*2-1;let alpha=0;
    for(const l of lobes)alpha=Math.max(alpha,Math.max(0,Math.min(1,(1-Math.hypot((px-l.x)/l.rx,(py-l.y)/l.ry))*9)));
    for(const h of holes)alpha*=Math.max(0,Math.min(1,(Math.hypot(px-h.x,py-h.y)-h.r)*90));
    const grain=random(),i=(y*width+x)*4;data[i]=55+Math.round(grain*28);data[i+1]=5+Math.round(grain*4);data[i+2]=7+Math.round(grain*3);data[i+3]=Math.round(alpha*(175+grain*60));
  }
  return data;
}
