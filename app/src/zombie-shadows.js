import * as pc from 'playcanvas';
import {impactVisible} from './bullet-impacts.js';
import {zombieMaterial} from './zombie-material.js';
export function contactShadowMaterial(source,depthSupported){
  const material=zombieMaterial(source,depthSupported,{overlay:true});
  material.name='Infected · depth-aware contact shadow';material.useLighting=false;material.diffuse.set(0,0,0);material.depthWrite=false;material.sceneTexturesWrite=false;material.update();return material;
}
// Grounded contact occlusion, not a fictitious real-time shadow on the scan.
export class ZombieShadows {
  constructor(app,layerId=pc.LAYERID_IMMEDIATE,depthSupported=false,hasSplatDepth=()=>depthSupported){
    this.layerId=layerId;this.depthSupported=depthSupported;this.hasSplatDepth=hasSplatDepth;
    this.root=new pc.Entity('Infected contact shadows');app.root.addChild(this.root);this.items=new Map();
    const size=64,data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.hypot((x-31.5)/32,(y-31.5)/32);data[(y*size+x)*4+3]=Math.max(0,1-r)**2*200;}
    this.texture=new pc.Texture(app.graphicsDevice,{name:'Soft contact shadow',width:size,height:size,format:pc.PIXELFORMAT_RGBA8,mipmaps:false});this.texture.lock().set(data);this.texture.unlock();
    this.material=new pc.StandardMaterial();this.material.useLighting=false;this.material.diffuse.set(0,0,0);this.material.emissive.set(1,1,1);this.material.emissiveMap=this.texture;this.material.opacityMap=this.texture;this.material.opacityMapChannel='a';this.material.blendType=pc.BLEND_NORMAL;this.material.depthWrite=false;this.material.cull=pc.CULLFACE_NONE;this.material.update();
    // The ordinary Immediate layer can be covered by the later splat pass.
    // Share the completed-scene depth guard and post-splat actor layer instead.
    const source=this.material;this.material=contactShadowMaterial(source,depthSupported);source.destroy();
  }
  update(actors,camera,voxel,dt){
    // A device can support splat depth while the current CameraFrame uses an
    // opaque-only prepass. That buffer cannot hide shadows behind the scan.
    const splatDepth=!!this.hasSplatDepth(),depthChanged=splatDepth!==this.lastSplatDepth;
    this.lastSplatDepth=splatDepth;
    const ids=new Set(actors.map(a=>a.id));for(const [id,items] of this.items)if(!ids.has(id)){for(const item of items)item.entity.destroy();this.items.delete(id);}
    for(const a of actors){
      let items=this.items.get(a.id);if(!items){items=['L Foot','R Foot','Pelvis'].map(name=>{const entity=new pc.Entity('Contact '+a.id+' '+name);entity.addComponent('render',{type:'plane',material:this.material,layers:[this.layerId],castShadows:false});this.root.addChild(entity);return {entity,name,clock:0};});this.items.set(a.id,items);}
      for(const s of items){s.clock-=dt;if(s.clock>0&&!depthChanged)continue;s.clock=.08;const p=a.bones.get(s.name).getPosition();const ground=voxel.queryRay(p.x,p.y+.15,p.z,0,-1,0,2);
        // The depth-aware shader clips covered fragments. A single center ray
        // must not discard uncovered sides of a shadow behind a narrow post.
        s.entity.enabled=!!ground&&(splatDepth||impactVisible(voxel,camera.getPosition(),{x:p.x,y:ground.y+.04,z:p.z}));if(!ground)continue;
        const size=s.name==='Pelvis'?(a.ragdoll?.8:.9):.42;
        // Fit local ground orientation across the visible footprint. Keeping a
        // horizontal quad on a slope buried one half and floated the other.
        const radius=size*.25;
        const sample=(x,z)=>{const hit=voxel.queryRay(x,ground.y+.5,z,0,-1,0,1.2);return hit&&Math.abs(hit.y-ground.y)<.4?hit.y:null;};
        const left=sample(p.x-radius,p.z),right=sample(p.x+radius,p.z),back=sample(p.x,p.z-radius),front=sample(p.x,p.z+radius);
        const dx=left!==null&&right!==null?(right-left)/(radius*2):0,dz=back!==null&&front!==null?(front-back)/(radius*2):0;
        const normal=new pc.Vec3(-dx,1,-dz).normalize();s.entity.setRotation(new pc.Quat().setFromDirections(pc.Vec3.UP,normal));
        s.entity.setPosition(p.x,ground.y+.032,p.z);s.entity.setLocalScale(size,1,size*.72);}
    }
  }
  reset(){for(const items of this.items.values())for(const item of items)item.entity.destroy();this.items.clear();}
}
