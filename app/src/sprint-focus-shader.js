import composeWGSL from 'playcanvas/build/playcanvas/src/scene/shader-lib/wgsl/chunks/render-pass/frag/compose/compose.js';
import composeGLSL from 'playcanvas/build/playcanvas/src/scene/shader-lib/glsl/chunks/render-pass/frag/compose/compose.js';
import {sharpeningWGSL,sharpeningGLSL} from './sharpening.js';
import {sprintMotionWGSL,sprintMotionGLSL} from './sprint-motion.js';

export const borderWGSL = `
fn sprintBorder(uv: vec2f) -> f32 {
  let edge=abs(uv*2.0-1.0);
  // Elliptical in screen space, with the entire central 45% rectangle inside
  // the clear region. Avoid square optical boundaries as objects cross frame.
  return smoothstep(.64,1.0,length(edge));
}`;
export const centerDofWGSL = `
fn applyCenterProtectedDof(color: vec3f, uv: vec2f) -> vec3f {
  let weight=sprintBorder(uv);
  if(weight<=0.0) { return color; }
  #ifdef DOF
    return mix(color,applyDof(color,uv),weight);
  #else
    return color;
  #endif
}`;
export const sprintDeclarationsWGSL = `
uniform sprintFocus: vec2f;
uniform detailSharpen: f32;
${borderWGSL}
${centerDofWGSL}
${sharpeningWGSL}
fn applySceneSharpen(color:vec3f,uv:vec2f)->vec3f {
  let amount=uniform.detailSharpen*(1.0-sprintBorder(uv));
  if(amount<=0.0) { return color; }
  let d=uniform.sceneTextureInvRes;
  let lo=d*.5;let hi=vec2f(1)-lo;
  let a=textureSampleLevel(sceneTexture,sceneTextureSampler,clamp(uv+vec2f(d.x,0),lo,hi),0).rgb;
  let b=textureSampleLevel(sceneTexture,sceneTextureSampler,clamp(uv-vec2f(d.x,0),lo,hi),0).rgb;
  let c=textureSampleLevel(sceneTexture,sceneTextureSampler,clamp(uv+vec2f(0,d.y),lo,hi),0).rgb;
  let e=textureSampleLevel(sceneTexture,sceneTextureSampler,clamp(uv-vec2f(0,d.y),lo,hi),0).rgb;
  return sharpenRGB(color,a,b,c,e,amount);
}
fn sprintScene(uv: vec2f) -> vec3f {
  let safeUv=clamp(uv,uniform.sceneTextureInvRes*.5,vec2f(1)-uniform.sceneTextureInvRes*.5);
  var c=textureSampleLevel(sceneTexture,sceneTextureSampler,safeUv,0).rgb;
  #ifdef DOF
    c=applyCenterProtectedDof(c,safeUv);
  #endif
  return c;
}
fn applySprintFocus(color: vec3f,uv: vec2f) -> vec3f {
  let amount=clamp(uniform.sprintFocus.x,0.0,1.0)*sprintBorder(uv);
  if(amount<.0001 || uniform.sprintFocus.y<=0.0) { return color; }
  let d=uniform.sceneTextureInvRes*uniform.sprintFocus.y;
  var soft=color*4.0;
  soft+=sprintScene(uv+d*vec2f(1,0))+sprintScene(uv-d*vec2f(1,0));
  soft+=sprintScene(uv+d*vec2f(0,1))+sprintScene(uv-d*vec2f(0,1));
  soft+=sprintScene(uv+d*.7071)+sprintScene(uv-d*.7071);
  soft+=sprintScene(uv+d*vec2f(.7071,-.7071))+sprintScene(uv-d*vec2f(.7071,-.7071));
  return mix(color,soft/12.0,amount);
}`;
export const sprintDeclarationsGLSL = `
uniform vec2 sprintFocus;
uniform float detailSharpen;
float sprintBorder(vec2 uv) {
  vec2 edge=abs(uv*2.0-1.0);
  return smoothstep(.64,1.0,length(edge));
}
${sharpeningGLSL}
vec3 applySceneSharpen(vec3 color,vec2 uv) {
  float amount=detailSharpen*(1.0-sprintBorder(uv));
  if(amount<=0.0) return color;
  vec2 d=sceneTextureInvRes,lo=d*.5,hi=vec2(1)-lo;
  vec3 a=texture2DLod(sceneTexture,clamp(uv+vec2(d.x,0),lo,hi),0.0).rgb;
  vec3 b=texture2DLod(sceneTexture,clamp(uv-vec2(d.x,0),lo,hi),0.0).rgb;
  vec3 c=texture2DLod(sceneTexture,clamp(uv+vec2(0,d.y),lo,hi),0.0).rgb;
  vec3 e=texture2DLod(sceneTexture,clamp(uv-vec2(0,d.y),lo,hi),0.0).rgb;
  return sharpenRGB(color,a,b,c,e,amount);
}
vec3 applyCenterProtectedDof(vec3 color,vec2 uv) {
  float weight=sprintBorder(uv);
  if(weight<=0.0) return color;
  #ifdef DOF
    return mix(color,applyDof(color,uv),weight);
  #else
    return color;
  #endif
}
vec3 sprintScene(vec2 uv) {
  vec2 safeUv=clamp(uv,sceneTextureInvRes*.5,vec2(1.0)-sceneTextureInvRes*.5);
  vec3 c=texture2DLod(sceneTexture,safeUv,0.0).rgb;
  #ifdef DOF
    c=applyCenterProtectedDof(c,safeUv);
  #endif
  return c;
}
vec3 applySprintFocus(vec3 color,vec2 uv) {
  float amount=clamp(sprintFocus.x,0.0,1.0)*sprintBorder(uv);
  if(amount<.0001 || sprintFocus.y<=0.0) return color;
  vec2 d=sceneTextureInvRes*sprintFocus.y;
  vec3 soft=color*4.0;
  soft+=sprintScene(uv+d*vec2(1,0))+sprintScene(uv-d*vec2(1,0));
  soft+=sprintScene(uv+d*vec2(0,1))+sprintScene(uv-d*vec2(0,1));
  soft+=sprintScene(uv+d*.7071)+sprintScene(uv-d*.7071);
  soft+=sprintScene(uv+d*vec2(.7071,-.7071))+sprintScene(uv-d*vec2(.7071,-.7071));
  return mix(color,soft/12.0,amount);
}`;
export function withSprintFocus(source) {
  const anchor='\t\t#ifdef SSAO_TEXTURE';
  const dof='result = applyDof(result, uv);';
  if(!source.includes(anchor)||!source.includes(dof))throw new Error('PlayCanvas compose layout changed: sprint focus insertion unavailable');
  return source.replace('\t\t#ifdef DOF','\t\tresult = applySceneSharpen(result, uv);\n\t\t#ifdef DOF')
    .replace(dof,'result = applyCenterProtectedDof(result, uv);')
    .replace(anchor,'\t\tresult = applySprintFocus(result, uv);\n\t\tresult = applySprintMotion(result, uv);\n'+anchor);
}
export function installSprintFocus(pc,device) {
  for(const [language,source,declarations] of [
    [pc.SHADERLANGUAGE_WGSL,composeWGSL,sprintDeclarationsWGSL],
    [pc.SHADERLANGUAGE_GLSL,composeGLSL,sprintDeclarationsGLSL],
  ]) {
    const chunks=pc.ShaderChunks.get(device,language);
    chunks.set('composePS',withSprintFocus(source));
    chunks.set('composeDeclarationsPS',declarations+(language===pc.SHADERLANGUAGE_WGSL?sprintMotionWGSL:sprintMotionGLSL));
  }
  const uniform=device.scope.resolve('sprintFocus');
  uniform.setValue([0,0]);
  device.scope.resolve('detailSharpen').setValue(0);
  device.scope.resolve('sprintMotion').setValue([0,0]);
  return uniform;
}
