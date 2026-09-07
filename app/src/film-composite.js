// PlayCanvas 2.22 integration: one premultiplied LINEAR composite before tone/LUT.
// The engine owns the target; the weapon renderer uses the same WebGPU device.
export const linearOverWGSL=`
fn filmOver(world:vec3f,weapon:vec4f)->vec3f {
  return weapon.rgb+world*(1.0-clamp(weapon.a,0.0,1.0));
}`;
export function installFilmComposite(pc,device) {
  if(!device.wgpu)return null; // Preserve the existing WebGL-world fallback.
  const chunks=pc.ShaderChunks.get(device,pc.SHADERLANGUAGE_WGSL);
  const source=chunks.get('composePS'),anchor='result = toneMap(max(vec3f(0.0), result));';
  if(!source?.includes(anchor))throw Error('Film composite: engine tone-map hook changed');
  chunks.set('composeDeclarationsPS',chunks.get('composeDeclarationsPS')+`
    var filmWeapon: texture_2d<f32>;
    var filmWeaponSampler: sampler;
    ${linearOverWGSL}
  `);
  chunks.set('composePS',source.replace(anchor,`
    // Native top-left texture coordinates; uv includes the target flip already.
    let weapon = textureSampleLevel(filmWeapon,filmWeaponSampler,uv,0.0);
    result = filmOver(result,weapon);
    ${anchor}`));
  const texture=new pc.Texture(device,{name:'Film · linear premultiplied weapon',
    width:1,height:1,format:pc.PIXELFORMAT_RGBA16F,mipmaps:false,
    minFilter:pc.FILTER_LINEAR,magFilter:pc.FILTER_LINEAR,
    addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE});
  const binding=device.scope.resolve('filmWeapon');
  binding.setValue(texture);
  return {
    texture,
    resize(width,height){texture.resize(Math.max(1,width),Math.max(1,height));binding.setValue(texture);},
    view(){return texture.impl.gpuTexture.createView();},
    destroy(){texture.destroy();}
  };
}
