import * as pc from 'playcanvas';
import {shotNoise} from './ballistics.js';

export function impactEnvelope(age) {
  return {mark:Math.max(0,Math.min(1,(12-age)/2)),
    dust:Math.max(0,1-age/.65)**2, chips:Math.max(0,1-age/.4)};
}

export function impactVisible(voxel,eye,point) {
  if(!voxel)return true;
  const x=point.x-eye.x,y=point.y-eye.y,z=point.z-eye.z;
  const distance=Math.hypot(x,y,z);
  // Ignore the small surface-proxy bias, not intervening walls.
  return distance<=.12 || !voxel.queryRay(eye.x,eye.y,eye.z,x/distance,y/distance,z/distance,distance-.12);
}

// Small procedural textures; no image generation, external assets or per-hit
// texture allocation. All effects are ordinary depth-tested world geometry.
function texture(device, dust) {
  const size=64, data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const dx=(x+ .5-size/2)/(size/2),dy=(y+.5-size/2)/(size/2);
    const r=Math.hypot(dx,dy), theta=Math.atan2(dy,dx);
    const edge=1+.12*Math.sin(theta*7)+.07*Math.sin(theta*13);
    const grain=.75+.25*shotNoise(y*size+x,313);
    const alpha=dust ? Math.exp(-r*r*5)*Math.max(0,1-r)*grain :
      Math.max(0,1-r/edge)**1.3*grain;
    const color=dust ? 190 : r<.25 ? 25 : 92;
    const i=(y*size+x)*4;
    data[i]=color;data[i+1]=dust?178:color;data[i+2]=dust?156:color;
    data[i+3]=Math.round(alpha*255);
  }
  const t=new pc.Texture(device,{name:dust?'Impact dust':'Impact scuff',width:size,height:size,
    format:pc.PIXELFORMAT_RGBA8,srgb:true,mipmaps:false,
    minFilter:pc.FILTER_LINEAR,magFilter:pc.FILTER_LINEAR,
    addressU:pc.ADDRESS_CLAMP_TO_EDGE,addressV:pc.ADDRESS_CLAMP_TO_EDGE});
  t.lock().set(data);t.unlock();return t;
}

export class BulletImpacts {
  constructor(app, capacity=24) {
    this.app=app; this.cursor=0;
    this.textures=[texture(app.graphicsDevice,false),texture(app.graphicsDevice,true)];
    this.root=new pc.Entity('Bullet impacts · world-space pool');app.root.addChild(this.root);
    const create=(name,tex,type='plane')=>{
      const material=new pc.StandardMaterial();
      material.useLighting=false;material.diffuse=new pc.Color(0,0,0);
      material.emissive=new pc.Color(tex?1:.28,tex?1:.25,tex?1:.21);
      if(tex) {material.emissiveMap=tex;material.opacityMap=tex;material.opacityMapChannel='a';}
      material.blendType=pc.BLEND_NORMAL;material.depthWrite=false;
      material.depthTest=true;material.cull=pc.CULLFACE_NONE;material.update();
      const entity=new pc.Entity(name);
      // Unified splats are a single transparent draw: sharing World lets its
      // bounds sort over small impact quads. Immediate still precedes film/DOF.
      entity.addComponent('render',{type,material,layers:[pc.LAYERID_IMMEDIATE],
        castShadows:false,receiveShadows:false});
      entity.enabled=false;this.root.addChild(entity);
      return {entity,material};
    };
    this.slots=Array.from({length:capacity},()=>({age:Infinity,
      mark:create('Surface scuff',this.textures[0]),
      dust:create('Dust puff',this.textures[1]),
      chips:Array.from({length:3},()=>create('Impact fragment',null,'box')),
    }));
  }
  reset() {
    for(const slot of this.slots) {
      slot.age=Infinity;
      for(const item of [slot.mark,slot.dust,...slot.chips])item.entity.enabled=false;
    }
    this.cursor=0;
  }
  spawn({id,hit}) {
    const s=this.slots[this.cursor++%this.slots.length];s.age=0;s.visibilityClock=0;s.visible=true;
    const {point,normal}=hit;
    s.point=new pc.Vec3(point.x,point.y,point.z);
    s.normal=new pc.Vec3(normal.x,normal.y,normal.z);
    // About one voxel outward keeps the proxy mark above irregular splat depth.
    s.origin=s.point.clone().add(s.normal.clone().mulScalar(.055));
    s.mark.entity.setPosition(s.origin);
    s.mark.entity.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP,s.normal));
    s.mark.entity.rotateLocal(0,shotNoise(id,612)*360,0);
    s.size=.13+shotNoise(id,412)*.05;
    s.mark.entity.setLocalScale(s.size,1,s.size);
    s.velocities=s.chips.map((_,i)=>new pc.Vec3(
      normal.x*(.7+i*.2)+(shotNoise(id,812+i)-.5)*1.6,
      normal.y*(.7+i*.2)+.5+shotNoise(id,912+i)*.8,
      normal.z*(.7+i*.2)+(shotNoise(id,712+i)-.5)*1.6));
  }
  update(dt,camera,enabled=true,voxel=null) {
    this.root.enabled=enabled;
    for(const s of this.slots) {
      if(!Number.isFinite(s.age))continue;
      s.age+=Math.max(0,dt);
      // Splat scene-depth for DOF is not necessarily hardware depth. Retest
      // visibility against the authoritative solid grid at a bounded 10 Hz.
      s.visibilityClock-=Math.max(0,dt);
      if(voxel && s.visibilityClock<=0) {
        s.visibilityClock=.1;
        s.visible=impactVisible(voxel,camera.getPosition(),s.origin);
      }
      const envelope=impactEnvelope(s.age);
      for(const [item,opacity] of [[s.mark,envelope.mark],[s.dust,envelope.dust]]) {
        item.entity.enabled=opacity>0 && s.visible;
        item.material.opacity=opacity;item.material.update();
      }
      if(envelope.dust>0) {
        const p=s.origin.clone().add(s.normal.clone().mulScalar(s.age*.22));p.y+=s.age*.12;
        s.dust.entity.setPosition(p);
        const toEye=camera.getPosition().clone().sub(p).normalize();
        s.dust.entity.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP,toEye));
        const size=.12+s.age*.8;s.dust.entity.setLocalScale(size,1,size);
      }
      s.chips.forEach((chip,i)=>{
        chip.entity.enabled=envelope.chips>0 && s.visible;
        if(!chip.entity.enabled)return;
        const p=s.origin.clone().add(s.velocities[i].clone().mulScalar(s.age));
        p.y-=2.8*s.age*s.age;chip.entity.setPosition(p);
        chip.entity.setLocalScale(.012,.018,.009);
        chip.entity.setEulerAngles(s.age*300+i*67,s.age*180,25+i*37);
        chip.material.opacity=envelope.chips;chip.material.update();
      });
      if(s.age>=12)s.age=Infinity;
    }
  }
  destroy() {
    this.root.destroy();
    for(const s of this.slots)for(const item of [s.mark,s.dust,...s.chips])item.material.destroy();
    for(const t of this.textures)t.destroy();
  }
}
