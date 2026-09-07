const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));
// Independent of DOF: sprint exposure must still work when lens blur is disabled.
export class SprintMotion {
  constructor(){this.amount=0;}
  update({dt=0,running=false,moving=false,ads=false,enabled=true,strength=.75}){
    if(!enabled){this.amount=0;return 0;}
    const target=running&&moving&&!ads?clamp(strength,0,1):0;
    this.amount+=(target-this.amount)*(1-Math.exp(-clamp(dt,0,.05)*(ads?18:target>this.amount?8:6)));
    if(target===0&&this.amount<.0001)this.amount=0;
    return this.amount;
  }
}
// Stylized forward-motion streaks, not depth/velocity-buffer reprojection.
// Same sharp-center mask as weapon blur and DOF. All tap positions stay in-frame.
export const sprintMotionWGSL=`
uniform sprintMotion: vec2f;
fn applySprintMotion(color:vec3f,uv:vec2f)->vec3f {
  let edge=sprintBorder(uv);
  let amount=clamp(uniform.sprintMotion.x,0.0,1.0)*edge;
  if(amount<.0001 || uniform.sprintMotion.y<=0.0) { return color; }
  let radial=(uv-vec2f(.5))/uniform.sceneTextureInvRes;
  let direction=radial/max(length(radial),.001);
  let span=direction*uniform.sceneTextureInvRes*uniform.sprintMotion.y*amount;
  var blurred=color*4.0;
  for(var i=1;i<=6;i++) {
    blurred+=sprintScene(uv-span*(f32(i)/6.0));
  }
  return mix(color,blurred/10.0,amount);
}`;
export const sprintMotionGLSL=`
uniform vec2 sprintMotion;
vec3 applySprintMotion(vec3 color,vec2 uv) {
  float edge=sprintBorder(uv);
  float amount=clamp(sprintMotion.x,0.0,1.0)*edge;
  if(amount<.0001 || sprintMotion.y<=0.0) return color;
  vec2 radial=(uv-vec2(.5))/sceneTextureInvRes;
  vec2 direction=radial/max(length(radial),.001);
  vec2 span=direction*sceneTextureInvRes*sprintMotion.y*amount;
  vec3 blurred=color*4.0;
  for(int i=1;i<=6;i++) blurred+=sprintScene(uv-span*(float(i)/6.0));
  return mix(color,blurred/10.0,amount);
}`;
