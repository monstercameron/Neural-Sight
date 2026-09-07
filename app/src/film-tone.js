// A display-rendering shoulder for this game's linear working buffers.
// Not ARRI/LogC or an attempt to recover detail already clipped in the source.
export function filmTone(rgb,knee=.6) {
  const c=rgb.map(v=>Math.max(0,v)),peak=Math.max(...c);
  const k=Math.max(.4,Math.min(.9,knee)),range=1-k;
  if(peak<=k)return c;
  const mapped=1-range*range/(peak+1-2*k);
  return c.map(v=>v*mapped/peak);
}
export const filmToneWGSL=`
fn filmTone(color:vec3f,knee:f32)->vec3f {
  let c=max(color,vec3f(0));
  let peak=max(c.r,max(c.g,c.b));
  let k=clamp(knee,.4,.9);
  if(peak<=k){return c;}
  let range=1.0-k;
  let mapped=1.0-range*range/(peak+1.0-2.0*k);
  return c*(mapped/peak);
}`;
export const filmToneGLSL=`
vec3 filmTone(vec3 color,float knee) {
  vec3 c=max(color,vec3(0.0));
  float peak=max(c.r,max(c.g,c.b));
  float k=clamp(knee,.4,.9);
  if(peak<=k)return c;
  float range=1.0-k;
  float mapped=1.0-range*range/(peak+1.0-2.0*k);
  return c*(mapped/peak);
}`;
export function installFilmTone(pc,device) {
  pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_WGSL).set('tonemappingLinearPS',`
${filmToneWGSL}
uniform filmToneParams:vec2f;
fn toneMap(color:vec3f)->vec3f {
  let exposed=color*getExposure();
  if(uniform.filmToneParams.x<.5){return exposed;}
  return filmTone(exposed,uniform.filmToneParams.y);
}`);
  pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_GLSL).set('tonemappingLinearPS',`
${filmToneGLSL}
uniform vec2 filmToneParams;
vec3 toneMap(vec3 color) {
  vec3 exposed=color*getExposure();
  if(filmToneParams.x<.5)return exposed;
  return filmTone(exposed,filmToneParams.y);
}`);
}
