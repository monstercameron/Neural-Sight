// Screen-space only. Anchors are measured in the source footage's normalized UVs.
import {HIP_MUZZLE} from './hip-pose.js';
export const MUZZLES = {
  lowReady: {x: 602 / 1280, y: 431 / 720, dx: -.87, dy: -.49, size: .033},
  ads: {x: 641 / 1280, y: 376 / 720, dx: 0, dy: -1, size: .026},
};
MUZZLES.hipFire = HIP_MUZZLE;
// Broad reflected light on keyed footage, independent of flame size. Linear,
// alpha-preserving and bounded, so bright highlights roll off instead of clipping.
export const muzzleLightWGSL = `
fn illuminateWeapon(weapon:vec4f, distance:vec2f, pulse:f32, amount:f32)->vec4f {
  if(weapon.a<=0.0 || pulse<=0.0 || amount<=0.0) { return weapon; }
  let energy=clamp(pulse,0.0,4.0)*clamp(amount,0.0,3.0)*
    exp(-dot(distance,distance)/.025);
  let straight=clamp(weapon.rgb/weapon.a,vec3f(0),vec3f(1));
  // Albedo-weighted gain retains dark metal/glove texture instead of replacing
  // every pixel with the same pale emission. Rational shoulder preserves whites.
  let gain=vec3f(1)+energy*vec3f(2.8,1.8,.9);
  let lit=straight*gain/(vec3f(1)+straight*(gain-vec3f(1)));
  return vec4f(lit*weapon.a,weapon.a);
}
`;
export const muzzleEmissionWGSL = `
fn frontalMuzzleEmission(q:vec2f,seed:f32,pulse:f32)->vec4f {
  if(pulse<=0.0) { return vec4f(0); }
  // Looking along the bore foreshortens the jet into unequal radial lobes.
  // It remains behind the actual sight silhouette; no opaque overlay on sights.
  let v=q-vec2f(0,.18);
  let angle=atan2(v.y,v.x);
  let radius=length(v);
  let edge=.76+.16*cos(angle*3.0+seed)+.09*sin(angle*5.0-seed);
  let body=1.0-smoothstep(edge*.32,edge,radius);
  let core=exp(-radius*radius*7.0);
  let hot=smoothstep(.22,.85,core);
  let radiance=mix(vec3f(1.2,.30,.035),vec3f(14,11,7),hot);
  let color=vec3f(1)-exp(-radiance*pulse);
  let alpha=clamp((body*.60+core)*min(pulse,1.0),0.0,1.0);
  return vec4f(color*alpha,alpha);
}
fn muzzleEmission(q:vec2f,seed:f32,pulse:f32)->vec4f {
  if(pulse<=0.0) { return vec4f(0); }
  // Narrow root at the barrel mouth; flame expands only in the bore direction.
  let along=max(q.y,0.0);
  let jitter=(sin(q.y*13.0+seed)*.025+sin(q.y*27.0-seed)*.01)*smoothstep(.08,.45,along);
  let width=.05+.17*sin(clamp(along/1.65,0.0,1.0)*3.14159);
  let taper=1.0-smoothstep(.55,1.65,along);
  let forward=smoothstep(-.055,.025,q.y);
  let body=(1.0-smoothstep(width*.38,width,abs(q.x+jitter)))*taper*forward;
  let core=exp(-q.x*q.x*320.0)*exp(-pow((q.y-.15)*4.2,2.0))*forward;
  let forkSide=select(-1.0,1.0,sin(seed)>0.0);
  let fork=exp(-pow((q.x-forkSide*along*.22)*20.0,2.0))*
    (1.0-smoothstep(.65,1.18,along))*smoothstep(.25,.45,along)*.42;
  let halo=exp(-dot(q-vec2f(0,.25),q-vec2f(0,.25))*4.0)*.035;
  let hot=smoothstep(.35,.95,core);
  let radiance=mix(vec3f(1.2,.30,.035),vec3f(14,11,7),hot);
  // Brightness changes emitted energy, not just the opacity of orange haze.
  let color=vec3f(1)-exp(-radiance*max(pulse,0.0));
  let alpha=clamp((body*.70+core+fork)*min(pulse,1.0)+halo*min(pulse,2.0),0.0,1.0);
  return vec4f(color*alpha,alpha);
}
`;
export class MuzzleFlash {
  constructor() { this.reset(); }
  reset() { this.shots = 0; this.age = Infinity; this.seed = 0; }
  update(shots, dt, pose, enabled = true, duration = .05) {
    if (shots < this.shots) this.reset();
    if (shots > this.shots) { this.age = 0; this.seed = shots * 2.399963; }
    else this.age += Math.max(0, dt);
    this.shots = shots;
    duration=Math.max(.015,Math.min(.12,duration));
    const strength = enabled && MUZZLES[pose] && this.age < duration
      ? Math.pow(1 - this.age / duration, 1.5) : 0;
    return {strength, seed: this.seed, ...(MUZZLES[pose] || MUZZLES.lowReady)};
  }
}
