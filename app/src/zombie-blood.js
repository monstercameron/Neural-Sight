import * as pc from 'playcanvas';
import {impactVisible} from './bullet-impacts.js';
import {bloodTextureData} from './zombie-blood-texture.js';
export class ZombieBlood {
  constructor(app,layerId=pc.LAYERID_IMMEDIATE){
    this.root=new pc.Entity('Blood · bounded world-space pool');app.root.addChild(this.root);this.cursor=0;
    this.textures=Array.from({length:8},(_,i)=>{const texture=new pc.Texture(app.graphicsDevice,{name:'Blood stain '+i,width:64,height:64,format:pc.PIXELFORMAT_RGBA8,srgb:true,mipmaps:false});texture.lock().set(bloodTextureData(i));texture.unlock();return texture;});
    this.slots=Array.from({length:80},(_,i)=>{const material=new pc.StandardMaterial();material.useLighting=false;material.diffuse.set(0,0,0);material.emissive.set(1,1,1);material.emissiveMap=this.textures[i%8];material.opacityMap=this.textures[i%8];material.opacityMapChannel='a';material.blendType=pc.BLEND_NORMAL;material.depthWrite=false;material.cull=pc.CULLFACE_NONE;material.update();
      const entity=new pc.Entity('Blood droplet / anchored stain');entity.addComponent('render',{type:'plane',material,layers:[layerId],castShadows:false});entity.enabled=false;this.root.addChild(entity);return {entity,material,age:Infinity};});
  }
  spawn(point,direction){
    for(let i=0;i<8;i++){
      const s=this.slots[this.cursor++%this.slots.length];s.age=0;s.p=new pc.Vec3(point.x,point.y,point.z);s.v=new pc.Vec3(direction.x*(1+Math.random()*2)+(Math.random()-.5)*1.8,direction.y*2+Math.random()*1.8,direction.z*(1+Math.random()*2)+(Math.random()-.5)*1.8);s.size=.012+Math.random()*.02;s.stainSize=.065+Math.random()*.08;s.aspect=.8+Math.random()*.6;s.stuck=false;s.clock=0;s.entity.enabled=true;s.entity.setPosition(s.p);s.entity.setLocalScale(s.size*s.aspect,1,s.size);s.entity.setRotation(this.lastFacing??pc.Quat.IDENTITY);s.material.opacity=1;
    }
  }
  update(dt,camera,voxel){
    this.lastFacing=camera.getRotation().clone().mul(new pc.Quat().setFromEulerAngles(90,0,0));
    for(const s of this.slots){
      if(!Number.isFinite(s.age))continue;s.age+=dt;
      if(s.age>18){s.entity.enabled=false;s.age=Infinity;continue;}
      if(!s.stuck&&dt>0){
        s.v.y-=9.8*dt;const motion=s.v.clone().mulScalar(dt),len=motion.length(),d=motion.clone().normalize(),hit=len>0?voxel.queryRay(s.p.x,s.p.y,s.p.z,d.x,d.y,d.z,len):null;
        if(hit){const n=voxel.querySurfaceNormal(hit.x,hit.y,hit.z,d.x,d.y,d.z);let normal=new pc.Vec3(n.nx,n.ny,n.nz);if(normal.dot(d)>0)normal.mulScalar(-1);if(!Number.isFinite(normal.length())||normal.length()<.1)normal.copy(pc.Vec3.UP);normal.normalize();s.p.set(hit.x,hit.y,hit.z).add(normal.clone().mulScalar(.035));s.entity.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP,normal));s.entity.rotateLocal(0,Math.random()*360,0);s.stuck=true;s.size=s.stainSize;}
        else{s.p.add(motion);s.entity.setRotation(camera.getRotation());s.entity.rotateLocal(90,0,0);}
        if(s.age>1.5&&!s.stuck){s.age=Infinity;s.entity.enabled=false;continue;}
      }
      s.entity.setPosition(s.p);s.entity.setLocalScale(s.size*(s.aspect??1),1,s.size);s.material.opacity=Math.min(1,(18-s.age)/4);s.clock-=dt;
      if(s.clock<=0){s.clock=.08;s.entity.enabled=impactVisible(voxel,camera.getPosition(),s.p);}
    }
  }
  reset(){for(const s of this.slots){s.age=Infinity;s.entity.enabled=false;}this.cursor=0;}
}
