const CUES=['moan-1','moan-2','attack','hurt','death'];
import {mediaUrl} from './media-url.js';
export class ZombieAudio {
  constructor(director){this.director=director;this.buffers=new Map();this.voices=new Set();this.loading=false;this.failures=[];this.clock=0;}
  async load(){
    const context=this.director.context;if(!context||this.loading||this.loadedContext===context)return;
    this.loading=true;this.loadedContext=context;this.buffers.clear();this.failures=[];
    await Promise.all(CUES.map(async id=>{try{const r=await fetch(mediaUrl(`/media/audio/zombies-v1/${id}/clip.mp3`));if(!r.ok)throw Error('HTTP '+r.status);this.buffers.set(id,await context.decodeAudioData(await r.arrayBuffer()));}catch(e){this.failures.push(id+': '+e.message);}}));this.loading=false;
  }
  play(name,actor,priority=1){
    const {context,bus,muted}=this.director;if(!context||context.state!=='running'||muted)return;
    const step=name==='step';const buffer=step?this.director.buffers.get('walk-'+(1+actor.id%3)):this.buffers.get(name);
    if(!buffer)return;
    if(this.voices.size>=12){const victim=[...this.voices].find(v=>v.priority<priority);if(!victim)return;victim.source.stop();this.voices.delete(victim);}
    const source=context.createBufferSource(),gain=context.createGain(),panner=context.createPanner(),filter=context.createBiquadFilter();
    source.buffer=buffer;source.playbackRate.value=.92+(actor.id%4)*.04+(Math.random()-.5)*.035;
    panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=1.5;panner.maxDistance=35;panner.rolloffFactor=1.35;
    filter.type='lowpass';filter.frequency.value=16000;
    const level=step?.2:name==='hurt'?.52:name==='attack'?.62:.45;
    gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(level,context.currentTime+.005);
    source.connect(filter).connect(gain).connect(panner).connect(bus);
    const voice={source,gain,panner,filter,actor,level,priority,step};this.voices.add(voice);
    this.position(voice);source.onended=()=>{this.voices.delete(voice);for(const node of [source,gain,panner,filter])node.disconnect();};source.start();
  }
  emitter(v){
    // Death/hurt tails follow the physical head after the root stops walking.
    // Use the same point for panning and wall occlusion, not a stale standing
    // point above the corpse or a different ray target below the live emitter.
    const head=v.actor.ragdoll?.points[6]?.p;
    if(head&&!v.step)return head;
    const posedHead=v.actor.bones?.get('Head');
    if(posedHead&&!v.step)return posedHead.getPosition();
    const p=v.actor.p;return {x:p.x,y:p.y+(v.step?.1:1.45),z:p.z};
  }
  position(v){const p=this.emitter(v);v.panner.positionX.value=p.x;v.panner.positionY.value=p.y;v.panner.positionZ.value=p.z;}
  update(dt,camera,voxel){
    void this.load();if(dt<=0){this.stop();return;}
    const context=this.director.context;if(!context)return;
    const p=camera.getPosition(),f=camera.forward,u=camera.up,l=context.listener;
    if(l.positionX){for(const [key,v] of Object.entries({positionX:p.x,positionY:p.y,positionZ:p.z,forwardX:f.x,forwardY:f.y,forwardZ:f.z,upX:u.x,upY:u.y,upZ:u.z}))l[key].value=v;}
    else{l.setPosition(p.x,p.y,p.z);l.setOrientation(f.x,f.y,f.z,u.x,u.y,u.z);}
    this.clock-=dt;const occlude=this.clock<=0;if(occlude)this.clock=.12;
    for(const v of this.voices){this.position(v);if(occlude){const q=this.emitter(v),dx=q.x-p.x,dy=q.y-p.y,dz=q.z-p.z,len=Math.hypot(dx,dy,dz);const blocked=len>.2&&voxel.queryRay(p.x,p.y,p.z,dx/len,dy/len,dz/len,len-.2);v.filter.frequency.setTargetAtTime(blocked?1100:16000,context.currentTime,.06);v.gain.gain.setTargetAtTime(v.level*(blocked?.24:1),context.currentTime,.06);}}
  }
  stop(){for(const v of this.voices){try{v.source.stop();}catch{}}this.voices.clear();}
}
