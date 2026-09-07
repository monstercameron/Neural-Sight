import {weaponScreenOffset} from './weapon-layer.js';
import {HIP_SIGHT} from './hip-pose.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unit = v => {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-9 && Number.isFinite(length)
    ? {x:v.x/length, y:v.y/length, z:v.z/length} : null;
};
export function shotNoise(id, salt) {
  let n = Math.imul(id ^ salt, 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

// Forward counterpart of the weapon WGSL UV transform. This is the visible
// front-sight tip, including crop, roll, bottom margin and reload recovery.
export function sightScreenPoint({aspect=16/9, x=0, y=0, roll=0, shrink=0, lower=0, follow={x:0,y:0}, bottomReserve=0, u=640/1280, v=361/720}={}) {
  const nativeAspect = 1672/941, ratio = aspect/nativeAspect;
  // Measured on raising/0033.webp: sight tip, not the lower muzzle-flash anchor.
  const lx = (u-.5)*nativeAspect, ly = v-.88;
  let sx = (Math.cos(roll)*lx-Math.sin(roll)*ly)/nativeAspect+.5;
  let sy = Math.sin(roll)*lx+Math.cos(roll)*ly+.88;
  if (ratio < 1) sx = (sx-.5)/ratio+.5;
  else sy = (sy-1)*ratio+1;
  const screen=weaponScreenOffset({x,y,roll,aspect,follow,shrink,lower,bottomReserve});
  sx += screen.x; sy += screen.y;
  const scale = 1-clamp(shrink, -.8, .2);
  return {x:(sx-.5)*scale+.5, y:(sy-1)*scale+1+clamp(lower,0,.25)};
}

export function shotScreenPoint({stance, shot, fov=75, aspect=16/9, hipChaos=2.2, ...pose}) {
  if (stance === 'ads') return sightScreenPoint({aspect, ...pose});
  // Spread follows the filmed sight through the same crop, scale, roll and
  // head-lead transform used to draw the gun, not a hard-coded screen centre.
  const centre=sightScreenPoint({aspect,...pose,...HIP_SIGHT});
  const cone = (1.25 * clamp(hipChaos,1,3))*Math.PI/180;
  const radius = Math.sqrt(shotNoise(shot,0x9213))*Math.tan(cone);
  const angle = shotNoise(shot,0x4627)*Math.PI*2;
  const projection = 2*Math.tan(fov*Math.PI/360);
  return {x:centre.x+Math.cos(angle)*radius/(projection*aspect),
    y:centre.y+Math.sin(angle)*radius/projection};
}

// Uses the published voxel surface in world coordinates, not the splat entity's
// render-space rotation. Free-fly only disables player movement collision.
export function raycastVoxel(voxel, origin, direction, maxDistance=250) {
  const d = unit(direction);
  if (!voxel || !d || ![origin.x,origin.y,origin.z,maxDistance].every(Number.isFinite) || maxDistance<=0) return null;
  const p = voxel.queryRay(origin.x,origin.y,origin.z,d.x,d.y,d.z,maxDistance);
  if (!p) return null;
  const point = {x:p.x,y:p.y,z:p.z};
  const distance = Math.hypot(point.x-origin.x,point.y-origin.y,point.z-origin.z);
  if (!Number.isFinite(distance) || distance > maxDistance+1e-5) return null;
  const n = voxel.querySurfaceNormal(point.x,point.y,point.z,d.x,d.y,d.z);
  const normal = unit({x:n.nx,y:n.ny,z:n.nz}) || {x:-d.x,y:-d.y,z:-d.z};
  if (normal.x*d.x+normal.y*d.y+normal.z*d.z > 0) {
    normal.x *= -1; normal.y *= -1; normal.z *= -1;
  }
  return {point,normal,distance};
}

export class Ballistics {
  constructor({maxDistance=250, historyLimit=128}={}) {
    this.maxDistance=maxDistance; this.historyLimit=historyLimit; this.reset();
  }
  reset() { this.shots=0; this.hits=0; this.history=[]; this.last=null; }
  update({shots,active=true,makeRay,raycast,onHit=()=>{}}) {
    if (shots < this.shots) this.reset();
    if (!active) { this.shots=shots; return; }
    for (let id=this.shots+1; id<=shots; id++) {
      const ray=makeRay(id), direction=unit(ray.direction);
      if (!direction) continue;
      const origin={...ray.origin}, hit=raycast(origin,direction,this.maxDistance);
      const record={id,origin,direction,hit,screen:ray.screen,
        end:hit ? {...hit.point} : {
          x:origin.x+direction.x*this.maxDistance,
          y:origin.y+direction.y*this.maxDistance,
          z:origin.z+direction.z*this.maxDistance,
        }};
      this.last=record; this.history.push(record);
      if (this.history.length>this.historyLimit) this.history.shift();
      if (hit) { this.hits++; onHit(record); }
    }
    this.shots=shots;
  }
}
