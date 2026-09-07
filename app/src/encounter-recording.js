// Review recording only: no input injection, time stepping or actor mutation.
// Canvas composition and video encoding add overhead; never use these frames
// as a frame-pacing benchmark.
export class CaptureCadence {
  constructor(fps=30){this.interval=1000/fps;this.next=null;}
  due(now){if(this.next===null)this.next=now;if(now+1e-6<this.next)return false;this.next+=this.interval;if(this.next<now-this.interval)this.next=now+this.interval;return true;}
}
export class EncounterRecording {
  constructor({scene,weapon,audio,describe,onStatus}){Object.assign(this,{scene,weapon,audio,describe,onStatus});this.active=false;this.saving=false;this.starting=false;}
  async start(){
    if(this.active||this.saving||this.starting)return;
    if(typeof MediaRecorder==='undefined'||!MediaRecorder.isTypeSupported('video/webm'))throw Error('WebM recording is unavailable in this browser');
    this.starting=true;
    let stream,destination,master,handedOff=false;
    const cleanup=()=>{cancelAnimationFrame(this.raf);if(this.onHidden)document.removeEventListener('visibilitychange',this.onHidden);if(destination){try{master?.disconnect(destination);}catch{}destination.disconnect();}for(const track of stream?.getTracks()??[])track.stop();};
    try{
    await this.audio.unlock();
    if(!this.describe().playing||this.describe().manual)throw Error('Session paused before recording could start');
    const canvas=document.createElement('canvas');canvas.width=this.scene.width;canvas.height=this.scene.height;
    const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('Recording canvas unavailable');
    stream=canvas.captureStream(30);destination=this.audio.context.createMediaStreamDestination();
    master=this.audio.master;master.connect(destination);for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
    const recorder=new MediaRecorder(stream,{mimeType:MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')?'video/webm;codecs=vp8,opus':'video/webm',videoBitsPerSecond:6000000});
    const started=performance.now(),metadata={...this.describe(),width:canvas.width,height:canvas.height,requestedFps:30,scope:this.weapon?'Composited scene + weapon + master audio; excludes DOM HUD; not performance evidence':'Final scene canvas + master audio (includes weapon in shared-composite mode); excludes DOM HUD; not performance evidence'};
    const chunks=[],cadence=new CaptureCadence(30);let bytes=0,frames=0;
    this.active=true;this.recorder=recorder;this.reason='stopped';
    this.onHidden=()=>{if(document.hidden)this.stop('hidden-page');};document.addEventListener('visibilitychange',this.onHidden);
    const draw=now=>{
      if(!this.active)return;
      const live=this.describe();if(!live.playing||live.manual){this.stop('paused-or-preview');return;}
      if(cadence.due(now)){
        try{context.drawImage(this.scene,0,0,canvas.width,canvas.height);if(this.weapon)context.drawImage(this.weapon,0,0,canvas.width,canvas.height);frames++;}
        catch{this.stop('canvas-read-failed');return;}
      }
      const elapsed=(now-started)/1000;this.onStatus(`Recording ${elapsed.toFixed(1)} / 30 s`);
      if(elapsed>=30)this.stop('duration-limit');else this.raf=requestAnimationFrame(draw);
    };
    recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>60*1024*1024)this.stop('size-limit');}};
    recorder.onerror=()=>this.stop('encoder-error');
    recorder.onstop=async()=>{
      this.active=false;this.saving=true;cleanup();
      if(!frames){this.saving=false;this.onStatus('No video frames captured');return;}
      this.onStatus('Saving local review…');
      try{
        const blob=new Blob(chunks,{type:'video/webm'}),response=await fetch('/__review/capture',{method:'POST',headers:{'Content-Type':'video/webm','X-Neural-Sight-Review':'1','X-Review-Metadata':JSON.stringify({...metadata,seconds:(performance.now()-started)/1000,compositedFrames:frames,end:this.describe(),stopReason:this.reason})},body:blob});
        if(!response.ok){
          const signature=[...new Uint8Array(await blob.slice(0,8).arrayBuffer())].map(v=>v.toString(16).padStart(2,'0')).join(' ');
          throw Error(`Save failed (${response.status}) · ${blob.size} bytes · ${recorder.mimeType} · header ${signature||'empty'}`);
        }
        this.result=await response.json();this.onStatus('Saved local encounter recording',this.result);
      }catch(error){this.onStatus(error.message);}finally{this.saving=false;}
    };
    recorder.start(1000);handedOff=true;this.raf=requestAnimationFrame(draw);
    }finally{this.starting=false;if(!handedOff){this.active=false;this.saving=false;cleanup();}}
  }
  stop(reason='stopped'){if(!this.active)return;this.reason=reason;this.active=false;this.saving=true;if(this.recorder.state!=='inactive')this.recorder.stop();}
}
