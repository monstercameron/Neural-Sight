import * as pc from 'playcanvas';
import {mediaUrl} from './media-url.js';
import {ZombieNavigation,groundNear,standingClear,walkableEdge,crowdEdgeClear,distance} from './zombie-navigation.js';
import {ZombieRagdoll,rayCapsule} from './zombie-physics.js';
import {zombieMaterial} from './zombie-material.js';
import {ZombieAudio} from './zombie-audio.js';
import {ZombieBlood} from './zombie-blood.js';
import {ZombieShadows} from './zombie-shadows.js';
import {attackOpportunity,clearOfPlayer} from './zombie-combat.js';
import {chooseCrowdStep} from './zombie-steering.js';
import {ZombieLocalRoutes} from './zombie-local-routes.js';
import {chooseZombieRoute} from './zombie-route-choice.js';
import {advanceMelee,poseMelee,meleeContact} from './zombie-melee.js';
import {beginMeleeFeet,poseMeleeFeet,poseLocomotionFeet} from './zombie-footwork.js';
import {cachedVoxelQueries} from './voxel-query-cache.js';
import {createBodySupport,supportRevival} from './zombie-body-support.js';
import {resolveBodyContacts} from './zombie-player-contact.js';
import {zombieAmbientColor} from './zombie-lighting.js';
import {REVIVAL_ALIGN,REVIVAL_DURATION,revivalClipTime,braceRevivalHand,alignRevivalPose,chooseRevivalHeading} from './zombie-revival.js';
const v=p=>new pc.Vec3(p.x,p.y,p.z),plain=p=>({x:p.x,y:p.y,z:p.z});
const JOINTS=['Pelvis','Spine','Spine1','Spine2','Spine3','Neck','Head','HeadNub','L UpperArm','L Forearm','L Hand','R UpperArm','R Forearm','R Hand','L Thigh','L Calf','L Foot','L Toe0','R Thigh','R Calf','R Foot','R Toe0'];
const LINKS=[['Pelvis','Spine'],['Spine','Spine1'],['Spine1','Spine2'],['Spine2','Spine3'],['Spine3','Neck'],['Neck','Head'],['Head','HeadNub'],['Neck','L UpperArm'],['L UpperArm','L Forearm'],['L Forearm','L Hand'],['Neck','R UpperArm'],['R UpperArm','R Forearm'],['R Forearm','R Hand'],['Pelvis','L Thigh'],['L Thigh','L Calf'],['L Calf','L Foot'],['L Foot','L Toe0'],['Pelvis','R Thigh'],['R Thigh','R Calf'],['R Calf','R Foot'],['R Foot','R Toe0']];
const HIT_PARTS=[['Head','HeadNub',.13,'head'],['Pelvis','Spine3',.19,'torso'],['Spine3','Neck',.18,'torso'],...['L','R'].flatMap(s=>[[s+' UpperArm',s+' Forearm',.09,'arm'],[s+' Forearm',s+' Hand',.075,'arm'],[s+' Thigh',s+' Calf',.115,'leg'],[s+' Calf',s+' Foot',.09,'leg']])];
const load=(app,url)=>new Promise((resolve,reject)=>app.assets.loadFromUrl(url,'container',(err,asset)=>err?reject(Error(err)):resolve(asset)));
export class ZombieEncounter {
  constructor(app,collision,audio,{depthSupported=true,hasSplatDepth=()=>depthSupported,onDamage=()=>{},onStatus=()=>{},population=5,layerId=pc.LAYERID_IMMEDIATE}={}){
    // Navigation, stance feet and live body clearance repeat exact static
    // occupancy queries too; share the same cache as corpse physics.
    collision={...collision,voxel:cachedVoxelQueries(collision.voxel)};
    Object.assign(this,{app,collision,onDamage,onStatus,population,depthSupported,layerId});this.actors=[];this.health=100;this.kills=0;this.status='Loading rigged zombie assets…';
    this.nav=new ZombieNavigation(collision.voxel,collision.meta.gridBounds);this.audio=new ZombieAudio(audio);this.blood=new ZombieBlood(app,layerId);this.clock=0;this.ready=false;this.started=false;this.enabled=true;this.reviveCount=0;
    this.root=new pc.Entity('Zombie encounter');app.root.addChild(this.root);
    this.shadows=new ZombieShadows(app,layerId,depthSupported,hasSplatDepth);
  }
  async init(eye,forward,navUrl=null){
    this.spawnEye=plain(eye);this.spawnForward=plain(forward);
    this.assets=await Promise.all(['walk','attack','revive'].map(name=>load(this.app,mediaUrl(`/media/characters/zombie/${name}.glb`))));
    this.material=zombieMaterial(this.assets[0].resource.materials[0].resource,this.depthSupported);
    // WebGPU external image upload submits its encoder. Warm every texture
    // before any draw pass rather than lazily uploading on first visible actor.
    for(const name of ['diffuseMap','normalMap','metalnessMap','glossMap','emissiveMap'])this.material[name]?.upload();
    // Daylight key/fill affects dynamic geometry only; captured splats retain their light.
    this.sun=new pc.Entity('Dynamic actor daylight');this.sun.addComponent('light',{type:'directional',color:new pc.Color(1,.9,.78),intensity:1.05,castShadows:false,layers:[this.layerId]});this.sun.setEulerAngles(48,-35,0);this.root.addChild(this.sun);
    this.app.scene.ambientLight=zombieAmbientColor();
    let cached=false;
    if(navUrl)try{const r=await fetch(navUrl);if(r.ok)cached=this.nav.hydrate(await r.json(),this.collision.digest);}catch{/* Build locally when a cache is unavailable. */}
    if(!cached)this.nav.begin(eye);this.ready=true;this.status=cached?'Validated local navigation cache':'Mapping connected walkable ground…';
  }
  spawn(){
    const points=this.nav.spawnPoints(this.population,this.spawnEye,this.spawnForward);
    for(const [i,p] of points.entries())this.create(i+1,p);
    this.started=true;this.status=points.length?`${points.length} infected · G revives defeated bodies`:'No safe encounter spawn in connected ground';
  }
  create(id,p){
    const root=new pc.Entity('Infected '+id);this.root.addChild(root);root.setPosition(p.x,p.y,p.z);
    const model=this.assets[0].resource.instantiateRenderEntity({castShadows:false,layers:[this.layerId]});root.addChild(model);
    for(const r of model.findComponents('render')){r.layers=[this.layerId];for(const mi of r.meshInstances)mi.material=this.material;}
    model.addComponent('anim',{activate:true});
    for(const [i,name] of ['walk','attack','revive'].entries())model.anim.assignAnimation(name,this.assets[i].resource.animations[0].resource,undefined,1,name==='walk');
    // A separate zero-speed state keeps planted idle feet without continuing
    // the walk cycle in slow motion. State transitions still advance normally.
    model.anim.assignAnimation('idle',this.assets[0].resource.animations[0].resource,undefined,0,true);
    model.anim.enabled=false;model.anim.baseLayer.play('idle');model.anim.update(0);
    const bones=new Map(JOINTS.map(name=>[name,model.findByName('Bip01 '+name)]));
    if([...bones.values()].some(b=>!b)){root.destroy();throw Error('Zombie skeleton missing required joints');}
    const bindPose=model.find(()=>true).map(node=>({node,p:node.getLocalPosition().clone(),q:node.getLocalRotation().clone(),s:node.getLocalScale().clone()}));
    const a={id,root,model,bones,bindPose,p:plain(p),spawn:plain(p),hp:100,mode:'idle',time:0,speed:.65+(id%3)*.075,path:[],repath:0,moan:1+id*.65,step:0,yaw:0,stagger:0,attackHit:false,revive:null,ragdoll:null,colliders:[]};
    a.bodySupport=createBodySupport(model);
    a.yaw=Math.atan2(this.spawnEye.x-p.x,this.spawnEye.z-p.z)*180/Math.PI;root.setEulerAngles(0,a.yaw,0);this.actors.push(a);this.pose(a,0);return a;
  }
  change(a,mode){if(a.mode===mode)return;
    if(!['walk','idle'].includes(mode)){this.localRoutes?.cancel(a.id);if(a.localRouteGoal)a.path=[];a.localRouteGoal=null;a.localDetour=null;}
    if(['attack','revive'].includes(a.mode)&&['walk','idle'].includes(mode)){
      a.footHandoff={root:plain(a.root.getPosition()),feet:['L','R'].map(side=>({side,p:a.bones.get(side+' Foot').getPosition().clone(),q:a.bones.get(side+' Foot').getRotation().clone()}))};
      a.poseHandoff=a.bindPose.map(({node})=>({node,p:node.getLocalPosition().clone(),q:node.getLocalRotation().clone()}));
      a.handoffTime=0;
    }
    else if(!['walk','idle'].includes(mode)){a.footHandoff=null;a.poseHandoff=null;}
    a.mode=mode;a.time=0;if(['idle','walk','attack','revive'].includes(mode)){a.model.anim.baseLayer.transition(mode,mode==='revive'?0:.18);a.model.anim.baseLayer.activeStateCurrentTime=0;}if(mode==='attack'){a.attackHit=false;a.attackTarget=null;a.attackLunge=0;beginMeleeFeet(a);this.audio.play('attack',a,3);}}
  pose(a,dt){
    if(a.ragdoll){this.applyRagdoll(a);return;}
    // Ragdolls write world transforms, including unanimated local translations.
    // Restore the authored skeleton before sampling animation; never retain
    // stretched limb offsets or accumulate additive hit rotations on revival.
    for(const b of a.bindPose){b.node.setLocalPosition(b.p);b.node.setLocalRotation(b.q);b.node.setLocalScale(b.s);}
    const scale=a.mode==='walk'?(a.motionSpeed??a.speed)/.72:a.mode==='revive'?1:a.mode==='idle'?1:1.3;
    a.model.anim.update(dt*scale);
    if(a.mode==='revive'){
      a.model.anim.baseLayer.activeStateCurrentTime=revivalClipTime(a.time,this.assets[2].resource.animations[0].resource.duration);
      a.model.anim.update(0);
    }
    if(a.mode==='idle')a.bones.get('Spine3').rotateLocal(Math.sin(this.clock*1.4+a.id)*.35,0,0);
    // A small additive recoil on the spine preserves authored animation continuity.
    if(a.stagger>0){const spine=a.bones.get('Spine3');spine.rotateLocal(0,0,Math.sin(a.stagger*22)*a.stagger*20);}
    if(a.mode==='attack'){poseMeleeFeet(a,this.collision.voxel,this.collision.meta.gridBounds,()=>{if(dt>0)this.audio.play('step',a,1);});poseMelee(a);}
    if(a.mode==='walk'||a.mode==='idle')poseLocomotionFeet(a,this.collision.voxel,this.collision.meta.gridBounds);
    if(a.revive){
      const t=Math.min(1,a.time/REVIVAL_ALIGN),blend=t*t*(3-2*t);
      if(a.revivalAlignment){
        chooseRevivalHeading(a);
        supportRevival(a,this.collision.voxel,1);
        alignRevivalPose(a,blend,this.collision.voxel,this.collision.meta.gridBounds,JOINTS,LINKS);
      }else for(const pose of a.revive){const bone=pose.node,p=bone.getLocalPosition().clone(),q=bone.getLocalRotation().clone();bone.setLocalPosition(new pc.Vec3().lerp(pose.p,p,blend));bone.setLocalRotation(new pc.Quat().slerp(pose.q,q,blend));}
      if(t===1){a.revive=null;a.revivalAlignment=null;}
    }
    if(a.mode==='revive'){
      supportRevival(a,this.collision.voxel);
      braceRevivalHand(a,this.collision.voxel);
      if(a.revivalHandWeight>0)supportRevival(a,this.collision.voxel);
    }
    if(a.poseHandoff){
      const t=Math.min(1,(a.handoffTime??0)/.18),weight=t*t*(3-2*t);
      // An ankle target alone is insufficient: the skinned shoe also inherits
      // calf, toe and pelvis rotations. Blend the captured local hierarchy so
      // the actual rendered pose, not just bone centres, survives the handoff.
      for(const old of a.poseHandoff){const p=old.node.getLocalPosition().clone(),q=old.node.getLocalRotation().clone();old.node.setLocalPosition(new pc.Vec3().lerp(old.p,p,weight));old.node.setLocalRotation(new pc.Quat().slerp(old.q,q,weight));}
      if(t===1)a.poseHandoff=null;
      a.handoffTime=(a.handoffTime??0)+dt;
    }
    this.colliders(a);
  }
  colliders(a){a.colliders=HIT_PARTS.map(([from,to,r,part])=>({a:plain(a.bones.get(from).getPosition()),b:plain(a.bones.get(to).getPosition()),r,part,joint:JOINTS.indexOf(from)}));}
  update(dt,player,camera,{active=true,eyeHeight=1.5,playerAlive=true}={}){
    this.clock+=active&&this.enabled?dt:0;if(!this.ready)return;
    if(!this.nav.ready)this.nav.buildStep(2.5);
    if(!this.started&&this.nav.ready)this.spawn();
    const tick=active&&this.enabled?dt:0;this.audio.update(tick,camera,this.collision.voxel);this.blood.update(tick,camera,this.collision.voxel);this.shadows.update(this.actors,camera,this.collision.voxel,tick);
    if(!tick)return;
    if(!this.localRoutes||this.localRoutes.voxel!==this.collision.voxel||this.localRouteNav!==this.nav||this.localRouteGeneration!==this.nav.generation){
      this.localRoutes?.clear();
      if(this.localRouteGeneration!==undefined)for(const a of this.actors){a.path=[];a.localRouteGoal=null;a.localDetour=null;a.detourRetryAt=0;a.repath=0;}
      this.localRoutes=new ZombieLocalRoutes(this.collision.voxel,this.collision.meta.gridBounds);this.localRouteNav=this.nav;this.localRouteGeneration=this.nav.generation;
    }
    if(playerAlive&&this.health>0)this.localRoutes.advance(1);else this.localRoutes.clear();
    const feet={x:player.x,y:player.y-eyeHeight,z:player.z};
    this.playerCapsule={...feet,eyeHeight};
    for(const a of this.actors){
      a.time+=tick;a.stagger=Math.max(0,a.stagger-tick);
      if(a.ragdoll){a.ragdoll.update(tick,this.collision.voxel,this.collision.meta.gridBounds);this.applyRagdoll(a);continue;}
      if(a.mode==='revive'){this.pose(a,tick);if(a.time>REVIVAL_DURATION){this.change(a,'walk');a.repath=0;}continue;}
      if(!playerAlive||this.health<=0){this.change(a,'idle');this.pose(a,tick);continue;}
      const dx=feet.x-a.p.x,dz=feet.z-a.p.z,dist=Math.hypot(dx,dz);
      const opportunity=attackOpportunity(a,player,eyeHeight,this.collision.voxel,1.5);
      if(opportunity.visible&&(a.mode!=='attack'||a.time<.25)){
        const target=Math.atan2(dx,dz)*180/Math.PI,delta=((target-a.yaw+540)%360)-180;a.yaw+=delta*(1-Math.exp(-tick*6));
      }
      a.moan-=tick;if(a.moan<=0){this.audio.play('moan-'+(1+a.id%2),a,0);a.moan=5+Math.random()*6;}
      if(a.mode==='attack'){
        advanceMelee(a,player,tick,this.collision.voxel,this.collision.meta.gridBounds,this.actors);
        if(a.time>1.7)this.change(a,'walk');
      }else if(dist<1.2&&opportunity.visible&&opportunity.facing){this.change(a,'attack');}
      else{
        const obstacles=this.actors.filter(b=>b!==a&&!b.ragdoll).map(b=>b.p);
        const followingLocal=a.localRouteGoal&&a.path.length&&distance(a.localRouteGoal,feet)<.6;
        if(a.localRouteGoal&&!followingLocal){a.localRouteGoal=null;a.path=[];a.repath=0;this.localRoutes.cancel(a.id);}
        a.repath-=tick;if(a.repath<=0&&!followingLocal){
          const choice=chooseZombieRoute(a,this.nav,this.localRoutes,feet,obstacles,this.clock);
          a.path=choice.path;a.repath=choice.waiting?.15:.8+a.id*.09;
          if(choice.local)a.localRouteGoal=plain(feet);
        }
        let aim=a.path[0];
        // Support retention can legitimately put the feet 5 cm above/below a
        // sampled tread at the same XZ. A fine waypoint owns horizontal
        // progress; the validated next edge owns the actual support height.
        const atWaypoint=aim&&(a.localRouteGoal?
          Math.hypot(a.p.x-aim.x,a.p.z-aim.z)<.035&&Math.abs(a.p.y-aim.y)<=.37:
          distance(a.p,aim)<.16);
        if(atWaypoint){
          const next=a.path[1];
          // Reaching the waypoint tolerance does not authorize cutting a
          // corner. Validate the shortcut from the actual actor footprint.
          if(!next||(crowdEdgeClear(a.p,next,obstacles)&&walkableEdge(this.collision.voxel,a.p,next,this.collision.meta.gridBounds))){a.path.shift();aim=next;}
        }
        if(dist<1.8&&crowdEdgeClear(a.p,feet,obstacles)&&walkableEdge(this.collision.voxel,a.p,feet,this.collision.meta.gridBounds))aim=feet;
        if(aim&&(dist>1.1||!opportunity.visible)){
          const move=chooseCrowdStep(a,aim,this.actors,this.collision.voxel,this.collision.meta.gridBounds,tick);
          a.motionSpeed=move?move.distance/tick:0;
          if(move){
            this.change(a,'walk');a.p=move.p;a.step+=move.distance;
            if(move.turn)a.avoidSide=Math.sign(move.turn);
            const target=Math.atan2(move.direction.x,move.direction.z)*180/Math.PI,delta=((target-a.yaw+540)%360)-180;a.yaw+=delta*(1-Math.exp(-tick*5));
          }else{this.change(a,'idle');a.repath=Math.min(a.repath,.25);if(a.localRouteGoal){a.localRouteGoal=null;a.path=[];this.localRoutes.cancel(a.id);}}
          if(a.step>.46){a.step%=.46;this.audio.play('step',a,1);}
        }else this.change(a,'idle');
      }
      a.root.setPosition(a.p.x,a.p.y,a.p.z);a.root.setEulerAngles(0,a.yaw,0);this.pose(a,tick);
      // Resolve against this frame's posed arms, not yesterday's colliders or
      // a timer-only invisible range. A committed strike may legitimately miss.
      if(a.mode==='attack'&&!a.attackHit&&a.time>=.64&&a.time<=.9){
        const contact=attackOpportunity(a,player,eyeHeight,this.collision.voxel,1.45);
        if(contact.visible&&contact.facing&&meleeContact(a,player,eyeHeight,this.collision.voxel)){
          a.attackHit=true;this.health=Math.max(0,this.health-14);this.onDamage(14,this.health);
        }
      }
    }
    // Living actors are solid to the player. Resolve sideways only and validate
    // the level capsule, so a crowd cannot push the camera through a wall.
    for(const a of this.actors){if(a.ragdoll||a.mode==='revive'||Math.abs(feet.y-a.p.y)>.9)continue;const dx=player.x-a.p.x,dz=player.z-a.p.z,d=Math.hypot(dx,dz);if(d<.49){const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0,p={x:player.x+nx*(.49-d),y:feet.y,z:player.z+nz*(.49-d)};if(standingClear(this.collision.voxel,p,this.collision.meta.gridBounds,.2)){player.x=p.x;player.z=p.z;}}}
    resolveBodyContacts(player,eyeHeight,this.actors,this.collision.voxel,this.collision.meta.gridBounds);
  }
  raycast(origin,direction,max){let best=null;for(const a of this.actors){for(const c of a.colliders){const hit=rayCapsule(origin,direction,c.a,c.b,c.r,best?.distance??max);if(hit)best={...hit,zombieId:a.id,part:c.part,joint:c.joint};}}return best;}
  shoot(record){
    const a=this.actors.find(a=>a.id===record.hit.zombieId);if(!a)return;
    if(a.ragdoll){a.ragdoll.impulse(record.hit.joint,record.direction);return;}
    this.blood.spawn(record.hit.point,record.direction);this.audio.play('hurt',a,3);a.stagger=.32;
    a.hp-=record.hit.part==='head'?110:record.hit.part==='torso'?38:24;
    if(a.hp<=0)this.kill(a,record.direction,record.hit.joint);
  }
  kill(a,direction={x:0,y:0,z:-1},hitIndex=0){
    if(a.ragdoll)return;
    this.localRoutes?.cancel(a.id);a.localRouteGoal=null;a.localDetour=null;
    const joints=JOINTS.map(name=>({p:plain(a.bones.get(name).getPosition()),r:name==='Head'?.13:name.includes('Spine')||name==='Pelvis'?.12:name.includes('Foot')||name.includes('Toe')?.07:.085,mass:name==='Pelvis'?4:name.includes('Spine')?2:1}));
    a.deathPose=new Map(JOINTS.map(name=>[name,{p:a.bones.get(name).getPosition().clone(),q:a.bones.get(name).getRotation().clone()}]));
    a.ragdoll=new ZombieRagdoll(joints,LINKS.map(([x,y])=>[JOINTS.indexOf(x),JOINTS.indexOf(y)]),{x:direction.x*2.2,y:Math.max(.2,direction.y),z:direction.z*2.2},hitIndex,[0,1,2,3,4,5,8,11,14,18],{frame:{pelvis:0,chest:5,left:14,right:18},hinges:[[14,15,16,125],[18,19,20,125],[8,9,10,140],[11,12,13,140]],cones:[[5,0,15,100],[5,0,19,100]]});a.hp=0;a.mode='dead';a.time=0;a.revive=null;this.kills++;this.audio.play('death',a,3);
  }
  applyRagdoll(a){
    for(const name of JOINTS){
      const index=JOINTS.indexOf(name),bone=a.bones.get(name),p=a.ragdoll.points[index].p,child=LINKS.find(([from])=>from===name)?.[1];
      if(child){const rest=a.deathPose.get(child).p.clone().sub(a.deathPose.get(name).p),next=v(a.ragdoll.points[JOINTS.indexOf(child)].p).sub(v(p));const delta=new pc.Quat().setFromDirections(rest.normalize(),next.normalize());bone.setRotation(delta.mul(a.deathPose.get(name).q));}
      bone.setPosition(p.x,p.y,p.z);
    }
    this.colliders(a);
  }
  revive(){
    let count=0,deferred=0;
    for(const a of this.actors){if(!a.ragdoll)continue;
      const pelvis=a.ragdoll.points[0].p;
      const candidates=this.nav.nodes.filter(n=>Math.hypot(n.x-pelvis.x,n.z-pelvis.z)<2.5).sort((x,y)=>distance(x,pelvis)-distance(y,pelvis));
      const p=candidates.find(n=>clearOfPlayer(n,this.playerCapsule)&&standingClear(this.collision.voxel,n,this.collision.meta.gridBounds)&&this.actors.every(b=>b===a||b.ragdoll||distance(n,b.p)>.6));
      if(!p){deferred++;continue;}
      // Rebase the entire current hierarchy to the validated standing root,
      // then blend local transforms. Sequential world-space blending mutates
      // child targets as each parent moves and stretches intermediate poses.
      const worldPose=a.bindPose.map(({node})=>({node,p:node.getPosition().clone(),q:node.getRotation().clone()}));
      a.revivalAlignment={physics:a.ragdoll,world:new Map(worldPose.map(pose=>[pose.node,pose]))};
      a.ragdoll=null;a.hp=100;a.p=plain(p);a.path=[];a.repath=0;a.stagger=0;a.revivalHand=null;a.revivalHandWeight=0;a.root.setPosition(p.x,p.y,p.z);
      for(const pose of worldPose){pose.node.setPosition(pose.p);pose.node.setRotation(pose.q);}
      a.revive=a.bindPose.map(({node})=>({node,p:node.getLocalPosition().clone(),q:node.getLocalRotation().clone()}));
      this.change(a,'revive');this.audio.play('moan-1',a,2);count++;
    }
    this.reviveCount+=count;this.status=`Revived ${count}${deferred?` · ${deferred} waiting for safe standing space`:''}`;return {count,deferred};
  }
  reset(){this.localRoutes?.clear();this.audio.stop();this.blood.reset();this.shadows.reset();for(const a of this.actors)a.root.destroy();this.actors=[];this.started=false;this.health=100;this.kills=0;this.reviveCount=0;if(this.ready&&this.nav.ready)this.spawn();}
  stats({includeActors=true}={}){
    let dead=0;for(const actor of this.actors)if(actor.ragdoll)dead++;
    const summary={ready:this.ready,mapped:this.nav.nodes.length,mapping:!this.nav.ready,alive:this.actors.length-dead,dead,health:this.health,kills:this.kills,revived:this.reviveCount,voices:this.audio.voices.size,audioReady:this.audio.buffers.size,audioFailures:this.audio.failures,status:this.status};
    if(includeActors)summary.actors=this.actors.map(a=>({id:a.id,hp:a.hp,state:a.mode,p:a.p,ragdollSleeping:a.ragdoll?.sleeping,hitboxes:a.colliders,revivalSupport:a.revivalSupport,supportVertices:a.bodySupport?.reduce((n,g)=>n+g.positions.length/3,0)}));
    return summary;
  }
}
