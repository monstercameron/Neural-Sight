import * as pc from 'playcanvas';
// Opaque bodies enter the ordinary scene before transparent splats. Foreground
// splats blend OVER bodies, while body hardware depth rejects background splats.
// Snapshot completed scene depth only for post-splat overlays such as shadows;
// a coverage-weighted splat depth is not a valid hard occluder for opaque bodies.
export function installZombieRenderPass(app,cameraFrame,layer){
  const camera=cameraFrame.cameraComponent,device=app.graphicsDevice;
  const composition=app.scene.layers;
  // The optional engine prepass stops at the Depth layer. Put only the opaque
  // half of this layer before that boundary; transparent effects stay separate.
  const originalOpaqueIndex=composition.layerList.findIndex((l,i)=>l===layer&&!composition.subLayerList[i]);
  composition.removeOpaque(layer);
  const depthBoundary=composition.layerList.findIndex(l=>l.id===pc.LAYERID_DEPTH);
  composition.insertOpaque(layer,depthBoundary<0?0:depthBoundary);
  const addedLayer=!camera.layers.includes(layer.id);
  if(addedLayer)camera.layers=[...camera.layers,layer.id];
  const original=cameraFrame.update.bind(cameraFrame),sanitizers=new Map();let installed=null;
  let bodyPass=null,bodyStep=null,displacedFirst=null;
  function removeBodyStep(){
    if(bodyPass)bodyPass.layerRenderSteps=bodyPass.layerRenderSteps.filter(s=>s!==bodyStep);
    if(displacedFirst){Object.assign(displacedFirst.step,displacedFirst.flags);displacedFirst=null;}
    bodyPass=null;bodyStep=null;
  }
  function installBodyStep(frame){
    const pass=frame?.scenePass;
    if(!pass)return;
    const steps=pass.layerRenderSteps;
    if(steps.some(s=>s.layer===layer&&!s.transparent))return;
    let index=steps.findIndex(s=>s.transparent);
    if(index<0)index=steps.length;
    pass.addLayer(camera,layer,false,false);
    const step=steps.pop();
    // A transparent-only scene still needs its original clear/camera-start
    // ownership on the first step, not halfway through the scene.
    if(index===0&&steps[0]){
      const first=steps[0],flags={};
      for(const key of ['clearColor','clearDepth','clearStencil','firstCameraUse']){flags[key]=first[key];step[key]=first[key];first[key]=false;}
      displacedFirst={step:first,flags};
    }
    steps.splice(index,0,step);bodyPass=pass;bodyStep=step;
  }
  function requireSceneDepth(frame){
    if(!frame?.sanitizeOptions||sanitizers.has(frame))return;
    const sanitize=frame.sanitizeOptions;
    sanitizers.set(frame,sanitize);
    frame.sanitizeOptions=function(options){
      const requested=sanitize.call(this,options);
      // Occlusion needs scene depth even when the user disables visual effects.
      // Ask the engine for its supported depth configuration, without enabling
      // a TAA pass or changing the user's selected post-processing options.
      if(!requested.sceneTextureDepth&&!requested.prepassEnabled){
        const depth=sanitize.call(this,{...options,taaEnabled:true});
        if(depth.sceneTextureDepth)return {...requested,sceneTextureDepth:true};
      }
      return requested;
    };
  }
  function release(){
    if(!installed)return;
    const {frame,pass,copy,source,snapshotTarget,texture}=installed;
    frame.beforePasses=frame.beforePasses.filter(p=>p!==pass&&p!==copy);
    copy.execute=()=>{};
    pass.destroy();copy.destroy();source?.destroy();snapshotTarget.destroy();texture.destroy();installed=null;
    device.scope.resolve('zombieOcclusionDepth').setValue(null);
  }
  function install(){
    const frame=cameraFrame.renderPassCamera;
    removeBodyStep();
    for(const pass of frame?.beforePasses??[])if(pass.layerRenderSteps)pass.layerRenderSteps=pass.layerRenderSteps.filter(s=>s.layer.id!==layer.id||(!s.transparent&&pass===frame.scenePass));
    if(!frame?.rt){release();installBodyStep(frame);return;}
    const depthTexture=frame.sceneDepthTexture??frame.prePass?.linearDepthTexture;
    if(installed?.target!==frame.rt||installed?.depthTexture!==depthTexture){
      release();
      const texture=new pc.Texture(device,{name:'Completed splat depth · zombie occlusion',width:depthTexture?.width??1,height:depthTexture?.height??1,format:depthTexture?.format??pc.PIXELFORMAT_RGBA8,mipmaps:false,minFilter:pc.FILTER_NEAREST,magFilter:pc.FILTER_NEAREST});
      if(!depthTexture){texture.lock().fill(0);texture.unlock();}
      const source=depthTexture?new pc.RenderTarget({name:'Splat depth copy source',colorBuffer:depthTexture,depth:false}):null;
      const snapshotTarget=new pc.RenderTarget({name:'Splat depth snapshot',colorBuffer:texture,depth:false});
      const pass=new pc.RenderPassForward(device,app.scene.layers,app.scene,app.renderer);pass.name='Infected · after splats';pass.init(frame.rt);pass.gammaCorrection=pc.GAMMA_NONE;pass.toneMapping=pc.TONEMAP_NONE;pass.sceneTextures=frame.sceneDepthTexture?['depth']:[];pass.addLayer(camera,layer,true,false);
      const view=new pc.Mat4();
      const copy=new pc.FramePass(device);copy.name='Snapshot completed splat depth';
      copy.execute=()=>{
        // RenderTarget caches dimensions independently of its shared attachment.
        // CameraFrame resizes the attachment; refresh the copy source too, or
        // copyRenderTarget copies only its original 4 × 4 startup rectangle.
        if(source){
          const {width,height}=depthTexture;
          if(source.width!==width||source.height!==height)source.resize(width,height);
          if(texture.width!==width||texture.height!==height)snapshotTarget.resize(width,height);
          device.copyRenderTarget(source,snapshotTarget,true,false);
        }
        device.scope.resolve('zombieOcclusionDepth').setValue(texture);
        device.scope.resolve('zombieDepthEncoding').setValue(!depthTexture?-1:frame.sceneDepthTexture?0:depthTexture.format===pc.PIXELFORMAT_RGBA8?2:1);
        device.scope.resolve('zombieView').setValue(view.copy(camera.entity.getWorldTransform()).invert().data);
      };
      installed={frame,target:frame.rt,depthTexture,pass,copy,source,snapshotTarget,texture};
    }
    const pass=installed.pass;
    pass.layerRenderSteps=[];pass.addLayer(camera,layer,true,false);
    frame.beforePasses=frame.beforePasses.filter(p=>p!==pass&&p!==installed.copy);
    const after=frame.beforePasses.indexOf(frame.scenePassTransparent??frame.scenePass);
    frame.beforePasses.splice(after+1,0,installed.copy,pass);
    installBodyStep(frame);
  }
  cameraFrame.update=()=>{requireSceneDepth(cameraFrame.renderPassCamera);original();install();};cameraFrame.update();
  return ()=>{
    cameraFrame.update=original;removeBodyStep();release();
    for(const [frame,sanitize] of sanitizers){frame.sanitizeOptions=sanitize;frame.layersDirty=true;}
    sanitizers.clear();
    composition.removeOpaque(layer);
    if(originalOpaqueIndex>=0)composition.insertOpaque(layer,Math.min(originalOpaqueIndex,composition.layerList.length));
    if(addedLayer)camera.layers=camera.layers.filter(id=>id!==layer.id);
  };
}
