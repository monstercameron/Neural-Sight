// Match PlayCanvas 2.22's gamma-2.2 scene/output convention. LUT entries are
// display values in raw UNORM: interpolate first, decode only the result.
export const displayColorWGSL = `
fn displayToLinear(color: vec3f) -> vec3f {
  return pow(max(color, vec3f(0)), vec3f(2.2));
}
fn linearToDisplay(color: vec3f) -> vec3f {
  return pow(max(color, vec3f(0)), vec3f(1.0 / 2.2));
}
fn sampleDisplayLut(lut: texture_2d<f32>, smp: sampler, color: vec3f) -> vec3f {
  let c = clamp(color, vec3f(0), vec3f(1));
  let slice = c.b * 15.0;
  let uv = vec2f((c.r * 15.0 + .5) / 256.0, (c.g * 15.0 + .5) / 16.0);
  let lo = textureSampleLevel(lut, smp, uv + vec2f(floor(slice) / 16.0, 0), 0).rgb;
  let hi = textureSampleLevel(lut, smp, uv + vec2f(ceil(slice) / 16.0, 0), 0).rgb;
  return mix(lo, hi, fract(slice));
}
`;

export const composeColorLutWGSL = `
#ifdef COLOR_LUT
${displayColorWGSL}
uniform colorLUTParams: vec3f;
var colorLUT: texture_2d<f32>;
var colorLUTSampler: sampler;
#ifdef COLOR_LUT2
var colorLUT2: texture_2d<f32>;
var colorLUT2Sampler: sampler;
#endif
fn applyColorLUT(color: vec3f) -> vec3f {
  let coord = linearToDisplay(color);
  let lut1 = displayToLinear(sampleDisplayLut(colorLUT, colorLUTSampler, coord));
  #ifdef COLOR_LUT2
    let lut2 = displayToLinear(sampleDisplayLut(colorLUT2, colorLUT2Sampler, coord));
    let w1 = uniform.colorLUTParams.x * (1.0 - uniform.colorLUTParams.z);
    let w2 = uniform.colorLUTParams.y * uniform.colorLUTParams.z;
    return color + (lut1 - color) * w1 + (lut2 - color) * w2;
  #else
    return mix(color, lut1, uniform.colorLUTParams.x);
  #endif
}
#endif
`;

// The world renderer can fall back to WebGL2; its compose chunk uses GLSL.
export const composeColorLutGLSL = `
#ifdef COLOR_LUT
uniform vec3 colorLUTParams;
uniform sampler2D colorLUT;
#ifdef COLOR_LUT2
uniform sampler2D colorLUT2;
#endif
vec3 sampleDisplayLut(sampler2D lut, vec3 color) {
  vec3 c = clamp(color, 0.0, 1.0);
  float slice = c.b * 15.0;
  vec2 uv = vec2((c.r * 15.0 + .5) / 256.0, (c.g * 15.0 + .5) / 16.0);
  vec3 lo = texture2DLod(lut, uv + vec2(floor(slice) / 16.0, 0.0), 0.0).rgb;
  vec3 hi = texture2DLod(lut, uv + vec2(ceil(slice) / 16.0, 0.0), 0.0).rgb;
  return mix(lo, hi, fract(slice));
}
vec3 applyColorLUT(vec3 color) {
  vec3 coord = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 lut1 = pow(max(sampleDisplayLut(colorLUT, coord), vec3(0.0)), vec3(2.2));
  #ifdef COLOR_LUT2
    vec3 lut2 = pow(max(sampleDisplayLut(colorLUT2, coord), vec3(0.0)), vec3(2.2));
    float w1 = colorLUTParams.x * (1.0 - colorLUTParams.z);
    float w2 = colorLUTParams.y * colorLUTParams.z;
    return color + (lut1 - color) * w1 + (lut2 - color) * w2;
  #else
    return mix(color, lut1, colorLUTParams.x);
  #endif
}
#endif
`;

export function installDisplayLutChunks(pc, device) {
  // Install BEFORE CameraFrame construction / shader compilation. Its constructor
  // adds defaults with override=false, preserving these device-local chunks.
  // PlayCanvas's debug-only sRGB LUT warning describes the STOCK chunk contract;
  // our replacement deliberately requires raw UNORM for display interpolation.
  pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_WGSL).set('composeColorLutPS', composeColorLutWGSL);
  pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL).set('composeColorLutPS', composeColorLutGLSL);
}
