import wgsl from 'playcanvas/build/playcanvas/src/scene/shader-lib/wgsl/chunks/render-pass/frag/taaResolve.js';
import glsl from 'playcanvas/build/playcanvas/src/scene/shader-lib/glsl/chunks/render-pass/frag/taaResolve.js';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));
export function taaSettings(enabled,jitter=.75,stability=.88,supported=true){
  return {enabled:!!enabled&&supported,jitter:clamp(jitter,.25,1),stability:clamp(stability,.5,.95)};
}
export class TemporalHistory {
  constructor(){this.reset();}
  reset(){this.previous=null;}
  update({position,angles,fov,width,height,stability=.88,dt=1/60}){
    const previous=this.previous;
    this.previous={position:[...position],angles:[...angles],fov,width,height};
    if(!previous||width!==previous.width||height!==previous.height||!Number.isFinite(dt)||dt<=0||dt>.1)return 1;
    const distance=Math.hypot(...position.map((v,i)=>v-previous.position[i]));
    const angle=Math.max(...angles.map((v,i)=>Math.abs(((v-previous.angles[i]+540)%360)-180)));
    const zoom=Math.abs(fov-previous.fov);
    if(distance>1||angle>20||zoom>5)return 1;
    // Calibrate camera speed and persistence to the prior 60Hz behavior. Using
    // per-frame displacement/history made identical pans smear longer at30Hz.
    const frameTime=dt*60;
    const motion=clamp((distance*5+angle*.06+zoom*.1)/frameTime,0,1);
    const base=1-clamp(stability,.5,.95);
    const referenceWeight=base+(.55-base)*motion;
    return -Math.expm1(Math.log1p(-referenceWeight)*frameTime);
  }
}
export function temporalResolve(source,language){
  const token=language==='wgsl'?'let mixedPremul = mix(historyPremulClamped, srcPremul, mixFactor);':'vec3 mixedPremul = mix(historyPremulClamped, srcPremul, mixFactor);';
  if(!source.includes(token))throw new Error('PlayCanvas TAA resolve changed');
  const uniform=language==='wgsl'?'uniform taaCurrentWeight: f32;\n':'uniform float taaCurrentWeight;\n';
  // Preserve the engine's out-of-frame rejection, but not its fixed .05 floor:
  // that floor would defeat time normalization at high refresh rates.
  const weight=language==='wgsl'?'select(uniform.taaCurrentWeight, 1.0, mixFactor_condition)':'(mixFactor_condition ? 1.0 : taaCurrentWeight)';
  return uniform+source.replace(token,token.replace('mixFactor);',`${weight});`));
}
// Retain the engine's jitter, Catmull-Rom reconstruction, neighborhood clamping
// and depth reprojection. Only replace fixed 95% history with an adaptive weight.
export function attachTemporalHistory(pc,device,cameraFrame,history,getStability,now=()=>performance.now()){
  // Use the application's engine instance, not a second deep-imported cache.
  const {ShaderUtils}=pc;
  const pass=cameraFrame.renderPassCamera?.taaPass;
  if(!pass||pass.neuralTemporal)return false;
  const defines=new Map([['QUALITY_HIGH',true]]);
  const key=ShaderUtils.addScreenDepthChunkDefines(cameraFrame.cameraComponent.shaderParams,defines);
  pass.shader=ShaderUtils.createShader(device,{
    uniqueName:`NeuralTemporalResolveV2${key}`,attributes:{aPosition:pc.SEMANTIC_POSITION},vertexChunk:'quadVS',
    fragmentWGSL:temporalResolve(wgsl,'wgsl'),fragmentGLSL:temporalResolve(glsl,'glsl'),fragmentDefines:defines,
  });
  history.reset();pass.neuralTemporal=true;
  const before=pass.before.bind(pass),weight=device.scope.resolve('taaCurrentWeight');
  let lastTime=null;
  pass.before=()=>{
    before();
    // Real render time, not the QA/game simulation delta. TAA also renders
    // between frozen simulation steps and must never accumulate on that clock.
    const time=now(),dt=lastTime===null?1/60:(time-lastTime)/1000;lastTime=time;
    const camera=cameraFrame.cameraComponent,position=camera.entity.getPosition(),angles=camera.entity.getEulerAngles();
    weight.setValue(history.update({position:[position.x,position.y,position.z],angles:[angles.x,angles.y,angles.z],
      fov:camera.fov,width:pass.sourceTexture.width,height:pass.sourceTexture.height,stability:getStability(),dt}));
  };
  return true;
}
