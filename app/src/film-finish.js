// Final photographic texture. Grain is applied after TAA, grading and display
// encoding: it cannot contaminate motion history or the scene brightness meter.
export const filmGrainWGSL=`
fn filmHash(p:vec2f,seed:f32)->f32 {
  var q=fract(vec3f(p.x,p.y,seed)*vec3f(.1031,.1030,.0973));
  q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
fn filmGrain(color:vec3f,pixel:vec2f,seed:f32,strength:f32)->vec3f {
  if(strength<=0.0){return color;}
  let y=dot(color,vec3f(.2126,.7152,.0722));
  let envelope=smoothstep(.015,.12,y)*(1.0-smoothstep(.7,1.0,y));
  let n=filmHash(floor(pixel),seed)-filmHash(floor(pixel)+vec2f(19,47),seed+11);
  return clamp(color+vec3f(n*clamp(strength,0.0,1.0)*.035*envelope),vec3f(0),vec3f(1));
}`;
export const filmDiffusionWGSL=`
fn filmHighlight(c:vec3f)->vec3f {
  let y=dot(c,vec3f(.2126,.7152,.0722));
  return c*smoothstep(.65,1.5,y);
}
fn filmCompositeAt(uv:vec2f)->vec3f {
  let safe=clamp(uv,uniform.sceneTextureInvRes*.5,vec2f(1)-uniform.sceneTextureInvRes*.5);
  let w=textureSampleLevel(filmWeapon,filmWeaponSampler,safe,0);
  let s=textureSampleLevel(sceneTexture,sceneTextureSampler,safe,0).rgb;
  return filmOver(s,w);
}
fn filmDiffusion(color:vec3f,uv:vec2f)->vec3f {
  let amount=uniform.filmFinish.y;
  if(amount<=0.0){return color;}
  let d=uniform.sceneTextureInvRes*3.0;
  let spread=(filmHighlight(filmCompositeAt(uv+vec2f(d.x,0)))+
    filmHighlight(filmCompositeAt(uv-vec2f(d.x,0)))+
    filmHighlight(filmCompositeAt(uv+vec2f(0,d.y)))+
    filmHighlight(filmCompositeAt(uv-vec2f(0,d.y))))*.25;
  // Only spread excess light across highlight edges; no global blur/lift.
  let scatter=max(spread-filmHighlight(color),vec3f(0));
  return color+min(scatter,vec3f(.6))*amount*.18*vec3f(1,.86,.68);
}`;
export function installFilmFinish(pc,device) {
  if(!device.wgpu)return null;
  const chunks=pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_WGSL);
  const source=chunks.get('composePS'),tone='result = toneMap(max(vec3f(0.0), result));',display='result = gammaCorrectOutput(result);';
  if(!source?.includes(tone)||!source.includes(display)||!source.includes('filmOver(result,weapon)'))throw Error('Film finish requires shared composite hooks');
  chunks.set('composeDeclarationsPS',chunks.get('composeDeclarationsPS')+`\nuniform filmFinish:vec4f;\n${filmGrainWGSL}${filmDiffusionWGSL}`);
  chunks.set('composePS',source.replace(tone,`result = filmDiffusion(result,uv);\n${tone}`)
    .replace(display,`${display}\nresult = filmGrain(result,uv/uniform.sceneTextureInvRes,uniform.filmFinish.z,uniform.filmFinish.x);`));
  const binding=device.scope.resolve('filmFinish');binding.setValue([0,0,0,0]);
  return (grain,diffusion,seconds)=>binding.setValue([Math.max(0,Math.min(1,grain||0)),Math.max(0,Math.min(1,diffusion||0)),Math.floor((seconds||0)*24)%4096,0]);
}
