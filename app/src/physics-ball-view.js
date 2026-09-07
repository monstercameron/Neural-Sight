import * as pc from 'playcanvas';
import {impactVisible} from './bullet-impacts.js';
import {ballTexturePixels,BALL_STYLES} from './ball-textures.js';
export class PhysicsBallView {
  constructor(app){
    this.root=new pc.Entity('Interactive bouncy balls');app.root.addChild(this.root);this.items=new Map();
    this.textures=['beach','soccer'].map(style=>{
      const {data,width,height}=ballTexturePixels(style);
      const texture=new pc.Texture(app.graphicsDevice,{name:style+' ball panels',width,height,format:pc.PIXELFORMAT_RGBA8,srgb:true,mipmaps:true,
        addressU:pc.ADDRESS_REPEAT,addressV:pc.ADDRESS_CLAMP_TO_EDGE,minFilter:pc.FILTER_LINEAR_MIPMAP_LINEAR,magFilter:pc.FILTER_LINEAR});
      texture.lock().set(data);texture.unlock();return texture;
    });
    this.materials=this.textures.map(texture=>{
      const m=new pc.StandardMaterial();m.useLighting=false;m.diffuse=new pc.Color(0,0,0);m.emissive=new pc.Color(1,1,1);m.emissiveMap=texture;
      m.blendType=pc.BLEND_NORMAL;m.opacity=1;m.depthWrite=false;m.update();return m;
    });
  }
  update(balls,camera,voxel,dt){
    const ids=new Set(balls.map(b=>b.id));
    for(const [id,item] of this.items)if(!ids.has(id)){item.entity.destroy();this.items.delete(id);}
    for(const b of balls){
      let item=this.items.get(b.id);
      if(!item){
        const style=(b.id-1)%this.materials.length;
        const entity=new pc.Entity(BALL_STYLES[style]+' '+b.id);entity.addComponent('render',{type:'sphere',material:this.materials[style],layers:[pc.LAYERID_IMMEDIATE],castShadows:false});
        entity.setLocalScale(b.radius*2,b.radius*2,b.radius*2);this.root.addChild(entity);
        item={entity,clock:0};this.items.set(b.id,item);
      }
      item.entity.setPosition(b.p.x,b.p.y,b.p.z);item.clock-=dt;
      item.entity.rotateLocal(b.v.z*dt/b.radius*35,Math.hypot(b.v.x,b.v.z)*dt*12,-b.v.x*dt/b.radius*35);
      // Match existing splat/impact visibility: the splat depth is not always
      // hardware depth. A conservative center ray prevents props showing through walls.
      if(item.clock<=0){item.clock=.05;item.entity.enabled=impactVisible(voxel,camera.getPosition(),b.p);}
    }
  }
  reset(){for(const item of this.items.values())item.entity.destroy();this.items.clear();}
  destroy(){this.root.destroy();for(const material of this.materials)material.destroy();for(const texture of this.textures)texture.destroy();this.items.clear();}
}
