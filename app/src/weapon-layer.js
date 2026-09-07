import { createGradeLut } from "./cinematic-grade.js";
import {mediaUrl} from './media-url.js';
import {fetchLocal} from './local-fetch.js';
import {muzzleLightWGSL,muzzleEmissionWGSL} from './muzzle-flash.js';
import { displayColorWGSL } from "./color-pipeline.js";
import { borderWGSL } from "./sprint-focus-shader.js";
import {sharpeningWGSL} from './sharpening.js';
import {sceneBrightnessWGSL} from './scene-brightness.js';
import {flashTransparencyWGSL} from './flash-transparency.js';
import {filmToneWGSL} from './film-tone.js';
import {weaponZoomMotionWGSL} from './motion-blur.js';
// Place the real bottom edge below the viewport, with space for bob/look/recoil.
// This changes framing only; it never stretches or repeats a row of image pixels.
export function weaponVerticalOffset(y = 0, roll = 0, aspect = 16/9) {
  const offset = .055 + Math.max(-.045, Math.min(.045, y));
  // Preserve the reserve at a tilted bottom corner, including ultrawide displays.
  return Math.max(offset, .01 + Math.abs(roll) * Math.max(aspect, 1672/941) * .65);
}
// Camera compensation is already a screen displacement. The compositor's
// bottom-anchored framing scale must not reduce it (HIP is 88%, reload 80%).
// Undo only that scale; camera travel is independent of local weapon motion.
export function weaponFollowOffset(follow,shrink=0) {
  const scale=1-Math.max(-.8,Math.min(.2,Number(shrink)||0));
  return {x:follow.x/scale,y:follow.y/scale};
}
// User preference: full cone travel may put filmed hands/gun outside the frame.
// Keep the local bob/recoil reserve, but never clip geometric camera travel to
// that reserve. Shared by shader uniforms, motion tracking and ballistic rays.
export function weaponScreenOffset({x=0,y=0,roll=0,aspect=16/9,follow={x:0,y:0},shrink=0,lower=0,bottomReserve=0}={}) {
  const camera=weaponFollowOffset(follow,shrink);
  const scale=1-Math.max(-.8,Math.min(.2,shrink));
  const desired=weaponVerticalOffset(y,roll,aspect)+camera.y+bottomReserve/scale;
  // The elastic spring can stretch beyond the configured cone during a whip.
  // Keep both rotated source-bottom corners below the viewport, including crop,
  // framing scale and reload lowering. Nominal cone travel fits in the reserve;
  // this catches only excess upward travel, never stretches source pixels.
  const native=1672/941;
  const bottom=.88+.12*Math.cos(roll)-native*.5*Math.abs(Math.sin(roll));
  const croppedBottom=1+(bottom-1)*Math.max(1,aspect/native);
  const floor=(.018-Math.max(0,Math.min(.25,lower)))/scale+1-croppedBottom;
  // C1 soft maximum: a short rounded approach instead of a hard edge catch.
  const band=.008/scale,h=Math.max(0,band-Math.abs(desired-floor));
  return {x:x+camera.x,y:Math.max(desired,floor)+h*h/(4*band)};
}
export const weaponShader = `
${displayColorWGSL}
${borderWGSL}
${sharpeningWGSL}
${muzzleLightWGSL}
${muzzleEmissionWGSL}
${sceneBrightnessWGSL}
${flashTransparencyWGSL}
${filmToneWGSL}
struct Params { blend: f32, aspect: f32, x: f32, y: f32, keyLow: f32, keyHigh: f32, opacity: f32, roll: f32, flash: vec4f, jet: vec4f, lens: vec4f, motion: vec4f, effects: vec4f, sceneLight: vec4f, photo: vec4f };
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var texA: texture_2d<f32>;
@group(0) @binding(2) var texB: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;
@group(0) @binding(4) var colorLut: texture_2d<f32>;
@group(0) @binding(5) var stableWeapon: texture_2d<f32>;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
  var corners = array<vec2f,3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var out: Vertex; out.position = vec4f(corners[i],0,1);
  out.uv = vec2f((corners[i].x+1)*.5, (1-corners[i].y)*.5); return out;
}
fn key(c: vec4f) -> vec4f {
  if (p.effects.x < .5) { return vec4f(displayToLinear(c.rgb),1); }
  let green = c.g - max(c.r,c.b);
  let alpha = 1 - smoothstep(p.keyLow,p.keyHigh,green);
  let rgb = vec3f(c.r, mix(c.g,min(c.g,max(c.r,c.b)+.025),p.effects.y), c.b);
  // Key/despill in footage display space, then filter premultiplied LINEAR taps.
  return vec4f(displayToLinear(rgb) * alpha, alpha);
}
fn applyGrade(color: vec4f) -> vec4f {
  // Shared target stays premultiplied HDR: scene compose owns tone/LUT/encoding.
  if(p.photo.z>.5){return color;}
  if (color.a <= 0) { return vec4f(0); }
  // All compositing/filtering arrives in premultiplied linear space. Even grade
  // bypass must encode straight RGB before restoring canvas premultiplication.
  var linear = color.rgb / color.a;
  if(p.photo.x>.5){linear=filmTone(linear,p.photo.y);}
  if (p.lens.y > 0) {
    let graded = sampleDisplayLut(colorLut, smp, linearToDisplay(linear));
    linear = mix(linear, displayToLinear(graded), p.lens.y);
  }
  // This canvas still composites over the separately graded world in the browser;
  // translucent edges cannot equal one nonlinear grade over a combined image.
  return vec4f(linearToDisplay(linear) * color.a, color.a);
}
fn linearKeySample(tex:texture_2d<f32>,uv:vec2f)->vec4f {
  let size=vec2i(textureDimensions(tex));
  let position=uv*vec2f(size)-.5;
  let base=vec2i(floor(position));let f=fract(position);
  // Key each source texel before filtering; never interpolate green into skin
  // or metal first. The result is premultiplied linear throughout the footprint.
  let a=key(textureLoad(tex,clamp(base,vec2i(0),size-1),0));
  let b=key(textureLoad(tex,clamp(base+vec2i(1,0),vec2i(0),size-1),0));
  let c=key(textureLoad(tex,clamp(base+vec2i(0,1),vec2i(0),size-1),0));
  let d=key(textureLoad(tex,clamp(base+vec2i(1,1),vec2i(0),size-1),0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
fn keyedSample(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
  if (any(uv < vec2f(0)) || any(uv > vec2f(1))) { return vec4f(0); }
  let keyed=linearKeySample(tex,uv);
  if(p.sceneLight.y>.5 && p.effects.x>.5) {
    let raw=textureSampleLevel(tex,smp,uv,0);
    if(p.sceneLight.w>1.5) {
      // Keep a small, feathered sight lane free of smoke and any disconnected
      // iron-sight fragments left in the source matte. Peripheral flash remains.
      let lane=(1.0-smoothstep(.012,.026,abs(uv.x-.5)))
        *(1.0-smoothstep(.035,.065,abs(uv.y-.5)));
      let base=linearKeySample(stableWeapon,uv);
      let distance=(uv-p.flash.zw)*vec2f(1672.0/941.0,1);
      // Light the solid gun before adding smoke. Lighting the combined layer
      // turns neutral translucent smoke into a broad yellow veil every shot.
      let litBase=illuminateWeapon(base,distance,p.flash.x,p.jet.w);
      return stableFiringWeapon(litBase,keyed*(1.0-lane),raw.a,p.sceneLight.z);
    }
    if(p.sceneLight.w>.5) { return cinematicMuzzle(keyed,raw.a,p.sceneLight.z); }
    return translucentMuzzle(keyed,raw.rgb,uv,p.sceneLight.z);
  }
  return keyed;
}
fn sampleWeapon(tex: texture_2d<f32>, uv: vec2f, radius: f32) -> vec4f {
  let center = keyedSample(tex,uv);
  if (radius < .05) { return center; }
  let texel = vec2f(radius) / vec2f(textureDimensions(tex));
  // Explicit DOF taps are keyed, premultiplied linear values; outside is clear.
  var color = center * 4;
  color += keyedSample(tex,uv+texel*vec2f(1,0))*2;
  color += keyedSample(tex,uv+texel*vec2f(-1,0))*2;
  color += keyedSample(tex,uv+texel*vec2f(0,1))*2;
  color += keyedSample(tex,uv+texel*vec2f(0,-1))*2;
  color += keyedSample(tex,uv+texel);
  color += keyedSample(tex,uv-texel);
  color += keyedSample(tex,uv+texel*vec2f(1,-1));
  color += keyedSample(tex,uv+texel*vec2f(-1,1));
  return color / 16;
}
${weaponZoomMotionWGSL}
fn sampleMovingWeapon(tex: texture_2d<f32>, uv: vec2f, radius: f32) -> vec4f {
  let center=sampleWeapon(tex,uv,radius);
  let ratio=p.aspect/(1672.0/941.0);
  var velocity=p.motion.xy;
  if(ratio<1) { velocity.x *= ratio; } else { velocity.y /= ratio; }
  let local=(uv-vec2f(.5,.88))*vec2f(1672.0/941.0,1);
  velocity += vec2f(-local.y/(1672.0/941.0),local.x)*p.motion.z;
  velocity += weaponZoomVelocity(uv);
  let dimensions=vec2f(textureDimensions(tex));
  let pixels=length(velocity*dimensions);
  if(pixels<.25 || p.motion.w<=0) { return center; }
  velocity *= min(1.0,p.motion.w/max(pixels,.001));
  // Every shutter position must retain DOF. Mixing sharp keyed taps here
  // replaced 60% of the lens blur as soon as motion crossed the .25px gate.
  // Both current/history frames pass through this same lens-then-motion path.
  var color=center*4;
  for(var i=1; i<=6; i++) {
    color += sampleWeapon(tex,uv+velocity*(f32(i)/6.0),radius);
  }
  return color/10;
}
fn sharpenWeapon(tex:texture_2d<f32>,uv:vec2f,amount:f32)->vec4f {
  let center=keyedSample(tex,uv);
  if(amount<=0.0 || center.a<.98) { return center; }
  let d=vec2f(1)/vec2f(textureDimensions(tex));
  let a=keyedSample(tex,uv+vec2f(d.x,0));let b=keyedSample(tex,uv-vec2f(d.x,0));
  let c=keyedSample(tex,uv+vec2f(0,d.y));let e=keyedSample(tex,uv-vec2f(0,d.y));
  // Do not sharpen the keyed silhouette or mix transparent green into metal.
  if(min(min(a.a,b.a),min(c.a,e.a))<.98) { return center; }
  let rgb=sharpenRGB(center.rgb/center.a,a.rgb/a.a,b.rgb/b.a,c.rgb/c.a,e.rgb/e.a,amount);
  return vec4f(rgb*center.a,center.a);
}
fn sampleFocusedWeapon(uv: vec2f, screenUv: vec2f) -> vec4f {
  let border=sprintBorder(screenUv);
  // The central 45% of width/height is current-frame footage: no shader DOF,
  // motion smearing or previous-frame ghosting, even while running/reloading.
  var sharp=sharpenWeapon(texA,uv,p.effects.w);
  if(p.blend>=.5) { sharp=sharpenWeapon(texB,uv,p.effects.w); }
  if(border<=0.0) { return sharp; }
  let edgeBoost=clamp(p.effects.z,0.0,1.0)*border;
  let lensRadius=p.lens.x*max(smoothstep(.60,1.0,uv.y)*(1.0+edgeBoost),edgeBoost*.45);
  var soft=sampleMovingWeapon(texA,uv,lensRadius);
  if(p.blend>0) { soft=mix(soft,sampleMovingWeapon(texB,uv,lensRadius),p.blend); }
  return mix(sharp,soft,border);
}
@fragment fn fs(input: Vertex) -> @location(0) vec4f {
  // Reload framing is in screen space, separate from the clamped bob margin.
  // Scale about bottom center so the source bottom never floats into view.
  let scale = 1.0-clamp(p.lens.z,-.8,.2);
  let anchor = vec2f(.5,1);
  var uv = (input.uv-vec2f(0,clamp(p.lens.w,0.0,.25))-anchor)/scale+anchor;
  uv -= vec2f(p.x,p.y);
  let ratio = p.aspect / (1672.0/941.0);
  if (ratio < 1) { uv.x = (uv.x-.5)*ratio+.5; }
  else { uv.y = (uv.y-1)/ratio+1; }
  // Inverse rigid rotation around the lower grip, with physical aspect correction.
  // All keyed footage and muzzle emission use these same transformed coordinates.
  let pivot = vec2f(.5,.88);
  let local = (uv-pivot)*vec2f(1672.0/941.0,1);
  let cs = cos(p.roll); let sn = sin(p.roll);
  uv = vec2f(cs*local.x+sn*local.y,-sn*local.x+cs*local.y)
    / vec2f(1672.0/941.0,1) + pivot;
  // Out-of-frame pixels are transparent, never an extended stripe of edge color.
  // The bottom framing margin keeps that source edge below the visible viewport.
  if (any(uv < vec2f(0)) || any(uv > vec2f(1))) { return vec4f(0); }
  var weapon=sampleFocusedWeapon(uv,input.uv);
  weapon *= p.opacity;
  weapon = matchSceneBrightness(weapon,p.sceneLight.x);
  if (p.flash.x <= 0) { return applyGrade(weapon); }
  // Work in footage UVs so the emitter follows the same crop, bob and recoil.
  let d = (uv - p.flash.zw) * vec2f(1672.0/941.0, 1);
  // The generated layer supplies flame/smoke only; illuminate the stable gun
  // without reintroducing a second procedural flame or a moving video receiver.
  if(p.sceneLight.w>1.5) { return applyGrade(weapon); }
  let direction = normalize(p.jet.xy);
  let q = vec2f(dot(d,vec2f(-direction.y,direction.x)),dot(d,direction)) / p.jet.z;
  var flash = muzzleEmission(q,p.flash.y,p.flash.x);
  if(abs(p.jet.x)<.1) { flash=frontalMuzzleEmission(q,p.flash.y,p.flash.x); }
  flash*=clamp(p.sceneLight.z,0.0,1.0);
  // Fire is beyond the muzzle: the opaque sight and barrel occlude it.
  // Flash palette interpolation, over-composition and local warm gain are linear.
  weapon = illuminateWeapon(weapon,d,p.flash.x,p.jet.w);
  return applyGrade(weapon + flash*(1-weapon.a));
}`;

export class WeaponLayer {
  setGradeData(data){this.device.queue.writeTexture({texture:this.gradeTexture},data,{bytesPerRow:1024,rowsPerImage:16},[256,16]);}
  async init(canvas,{graphicsDevice=null,composite=null,sceneCanvas=null}={}) {
    if (!navigator.gpu)
      throw new Error("WebGPU is required for the weapon compositor.");
    this.composite=composite;
    this.sceneCanvas=sceneCanvas;
    if(composite){this.device=graphicsDevice.wgpu;canvas.style.visibility='hidden';}
    else {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("No WebGPU adapter available.");
    this.device = await adapter.requestDevice();
    }
    this.canvas = canvas;
    const format = composite?'rgba16float':navigator.gpu.getPreferredCanvasFormat();
    if(!composite){
    this.context = canvas.getContext("webgpu");
    if (!this.context) throw new Error("WebGPU canvas unavailable.");
    this.context.configure({
      device: this.device,
      format,
      alphaMode: "premultiplied",
    });
    }
    const module = this.device.createShaderModule({ code: weaponShader });
    const diagnostics = await module.getCompilationInfo();
    const errors = diagnostics.messages.filter((m) => m.type === "error");
    if (errors.length)
      throw new Error(
        errors.map((m) => `WGSL ${m.lineNum}: ${m.message}`).join("\n"),
      );
    this.pipeline = await this.device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.sampler = this.device.createSampler({
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.uniform = this.device.createBuffer({
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gradeTexture = this.device.createTexture({
      size: [256,16], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({texture:this.gradeTexture}, createGradeLut(), {bytesPerRow:1024, rowsPerImage:16}, [256,16]);
    this.textures = {};
    this.groups = new Map();
    const files = {
      lowReady: "001-low-ready-style-v1.png",
      ads: "002-ads-v1.png",
      run: "003-run-carry-v1.png",
      noGun: "004-no-gun-v1.png",
      recoil: "006-recoil-phase-v2.png",
    };
    await Promise.all(
      Object.entries(files).map(async ([id, file]) => {
        const response = await fetchLocal(mediaUrl("/media/poses/" + file));
        if (!response.ok) throw new Error("Missing pose: " + file);
        const bitmap = await createImageBitmap(await response.blob());
        const texture = this.device.createTexture({
          size: [bitmap.width, bitmap.height],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture(
          { source: bitmap },
          { texture },
          [bitmap.width, bitmap.height],
        );
        bitmap.close();
        this.textures[id] = texture;
      }),
    );
    this.device.addEventListener("uncapturederror", (e) => {
      document.querySelector("#error").hidden = false;
      document.querySelector("#error").textContent = e.error.message;
    });
    this.device.lost.then((info) => {
      document.querySelector("#error").hidden = false;
      document.querySelector("#error").textContent =
        "Weapon GPU lost: " + info.message + ". Reload the page.";
    });
  }
  render({ from, to, blend, x = 0, y = 0, roll = 0, opacity = 1, frame = null, flash = {}, dof = 0, grade = 0, shrink = 0, lower = 0,
    motion = {}, dt = 0, motionKey = "", keyEnabled = true, keyThreshold = .14, keySoftness = .28, despill = 1, sprintSoftness = 0, sharpening = 0, sceneEV = 0,flashOpacity=.25,follow={x:0,y:0},bottomReserve=0,filmToneEnabled=true,filmToneKnee=.6 }) {
    const { canvas, device } = this;
    if (frame) {
      if (!this.textures.frame) {
        for(const name of ["frame","framePrevious","firingBase"]) this.textures[name] = device.createTexture({
          size: [frame.bitmap.width, frame.bitmap.height],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      if(frame.stableBase && this.firingBaseUrl!==frame.stableBase.url){
        device.queue.copyExternalImageToTexture({source:frame.stableBase.bitmap},
          {texture:this.textures.firingBase},[frame.stableBase.bitmap.width,frame.stableBase.bitmap.height]);
        this.firingBaseUrl=frame.stableBase.url;
      }
      if (this.frameUrl !== frame.url) {
        const consecutive=this.frameUrl && this.motionKey===motionKey && frame.index===this.frameIndex+1;
        this.historyValid=!!consecutive;
        this.historyAge=0;
        if(consecutive) {
          const copy=device.createCommandEncoder();
          copy.copyTextureToTexture({texture:this.textures.frame},{texture:this.textures.framePrevious},[frame.bitmap.width,frame.bitmap.height]);
          device.queue.submit([copy.finish()]);
        }
        device.queue.copyExternalImageToTexture(
          { source: frame.bitmap },
          { texture: this.textures.frame },
          [frame.bitmap.width, frame.bitmap.height],
        );
        this.frameUrl = frame.url;
        this.frameIndex = frame.index;
      } else {
        this.historyAge=(this.historyAge||0)+Math.max(0,dt);
      }
      if(this.motionKey!==motionKey) this.historyValid=false;
      from="frame"; to=this.historyValid?"framePrevious":"frame";
      // Only adjacent frames from one clip; fade out on held frames and ADS.
      blend=this.historyValid && dt>0 ? (motion.historyMix||0)*Math.max(0,1-this.historyAge/.042) : 0;
    } else {
      this.historyValid=false;
    }
    this.motionKey=motionKey;
    const width = this.composite?this.sceneCanvas.width:Math.round(
      canvas.clientWidth * Math.min(devicePixelRatio, 1.5),
    );
    const height = this.composite?this.sceneCanvas.height:Math.round(
      canvas.clientHeight * Math.min(devicePixelRatio, 1.5),
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.composite?.resize(width,height);
    const screen=weaponScreenOffset({x,y,roll,aspect:width/height,follow,shrink,lower,bottomReserve});
    device.queue.writeBuffer(
      this.uniform,
      0,
      new Float32Array([blend, width / height, screen.x, screen.y, keyThreshold, keyThreshold+keySoftness, opacity, roll,
        flash.strength || 0, flash.seed || 0, flash.x || 0, flash.y || 0,
        flash.dx || 0, flash.dy || -1, flash.size || .03, flash.light || 0, dof, grade, shrink, lower,
        motion.x||0,motion.y||0,motion.roll||0,motion.maxPixels||0,
        keyEnabled?1:0,despill,sprintSoftness,sharpening,sceneEV,frame?.generatedFlash?1:0,flashOpacity,frame?.stableBase?2:frame?.flashMatte?1:0,
        filmToneEnabled?1:0,filmToneKnee,this.composite?1:0,motion.zoom||0]),
    );
    const id = from + ":" + to;
    if (!this.groups.has(id))
      this.groups.set(
        id,
        device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.sampler },
            { binding: 1, resource: this.textures[from].createView() },
            { binding: 2, resource: this.textures[to].createView() },
            { binding: 3, resource: { buffer: this.uniform } },
            { binding: 4, resource: this.gradeTexture.createView() },
            { binding: 5, resource: (this.textures.firingBase??this.textures.ads).createView() },
          ],
        }),
      );
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.composite?this.composite.view():this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.groups.get(id));
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}
