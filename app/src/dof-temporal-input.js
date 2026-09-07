// PlayCanvas 2.22's downsample setter updates _sourceTexture while execute()
// samples sourceTexture. Bind both explicitly after the camera pass advances
// TAA's ping-pong index, before child passes resize or execute.
function bind(pass, texture) {
  if(!pass||!texture)return;
  pass.sourceTexture=texture;
  pass._sourceTexture=texture;
  pass.options.resizeSource=texture;
}
export function bindDofTemporalInput(pass, enabled) {
  const raw=pass.sceneTexture, dof=pass.dofPass;
  const resolved=enabled&&dof&&pass.taaPass ? pass.composePass?.sceneTexture : raw;
  if(!raw||!resolved)return 'unavailable';
  bind(pass.scenePassHalf,resolved);
  if(dof)bind(dof.farPass,dof.highQuality?resolved:pass.sceneTextureHalf);
  return resolved===raw?'current frame':'TAA-resolved';
}
export function attachDofTemporalInput(cameraFrame, getEnabled) {
  const pass=cameraFrame.renderPassCamera;
  if(!pass||pass.neuralDofInput)return false;
  const original=pass.frameUpdate.bind(pass);
  pass.neuralDofInput={source:'pending'};
  pass.frameUpdate=()=>{
    original();
    pass.neuralDofInput.source=bindDofTemporalInput(pass,getEnabled());
  };
  return true;
}
