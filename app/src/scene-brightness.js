const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const finite=(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback;
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;

// Robust log-average of a small scene-only sRGB crop. Trim bright sky/specular
// outliers and black holes; never include the weapon canvas or DOM/HUD.
export function sceneLuminance(rgba) {
  const samples=[];
  for(let i=0;i+3<rgba.length;i+=4) {
    if(rgba[i+3]<240)continue;
    const value=.2126*linear(rgba[i]/255)+.7152*linear(rgba[i+1]/255)+.0722*linear(rgba[i+2]/255);
    samples.push(Math.log2(Math.max(.002,value)));
  }
  if(samples.length<16)return null;
  samples.sort((a,b)=>a-b);
  const trim=Math.floor(samples.length*.1),middle=samples.slice(trim,samples.length-trim);
  return 2**(middle.reduce((a,b)=>a+b,0)/middle.length);
}
export function brightnessSettings(value={}) {
  return {enabled:value?.enabled!==false,strength:clamp(finite(value?.strength,1),0,2),
    bias:clamp(finite(value?.bias,0),-1,1.5)};
}
export function readSceneBrightness(storage,id) {
  try{return brightnessSettings(JSON.parse(storage.getItem(`neural-sight.scene-light.${id}`))||{});}
  catch{return brightnessSettings();}
}
export function saveSceneBrightness(storage,id,value) {
  try{storage.setItem(`neural-sight.scene-light.${id}`,JSON.stringify(brightnessSettings(value)));}catch{}
}
export class SceneBrightness {
  constructor(){this.ev=0;this.luminance=null;this.lastSample=-Infinity;this.error='';this.samples=0;}
  sample(canvas,now) {
    if(now-this.lastSample<1000/6 || !canvas.width || !canvas.height)return;
    this.lastSample=now;
    try {
      if(!this.context) {
        this.surface=new OffscreenCanvas(32,18);
        this.context=this.surface.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
        if(!this.context)throw new Error('Scene meter unavailable');
      }
      this.context.clearRect(0,0,32,18);
      this.context.drawImage(canvas,canvas.width*.08,canvas.height*.18,canvas.width*.84,canvas.height*.64,0,0,32,18);
      const value=sceneLuminance(this.context.getImageData(0,0,32,18).data);
      if(value===null)throw new Error('Waiting for a rendered scene');
      this.luminance=value;this.error='';this.samples++;
    } catch(error){this.error=error.message;}
  }
  update(dt,settings={}) {
    const {enabled,strength,bias}=brightnessSettings(settings);
    if(!enabled){this.ev=0;return 0;}
    // Match the subdued footage against a 10%-linear scene reference. A filmed
    // daylight scene around 20% luma needs a visible lift, not a near-zero nudge.
    // Artist bias can darken or brighten independently, saved per level.
    const auto=this.error||this.luminance===null?0:clamp(Math.log2(Math.max(.002,this.luminance)/.10)*.85,0,1.4);
    const target=clamp(auto*strength+bias,-1,2);
    const step=clamp(finite(dt,0),0,.05),tau=target>this.ev?.6:1.2;
    this.ev+=(target-this.ev)*(1-Math.exp(-step/tau));
    if(step>0 && Math.abs(target-this.ev)<.0001)this.ev=target;
    return this.ev;
  }
}
export const sceneBrightnessWGSL=`
fn matchSceneBrightness(color:vec4f,ev:f32)->vec4f {
  if(color.a<=0.0 || abs(ev)<.00001) { return color; }
  let straight=clamp(color.rgb/color.a,vec3f(0),vec3f(1));
  let gain=exp2(clamp(ev,-1.0,2.0));
  // Soft shoulder retains highlight detail; black stays black and alpha is
  // unchanged. Apply before the shared grade and before additive muzzle light.
  let lit=straight*gain/(vec3f(1)+straight*(gain-1.0));
  return vec4f(lit*color.a,color.a);
}`;
