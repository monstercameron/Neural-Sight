export function sharpeningAmount(enabled, value) {
  return enabled ? Math.max(0,Math.min(1,Number(value)||0)) : 0;
}

// Bounded, linear-light detail enhancement. Local extrema and the detail cap
// prevent bright/dark ringing; flat areas remain unchanged.
export const sharpeningWGSL=`
fn sharpenRGB(center:vec3f,a:vec3f,b:vec3f,c:vec3f,d:vec3f,amount:f32)->vec3f {
  let lo=min(center,min(min(a,b),min(c,d)));
  let hi=max(center,max(max(a,b),max(c,d)));
  let detail=clamp(center-(a+b+c+d)*.25,vec3f(-.05),vec3f(.05));
  return clamp(center+detail*clamp(amount,0.0,1.0),lo,hi);
}`;
export const sharpeningGLSL=`
vec3 sharpenRGB(vec3 center,vec3 a,vec3 b,vec3 c,vec3 d,float amount) {
  vec3 lo=min(center,min(min(a,b),min(c,d)));
  vec3 hi=max(center,max(max(a,b),max(c,d)));
  vec3 detail=clamp(center-(a+b+c+d)*.25,vec3(-.05),vec3(.05));
  return clamp(center+detail*clamp(amount,0.0,1.0),lo,hi);
}`;
