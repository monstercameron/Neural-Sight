import {HIP_PHASE,HIP_TRANSITIONS} from './hip-pose.js';
import {mediaUrl} from './media-url.js';
// Bounded decoded cache; compositor retains current/previous frames for optional blur.
export class FramePlayer {
  constructor() {
    this.cache = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.clips = {};
    this.last = null;
    this.clock = 0;
    this.state = "";
    this.pinned=new Set();
    this.requested=null;
  }
  async init() {
    const response = await fetch(mediaUrl("/media/playback/manifest.json"));
    if (!response.ok) return;
    this.clips = JSON.parse(JSON.stringify(await response.json()),(key,value)=>typeof value==='string'?mediaUrl(value):value);
    // The larger stance library should not decode four frames from every clip
    // concurrently. Prime endpoints in small batches; playback prefetches ahead.
    const endpoints=[...new Set(Object.values(this.clips).flatMap(c=>[c.frames[0],c.frames.at(-1)]))];
    if(this.clips.raising)endpoints.push(this.clips.raising.frames[Math.round(HIP_PHASE*(this.clips.raising.frames.length-1))]);
    const raising=this.clips.raising?.frames??[];
    const firing=[...new Set(['fireHip','fireADS'].flatMap(k=>this.clips[k]?.frames??[]))];
    // The reversible raise is used for ADS, hip fire and their idle endpoints.
    // Keep it decoded instead of pinning unrelated long-clip endpoints. Reserve
    // at least 16 of the existing 64 slots for streaming other animations.
    this.pinned=new Set([...new Set([...raising,...firing,...endpoints])].slice(0,48));
    for(let i=0;i<endpoints.length;i+=4)
      await Promise.all(endpoints.slice(i,i+4).map(url=>this.load(url)));
    // Warm short bridges opportunistically; the bounded cache cannot retain
    // both bridges and every critical raise/fire frame simultaneously.
    const bridges=[...new Set(['runFromLow','runFromADS'].flatMap(k=>this.clips[k]?.frames??[]))];
    for(let i=0;i<bridges.length;i+=4)
      await Promise.all(bridges.slice(i,i+4).map(url=>this.load(url)));
    // A flash lasts only a few render frames: keep its compact working set ready.
    for(let i=0;i<firing.length;i+=4)
      await Promise.all(firing.slice(i,i+4).map(url=>this.load(url)));
    for(let i=0;i<raising.length;i+=4)
      await Promise.all(raising.slice(i,i+4).map(url=>this.load(url)));
  }
  load(url) {
    if (this.failed.has(url)) return Promise.resolve(null);
    if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));
    if (!this.pending.has(url))
      this.pending.set(
        url,
        (async () => {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(url);
            const bitmap = await createImageBitmap(await response.blob(),{premultiplyAlpha:'none'});
            this.cache.set(url, bitmap);
            while (this.cache.size > 64) {
              const candidate = [...this.cache.keys()].find(
                (key) => key !== this.last?.url && !this.pinned.has(key),
              );
              if(!candidate)break;
              this.cache.get(candidate).close();
              this.cache.delete(candidate);
            }
            return bitmap;
          } catch {
            this.failed.add(url);
            return null;
          } finally {
            this.pending.delete(url);
          }
        })(),
      );
    return this.pending.get(url);
  }
  get matchedRun(){return ['runFromLow','runFromADS','runLateral'].every(k=>this.clips[k]);}
  frame(state, progress, dt, scrubbing = false, posePhase = null, carry = null) {
    // No authored repacking clip yet: use lowered carry footage as a placeholder.
    if(state==='repack')state='lowReady';
    // The authored run loop has a different carry pose and no connecting footage.
    // Keep the low-ready take continuous; distance-driven lateral carry is applied
    // by ViewBob. ADS still traverses the filmed raise/lower, never the run still.
    if(['enterRun','run','exitRun'].includes(state))state='lowReady';
    if (this.state !== state) {
      this.clock = 0;
      this.state = state;
      // Retain the last decoded frame until the new clip is ready: never flash
      // a separately generated fallback still during a rapid handoff.
    }
    this.clock += dt;
    // Hold the filmed ADS endpoint: cutting to a separately generated still jumps.
    const hip=state==='hipFire'||HIP_TRANSITIONS.includes(state);
    const aimTransition=['raising','lowering'].includes(state)&&posePhase!==null;
    const routed=state==='enterRun'?'run':state==='exitRun'?'lowReady':state;
    const clip = this.clips[carry?.clip ?? (state === "ads" || hip || aimTransition ? "raising" : routed)];
    if (!clip) return null;
    const phase =
      scrubbing ? progress : carry ? carry.phase : hip || aimTransition ? (posePhase ?? HIP_PHASE) : state === "ads" ? 1 : ["raising", "lowering", "reloadADS", "reload"].includes(state) || /^crouch(Enter|Exit)/.test(state)
        ? progress
        : (this.clock % clip.duration) / clip.duration;
    const index = Math.min(
      clip.frames.length - 1,
      carry || hip || aimTransition ? Math.round(phase*(clip.frames.length-1)) : Math.floor(phase * clip.frames.length),
    );
    const url = clip.frames[index];
    const bitmap = this.cache.get(url);
    const loopCarry=carry?.clip==='runLateral'&&carry.direction===undefined;
    const oneShot=!loopCarry&&(!!carry||hip||aimTransition||state==='ads'||scrubbing||
      ['raising','lowering','reloadADS','reload'].includes(state)||/^crouch(Enter|Exit)/.test(state));
    // Use intended travel, not the last successfully decoded image. At the
    // first sprint→ADS frame we start at the END of the bridge; a cache miss
    // or repeated render of that frame must not flip prefetch toward its start.
    const previous=this.requested?.clip===clip?this.requested:null;
    const intended=!scrubbing && (aimTransition||HIP_TRANSITIONS.includes(state))?
      (['lowering','hipLower','adsToHip'].includes(state)?-1:1):0;
    const direction=!oneShot?1:carry?.direction || intended || (previous && Math.sign(index-previous.index)) ||
      previous?.direction || (['hipLower','lowering'].includes(state)?-1:1);
    this.requested={clip,index,direction};
    if (bitmap) {
      this.cache.delete(url);
      this.cache.set(url, bitmap);
      this.last = { url, bitmap, index, total: clip.frames.length, clip:carry?.clip,generatedFlash:!!clip.generatedFlash,flashMatte:!!clip.flashMatte };
      if(clip.flashMatte){
        const baseUrl=clip.frames.at(-1),baseBitmap=this.cache.get(baseUrl);
        if(baseBitmap)this.last.stableBase={url:baseUrl,bitmap:baseBitmap};
      }
    }
    const ahead=new Set();
    for(let n=0;n<8;n++){
      const next=index+direction*n;
      ahead.add(clip.frames[oneShot?Math.max(0,Math.min(clip.frames.length-1,next)):
        (next+clip.frames.length)%clip.frames.length]);
    }
    for(const next of ahead)this.load(next);
    return this.last;
  }
}
