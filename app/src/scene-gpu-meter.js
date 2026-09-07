import {displayColorWGSL} from './color-pipeline.js';
import {filmToneWGSL} from './film-tone.js';
import {sceneLuminance} from './scene-brightness.js';

// Small scene-only sample, BEFORE weapon composition. One 4.5KB readback at
// most six times/sec; never copy/read the full HDR frame or queue pending maps.
export const sceneMeterWGSL=`${displayColorWGSL}\n${filmToneWGSL}
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var lut: texture_2d<f32>;
@group(0) @binding(3) var<uniform> settings:vec4f;
struct V { @builtin(position) position:vec4f, @location(0) uv:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
  var corners=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var v:V;v.position=vec4f(corners[i],0,1);
  v.uv=vec2f((corners[i].x+1)*.5,(1-corners[i].y)*.5);return v;
}
@fragment fn fs(v:V)->@location(0) vec4f {
  var linear=textureSampleLevel(scene,smp,vec2f(.08,.18)+v.uv*vec2f(.84,.64),0).rgb*settings.w;
  if(settings.x>.5){linear=filmTone(linear,settings.y);}
  let graded=displayToLinear(sampleDisplayLut(lut,smp,linearToDisplay(linear)));
  return vec4f(linearToDisplay(mix(linear,graded,settings.z)),1);
}`;
export class SceneGpuMeter {
  async init(device){
    this.device=device;
    const module=device.createShaderModule({code:sceneMeterWGSL});
    this.pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},
      fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]}});
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
    this.output=device.createTexture({size:[32,18],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    this.uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.read=device.createBuffer({size:256*18,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  }
  async sample(scene,lut,meter,now,{enabled=true,knee=.6,grade=0,exposure=1}={}){
    if(this.disposed||this.busy||!scene||!lut||now-meter.lastSample<1000/6)return;
    this.busy=true;meter.lastSample=now;
    try{
      const d=this.device;
      d.queue.writeBuffer(this.uniform,0,new Float32Array([enabled?1:0,knee,grade,exposure]));
      const group=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:scene.createView()},{binding:1,resource:this.sampler},
        {binding:2,resource:lut.createView()},{binding:3,resource:{buffer:this.uniform}}]});
      const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{
        view:this.output.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
      pass.setPipeline(this.pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
      encoder.copyTextureToBuffer({texture:this.output},{buffer:this.read,bytesPerRow:256},[32,18]);
      d.queue.submit([encoder.finish()]);
      await this.read.mapAsync(GPUMapMode.READ);
      const mapped=new Uint8Array(this.read.getMappedRange()),pixels=new Uint8Array(32*18*4);
      for(let y=0;y<18;y++)pixels.set(mapped.subarray(y*256,y*256+128),y*128);
      this.read.unmap();
      if(this.disposed)return;
      const value=sceneLuminance(pixels);
      if(value===null)throw Error('Waiting for HDR scene meter');
      meter.luminance=value;meter.error='';meter.samples++;
    }catch(error){if(!this.disposed)meter.error=error.message;}
    finally{this.busy=false;}
  }
  destroy(){this.disposed=true;this.output?.destroy();this.uniform?.destroy();this.read?.destroy();}
}
