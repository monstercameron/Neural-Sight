import * as pc from 'playcanvas';
// Opaque characters participate in ordinary hardware depth. Post-scene shadow
// overlays retain a separate depth guard; they do not share body compositing.
export function zombieMaterial(source,depthSupported,{overlay=false}={}){
  const m=source.clone();m.name='Infected · scene-lit depth-aware';m.diffuse.set(1,1,1);m.metalness=0;
  // glTF imports roughness into gloss with glossInvert=true. Explicitly select
  // gloss semantics before tuning, or .08 becomes a polished roughness of .08.
  m.glossInvert=false;m.gloss=.08;m.useMetalness=true;
  // Bodies are opaque and render BEFORE blended splats. Their hardware depth
  // rejects background splats; foreground splats retain their real coverage.
  // Only post-scene overlays (contact shadows) need the snapshot depth guard.
  m.blendType=overlay?pc.BLEND_NORMAL:pc.BLEND_NONE;m.opacity=1;m.depthWrite=true;m.sceneTexturesWrite=true;m.useLighting=true;
  if(depthSupported&&overlay){
    const guard='#if !defined(PREPASS_PASS) && !defined(SHADOW_PASS) && !defined(PICK_PASS)\n';
    m.shaderChunks.wgsl.set('litUserDeclarationPS',guard+'var zombieOcclusionDepth: texture_2d<uff>;\nuniform zombieView: mat4x4f;\nuniform zombieDepthEncoding: f32;\n#endif');
    m.shaderChunks.wgsl.set('litUserMainStartPS',guard+`let zombieSize = textureDimensions(zombieOcclusionDepth, 0);
      let zombiePixel = clamp(vec2i(pcPosition.xy), vec2i(0), vec2i(zombieSize) - vec2i(1));
      let zombieDepthSample = textureLoad(zombieOcclusionDepth, zombiePixel, 0);
      let zombieInvDepth = zombieDepthSample.r;
      var zombieSurface = select(1e20, 1.0 / max(zombieInvDepth, 1e-20), zombieInvDepth > 0.0);
      if (uniform.zombieDepthEncoding > 0.5) { zombieSurface = zombieDepthSample.r; }
      if (uniform.zombieDepthEncoding > 1.5) {
        let bytes = vec4u(round(zombieDepthSample * 255.0));
        zombieSurface = bitcast<f32>((bytes.r << 24u) | (bytes.g << 16u) | (bytes.b << 8u) | bytes.a);
      }
      let zombieDistance = -(uniform.zombieView * vec4f(vPositionW, 1.0)).z;
      if (uniform.zombieDepthEncoding >= 0.0 && zombieDistance > zombieSurface + 0.09) { discard; }
      #endif`);
    m.shaderChunks.glsl.set('litUserDeclarationPS',guard+'uniform highp sampler2D zombieOcclusionDepth;\nuniform mat4 zombieView;\nuniform float zombieDepthEncoding;\n#endif');
    m.shaderChunks.glsl.set('litUserMainStartPS',guard+`ivec2 zombiePixel = clamp(ivec2(gl_FragCoord.xy), ivec2(0), textureSize(zombieOcclusionDepth, 0) - ivec2(1));
      vec4 zombieDepthSample = texelFetch(zombieOcclusionDepth, zombiePixel, 0);
      float zombieInvDepth = zombieDepthSample.r;
      float zombieSurface = zombieInvDepth > 0.0 ? 1.0 / zombieInvDepth : 1e20;
      if (zombieDepthEncoding > 0.5) zombieSurface = zombieDepthSample.r;
      if (zombieDepthEncoding > 1.5) {
        uvec4 bytes = uvec4(round(zombieDepthSample * 255.0));
        zombieSurface = uintBitsToFloat((bytes.r << 24u) | (bytes.g << 16u) | (bytes.b << 8u) | bytes.a);
      }
      float zombieDistance = -(zombieView * vec4(vPositionW, 1.0)).z;
      if (zombieDepthEncoding >= 0.0 && zombieDistance > zombieSurface + 0.09) discard;
      #endif`);
  }
  m.update();return m;
}
