export class FramePacingCapture {
  constructor({seconds=60,capacity=36000}={}){this.seconds=seconds;this.capacity=capacity;this.running=false;this.result=null;}
  start(metadata={}){this.metadata={...metadata};this.frames=[];this.cpu=[];this.elapsed=0;this.running=true;this.result=null;this.maxActors=0;this.alivePlayerFrames=0;}
  sample(ms,{active=true,cpuMs=0,actors=0,playerAlive=true}={}){
    if(!this.running)return;
    if(!active){this.finish('interrupted');return;}
    if(!Number.isFinite(ms)||ms<=0||!Number.isFinite(cpuMs)||cpuMs<0){this.finish('invalid sample');return;}
    this.frames.push(ms);this.cpu.push(cpuMs);this.elapsed+=ms/1000;this.maxActors=Math.max(this.maxActors,actors);this.alivePlayerFrames+=playerAlive?1:0;
    if(this.elapsed>=this.seconds)this.finish('complete');
    else if(this.frames.length>=this.capacity)this.finish('capacity reached');
  }
  finish(status='cancelled'){
    if(!this.running)return;this.running=false;
    const summary=values=>{const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return n?{median:sorted[Math.ceil(n*.5)-1],p95:sorted[Math.ceil(n*.95)-1],p99:sorted[Math.ceil(n*.99)-1],max:sorted[n-1],over100:sorted.filter(v=>v>100).length}:null;};
    this.result={status,metadata:this.metadata,seconds:this.elapsed,frames:this.frames.length,frameMs:summary(this.frames),npcCpuMs:summary(this.cpu),maxActors:this.maxActors,playerAliveFraction:this.frames.length?this.alivePlayerFrames/this.frames.length:0};
    return this.result;
  }
}
