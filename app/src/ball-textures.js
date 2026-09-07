const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const phi=(1+Math.sqrt(5))/2;
const vertices=[];
for(const a of [-1,1])for(const b of [-1,1])vertices.push(unit([0,a,b*phi]),unit([a,b*phi,0]),unit([b*phi,0,a]));
const adjacent=(a,b)=>dot(vertices[a],vertices[b])>.44;
const panels=vertices.map(n=>({n,black:true}));
for(let a=0;a<12;a++)for(let b=a+1;b<12;b++)for(let c=b+1;c<12;c++){
  if(adjacent(a,b)&&adjacent(a,c)&&adjacent(b,c))panels.push({n:unit(vertices[a].map((v,i)=>v+vertices[b][i]+vertices[c][i])),black:false});
}
export const BALL_STYLES=['Beach ball','Soccer ball'];
// Code-generated seamless spherical panels: no external assets or paid jobs.
export function ballTexturePixels(style,width=512,height=256){
  const data=new Uint8Array(width*height*4),sun=unit([-.4,.75,-.5]);
  const colors=[[.97,.19,.13],[1,.91,.21],[.14,.58,.96],[.96,.96,.90],[.22,.76,.44],[.96,.96,.90]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=(x+.5)/width,v=(y+.5)/height,angle=u*Math.PI*2,latitude=v*Math.PI;
    const n=[Math.sin(latitude)*Math.cos(angle),Math.cos(latitude),Math.sin(latitude)*Math.sin(angle)];
    let color,seam;
    if(style==='soccer'){
      let first=-Infinity,second=-Infinity,black=false;
      for(const panel of panels){const score=dot(n,panel.n)-(panel.black?.025:0);
        if(score>first){second=first;first=score;black=panel.black;}else second=Math.max(second,score);}
      color=black?[.055,.062,.073]:[.92,.935,.91];seam=Math.min(1,(first-second)/.007);
    }else{
      const stripe=u*6,part=stripe%1;
      color=Math.abs(n[1])>.97?[.96,.96,.9]:colors[Math.floor(stripe)%6];
      seam=Math.min(1,Math.min(part,1-part)/.015);
    }
    // Soft baked directional shading keeps form legible in the unlit splat scene.
    const shade=.48+.52*Math.max(0,dot(n,sun));
    const grain=1-.018*(Math.sin(x*17+y*31)*.5+.5);
    const spec=style==='soccer'?0:Math.pow(Math.max(0,dot(n,sun)),55)*.22;
    const i=(y*width+x)*4;
    for(let k=0;k<3;k++)data[i+k]=Math.round(Math.min(1,(color[k]*(.67+.33*seam)*shade+spec)*grain)*255);
    data[i+3]=255;
  }
  return {data,width,height};
}
