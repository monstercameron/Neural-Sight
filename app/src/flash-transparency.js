// Native firing frames carry a soft, per-frame weapon-protection matte in alpha.
// This separates smoke/flame from solid gun material before spatial/temporal blur.
// Keep the old color-key fallback for legacy RGB-only firing assets.
export const flashTransparencyWGSL=`
fn cinematicMuzzle(color:vec4f,packedProtection:f32,opacity:f32)->vec4f {
  if(color.a<=0.0){return color;}
  let solid=clamp((packedProtection-.25)/.75,0.0,1.0);
  let c=color.rgb/color.a;
  let luma=dot(c,vec3f(.2126,.7152,.0722));
  let orange=smoothstep(.22,.38,c.r-c.g)*smoothstep(.06,.25,c.r-c.b);
  let white=smoothstep(.7,.95,min(c.r,min(c.g,c.b)));
  // Preserve genuinely hot white/orange cores, not dim mustard spill merely
  // because red exceeds blue. Source greenscreen glow otherwise reads as ochre.
  let hot=max(orange,white)*smoothstep(.5,.85,max(c.r,max(c.g,c.b)));
  // Green-screen contamination in generated smoke must not become a yellow
  // veil. Neutralize only the effect matte; preserve filmed material exactly.
  let smoke=mix(vec3f(luma),c,hot);
  let alpha=color.a*clamp(opacity,0.0,1.0)*mix(.3,1.0,hot);
  return mix(vec4f(smoke*alpha,alpha),color,solid);
}
fn stableFiringWeapon(base:vec4f,filmed:vec4f,packedProtection:f32,opacity:f32)->vec4f {
  let solid=clamp((packedProtection-.25)/.75,0.0,1.0);
  // Stabilized firing must use the same effect cleanup as the moving matte.
  let effect=cinematicMuzzle(filmed,.25,opacity)*(1.0-solid);
  // The fixed canonical sight occludes the effect, not the moving filmed gun.
  return base+effect*(1.0-base.a);
}
fn matteMuzzle(color:vec4f,packedProtection:f32,opacity:f32)->vec4f {
  let solid=clamp((packedProtection-.25)/.75,0.0,1.0);
  return color*mix(clamp(opacity,0.0,1.0),1.0,solid);
}
fn translucentMuzzle(color:vec4f,encoded:vec3f,uv:vec2f,opacity:f32)->vec4f {
  let horizontal=1.0-smoothstep(.16,.25,abs(uv.x-.5));
  let aboveBarrel=1.0-smoothstep(.445,.475,uv.y);
  let warm=smoothstep(.65,.85,encoded.r)*smoothstep(.4,.7,encoded.g)
    *(1.0-smoothstep(.02,.16,encoded.g-encoded.r));
  let white=smoothstep(.8,.94,min(encoded.r,min(encoded.g,encoded.b)));
  let mask=max(warm,white)*horizontal*aboveBarrel;
  // Scale premultiplied RGB together with alpha: actually reveal the scene,
  // rather than merely dimming an opaque flame or leaving additive white glare.
  return color*mix(1.0,clamp(opacity,0.0,1.0),mask);
}`;
