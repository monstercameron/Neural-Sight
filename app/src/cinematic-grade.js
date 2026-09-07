// One display-space grade, shared by the scene and keyed footage via a tiny LUT.
const clamp = x => Math.max(0, Math.min(1, x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function gradeColor(rgb,{blueCompression=.14,midtoneSoftness=0,shadowSeparation=.024,filmPrint=0}={}) {
  const input = rgb.map(clamp);
  const luma = input[0]*.2126 + input[1]*.7152 + input[2]*.0722;
  // Natural daylight print: neutral dense toe, restrained mids, soft shoulder.
  // Curve luminance once, not each channel independently (which skews hues).
  const s = luma*luma*(3-2*luma);
  // Gently reduce midtone contrast, not spatial detail. Preserve deep blacks,
  // upper highlight density and the .5 pivot; feather both ends to avoid bands.
  const softness=Math.max(0,Math.min(.35,Number(midtoneSoftness)||0));
  const window=smooth(.12,.28,luma)*(1-smooth(.72,.9,luma));
  const shadow=Math.max(0,Math.min(.04,Number(shadowSeparation)||0));
  // Open filmed shadow detail without raising the black floor or altering mids.
  // Both ends are feathered; no lift of empty/transparent pixels is introduced.
  const toe=shadow*smooth(0,.06,luma)*(1-smooth(.12,.3,luma));
  const stock=clamp(Number(filmPrint)||0);
  const density = .003 + .967*(.55*luma+.45*s+softness*(luma-s)*window+.06*stock*(s-luma)) - .018*Math.sin(Math.PI*luma)+toe;
  const green = clamp((input[1]-Math.max(input[0],input[2]))*4);
  const blue = clamp((input[2]-Math.max(input[0],input[1]))*3);
  // Restrain blue-dominant sky chroma without darkening luminance or tinting
  // neutral metal/skin/earth. Zero preserves the preceding print palette.
  const blueTrim=Math.max(0,Math.min(.35,Number(blueCompression)||0));
  const saturation = .93 - .15*green - (.06+blueTrim)*blue - .1*luma**4;
  const chroma = input.map(c => (c-luma)*saturation);
  // Small olive bias only on genuinely green material; gray metal stays gray.
  const olive = green * .014 * Math.sin(Math.PI*luma);
  chroma[0] += olive;
  chroma[2] -= olive;
  // Reference-driven daylight print: warm upper mids and restrained blue skies.
  // Feather at black/white and remove the tint's luminance component, so the
  // palette does not double as an exposure shift. Zero exactly restores baseline.
  const printWindow=Math.sin(Math.PI*luma);
  const warm=smooth(.18,.65,luma)*printWindow*stock;
  const cool=(1-smooth(.08,.35,luma))*printWindow*stock;
  const tint=[.08*warm-.008*cool-.008*blue*stock,
    .012*warm+.004*cool+.03*blue*stock,
    -.085*warm+.012*cool-.023*blue*stock];
  const tintLuma=tint[0]*.2126+tint[1]*.7152+tint[2]*.0722;
  for(let i=0;i<3;i++)chroma[i]+=tint[i]-tintLuma;
  // Compress chroma together at gamut boundaries, retaining color direction.
  let gamut = 1;
  for (const c of chroma) {
    if (c > 0) gamut = Math.min(gamut,(1-density)/c);
    if (c < 0) gamut = Math.min(gamut,density/-c);
  }
  return chroma.map(c => clamp(density+c*gamut));
}
export function gradeAmount(enabled, value) {
  return enabled ? clamp(Number(value) || 0) : 0;
}
export function createGradeLut(settings) {
  // PlayCanvas/Unreal layout: 16 blue slices, red along X, green along Y.
  const data = new Uint8Array(256*16*4);
  for (let g=0; g<16; g++) for (let b=0; b<16; b++) for (let r=0; r<16; r++) {
    const index = (g*256+b*16+r)*4;
    const color = gradeColor([r/15,g/15,b/15],settings);
    data.set([...color.map(c=>Math.round(c*255)),255],index);
  }
  return data;
}
