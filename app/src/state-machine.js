import {HIP_PHASE,HIP_TRANSITIONS} from './hip-pose.js';
import {carryEdge,carryPhase,carryFrame} from './carry-path.js';
import {fullestSpare,packingPair,packRound,roundsToPack,PACK_ROUND_SECONDS} from './magazines.js';
export class WeaponState {
  constructor({random=Math.random}={}) {
    this.random=random;
    this.reset();
  }
  reset() {
    this.carryPath=null;this.runClock=0;
    this.state = "lowReady";
    this.pose = "lowReady";
    this.previousPose = "lowReady";
    this.time = 0;
    this.duration = 0;
    this.aim = false;
    this.moving = false;
    this.sprintRequested = false;
    this.crouching = false;
    this.magazineCapacity = 30;
    this.ammo = this.magazineCapacity;
    this.magazines=[30,30,30];
    this.reloadSlot=-1;
    this.repackedRounds=0;this.packMoved=0;
    this.mode = "single";
    this.held = false;
    this.pendingShot = false;
    this.reloadRequested = false;
    this.burst = 0;
    this.cooldown = 0;
    this.shots = 0;
    this.dryFires = 0;
    this.hipRecovery = 0;
    this.firePoseHold=0;
    this.hipShot=false;
    this.idleSettle=0;
    this.clipFrom=0;this.clipTo=0;this.clipSlope=0;
    this.lastShotStance = "hipFire";
    this.reaction = 0;
    this.events = [];
    this.log("Ready");
  }
  log(text) {
    this.events.unshift(text);
    this.events.length = Math.min(this.events.length, 5);
  }
  transition(state, pose, duration, end) {
    this.carryPath=null;
    this.clipSlope=0;
    this.previousPose = this.pose;
    this.pose = pose;
    this.state = state;
    this.time = 0;
    // Vary only the non-critical return, never reload timing or shot cadence.
    this.duration = ['lowering','exitRun'].includes(state)?duration*this.varied(.94,1.06):duration;
    this.end = end;
    this.log(state);
  }
  get busy() {
    return this.duration > 0;
  }
  get reserveAmmo(){return this.magazines.reduce((sum,count)=>sum+count,0);}
  // Fixture/import compatibility only: gameplay reloads never use pooled rounds.
  set reserveAmmo(total){
    let left=Math.max(0,Math.min(90,Math.floor(Number(total)||0)));
    this.magazines=Array.from({length:3},()=>{const n=Math.min(30,left);left-=n;return n;});
  }
  get canReload(){return fullestSpare(this.magazines,this.ammo)>=0 && this.ammo<this.magazineCapacity;}
  startRepack(){
    if(this.busy||['dead','death','noGun'].includes(this.state))return false;
    const steps=roundsToPack([this.ammo,...this.magazines],this.magazineCapacity);
    if(!steps){this.log('No partial magazines to consolidate');return false;}
    this.held=false;this.pendingShot=false;this.hipShot=false;this.burst=0;this.hipRecovery=0;this.reloadRequested=false;
    this.packMoved=0;
    this.transition('repack','lowReady',steps*PACK_ROUND_SECONDS,'lowReady');return true;
  }
  stopRepack(){
    if(this.state!=='repack')return;
    this.state=this.pose=this.previousPose='lowReady';this.duration=0;this.time=0;
    this.idleSettle=this.varied(.08,.16);this.log(`Packed ${this.packMoved} rounds`);
  }
  get progress() {
    return this.busy ? Math.min(1, this.time / this.duration) : 1;
  }
  varied(min,max){return min+(max-min)*Math.max(0,Math.min(1,this.random()));}
  get presentationPhase(){
    if(this.carryPath){const phase=carryPhase(this.carryPath,this.time);
      return this.carryPath.clip==='raising'?phase:this.carryPath.clip==='runFromADS'?1-phase:0;}
    if(['raising','lowering'].includes(this.state))return this.clipFrom+(this.clipTo-this.clipFrom)*this.progress;
    if(HIP_TRANSITIONS.includes(this.state)) {
      const t=this.progress,smooth=t*t*(3-2*t)+this.clipSlope*t*(1-t)*(1-t);
      return this.clipFrom+(this.clipTo-this.clipFrom)*smooth;
    }
    return this.state==='hipFire'?HIP_PHASE:this.state==='ads'?1:0;
  }
  get presentationVelocity(){
    if(!this.busy||!HIP_TRANSITIONS.includes(this.state))return 0;
    const t=this.progress;
    return (this.clipTo-this.clipFrom)/this.duration*
      (6*t*(1-t)+this.clipSlope*(3*t*t-4*t+1));
  }
  poseTransition(state,to,duration,end) {
    const from=this.presentationPhase,velocity=this.presentationVelocity;
    this.transition(state,to===0?'lowReady':'ads',duration,end);
    this.clipFrom=from;this.clipTo=to;
    // Same-direction retiming keeps existing momentum instead of stopping the
    // filmed lowering for a frame. A monotone Hermite start slope in [0,3]
    // cannot overshoot; deliberate reversals still respond from rest promptly.
    this.clipSlope=to===from?0:Math.max(0,Math.min(3,velocity*this.duration/(to-from)));
  }
  get wantsShot(){return this.hipShot||this.pendingShot||this.burst>0||(this.mode==='auto'&&this.held);}
  get hipFraming(){
    const phase=this.presentationPhase;
    // One framing profile per source pose, including ADS interruptions made
    // before the raise has reached HIP. Switching edge names must not turn a
    // 20%-raised gun instantly into a fully lowered/shrunken hip viewmodel.
    if(this.state==='hipFire'||HIP_TRANSITIONS.includes(this.state))
      return Math.max(0,Math.min(1,phase<=HIP_PHASE?phase/HIP_PHASE:(1-phase)/(1-HIP_PHASE)));
    return 0;
  }
  get runCarryWeight(){
    if(this.carryPath?.b==='run')return carryPhase(this.carryPath,this.time);
    return this.state==='run'?1:0;
  }
  get sprintIntent(){return this.moving&&this.sprintRequested&&!this.aim&&!this.crouching&&!this.held&&!this.wantsShot;}
  get carryTarget(){return this.aim?'ads':this.sprintIntent?'run':'lowReady';}
  get carryFrame(){
    if(!this.matchedRun)return null;
    if(this.carryPath)return carryFrame(this.carryPath,this.time);
    if(this.state==='run')return {clip:'runLateral',phase:(this.runClock%1.6)/1.6};
    // One canonical idle pose, never a cut to an unrelated idle video's current frame.
    if(this.state==='lowReady')return {clip:'raising',phase:0};
    if(this.state==='ads')return {clip:'raising',phase:1};
    return null;
  }
  beginCarry(edge,from,to,loopPhase=null){
    const target=to===0?edge.a:edge.b;
    const lead=loopPhase===null||this.animatedRun===false?0:.065;
    const travel=Math.max(.001,Math.abs(to-from)*edge.duration);
    this.transition(target==='ads'?'raising':target==='run'?'enterRun':'lowering',target,lead+travel,target);
    // Critical input reversals are deterministic; no random return duration here.
    this.duration=lead+travel;
    this.carryPath={...edge,from,to,lead,travel,loopFrom:loopPhase??0,loopTo:(loopPhase??0)>.5?1:0};
  }
  resolveCarry(){
    if(!this.matchedRun)return false;
    const target=this.carryTarget;
    if(this.carryPath){
      const edge=this.carryPath,phase=carryPhase(edge,this.time);
      // A third-node interruption reaches the nearest shared endpoint first.
      const to=target===edge.a?0:target===edge.b?1:phase<.5?0:1;
      if(to!==edge.to){
        const frame=this.carryFrame;
        this.beginCarry(edge,phase,to,frame.clip==='runLateral'?frame.phase:null);return true;
      }
      return false;
    }
    if(!this.busy && !this.reloadRequested && !(this.ammo===0&&this.reserveAmmo>0&&this.cooldown<=0) && ['lowReady','ads','run'].includes(this.state) && this.state!==target){
      // Hip firing owns its existing raise path, not an unnecessary ADS→low-ready detour.
      if(this.state==='ads'&&this.wantsShot&&!this.aim)return false;
      const edge=carryEdge(this.state,target);
      this.beginCarry(edge,this.state===edge.a?0:1,target===edge.a?0:1,
        this.state==='run'?(this.runClock%1.6)/1.6:null);
      return true;
    }
    return false;
  }
  aimTransition(aiming){
    const from=this.presentationPhase,to=aiming?1:0;
    this.transition(aiming?'raising':'lowering',aiming?'ads':'lowReady',
      Math.max(.06,(aiming?.28:.22)*Math.abs(to-from)),aiming?'ads':'lowReady');
    this.clipFrom=from;this.clipTo=to;
  }
  setAim(value) {
    this.aim = value;
  }
  setMovement(moving, running) {
    if(this.moving && !moving && !this.busy)this.idleSettle=this.varied(.08,.16);
    this.moving = moving;
    this.sprintRequested = running;
  }
  get running() {
    // Keep Shift intent, but ADS owns the weapon and locomotion priority.
    // Wait until lowering finishes before resuming the held sprint request.
    return this.moving && this.sprintRequested && !this.aim && !this.crouching &&
      !this.held && !this.wantsShot && this.hipRecovery===0 &&
      !["ads", "raising", "lowering", ...HIP_TRANSITIONS, "reload", "reloadADS", "repack", "death", "dead"].includes(this.state);
  }
  trigger(down) {
    if(!down){this.held=false;this.pendingShot=false;return;}
    if(this.held)return;
    // Hard actions require a fresh press afterward. Soft posture transitions
    // retain input, so ADS/run recovery cannot swallow a held trigger.
    if(this.reloadRequested || ['reload','reloadADS','repack','equip','stow','death','dead','noGun'].includes(this.state))return;
    this.held=true;
    if(this.mode==='burst')this.burst=3;
    if(!this.aim && ['lowReady','hipLower','hipRaise'].includes(this.state)) {
      if(this.mode==='single')this.hipShot=true;
      if(this.state!=='hipRaise')this.poseTransition('hipRaise',HIP_PHASE,.22,'hipFire');
      return;
    }
    if(this.mode==='single') {
      const ready=!this.busy && ['ads','hipFire'].includes(this.state) &&
        this.aim===(this.state==='ads') && this.cooldown<=0;
      if(ready)this.fire();
      else if(!this.aim)this.hipShot=true; // A hip tap survives a sprint/pose transition.
      else this.pendingShot=true;
    }
  }
  fire(cadenceRemainder=0) {
    if (
      this.cooldown > 0 ||
      this.busy ||
      !["ads", "hipFire"].includes(this.state)
    )
      return;
    // Carry only uninterrupted scheduled fire's sub-frame lateness. The final
    // round still gets its full visible recoil interval before auto-reload.
    this.cooldown = 0.1-(this.ammo>1?Math.max(0,Math.min(.099,cadenceRemainder)):0);
    if (this.ammo === 0) {
      this.dryFires++;
      this.log("Dry fire");
      this.burst = 0;
      this.held = false;
      return;
    }
    this.ammo--;
    this.shots++;
    this.lastShotStance = this.state === "ads" ? "ads" : "hipFire";
    if(this.lastShotStance === "hipFire") {
      this.state = "hipFire";
      this.pose = this.previousPose = "ads";
      this.hipRecovery = this.varied(.75,1.35);
      this.firePoseHold=Math.max(0,Math.min(.2,this.shotPresentationDuration||0));
    }
    this.reaction = 0.1;
    this.idleSettle=this.varied(.10,.18);
    this.log(`Shot ${this.shots} · ${this.mode}`);
  }
  reload() {
    if(this.busy && ['raising','lowering','enterRun','exitRun',...HIP_TRANSITIONS].includes(this.state)) {
      if(this.canReload) {
        this.reloadRequested=true;this.held=false;this.pendingShot=false;this.hipShot=false;this.burst=0;
      }
      return;
    }
    if (
      this.busy ||
      this.state === "dead" ||
      this.state === "noGun" ||
      !this.canReload
    )
      return;
    this.held = false;
    this.pendingShot=false;this.hipShot=false;this.reloadRequested=false;this.hipRecovery=0;
    this.burst = 0;
    this.reloadSlot=fullestSpare(this.magazines,this.ammo);
    if(this.state === "ads")
      this.transition("reloadADS", "ads", 4, "ads");
    else
      this.transition("reload", "lowReady", 4, "lowReady");
  }
  equip() {
    if (this.busy || this.state === "dead") return;
    this.held = false;
    this.pendingShot=false;this.hipShot=false;this.reloadRequested=false;this.hipRecovery=0;
    this.burst = 0;
    if (this.state === "noGun")
      this.transition("equip", "lowReady", 0.7, "lowReady");
    else {
      this.aim = false;
      this.transition("stow", "noGun", 0.5, "noGun");
    }
  }
  changeMode() {
    this.mode = ["single", "burst", "auto"][
      (["single", "burst", "auto"].indexOf(this.mode) + 1) % 3
    ];
    this.burst = 0;
    this.held = false;
    this.pendingShot=false;
    this.hipShot=false;
    this.log(this.mode);
  }
  hit(near = false) {
    if (this.state !== "dead") {
      this.reaction = near ? 0.16 : 0.35;
      this.idleSettle=this.reaction+this.varied(.08,.16);
      this.log(near ? "Near miss" : "Hit reaction");
    }
  }
  die() {
    this.held = false;
    this.pendingShot=false;this.hipShot=false;this.hipRecovery=0;this.reloadRequested=false;this.aim=false;
    this.burst = 0;
    this.transition("death", "noGun", 0.8, "dead");
  }
  update(dt) {
    dt = Math.max(0, Math.min(dt, 0.1));
    if(dt===0)return;
    if(this.state==='run')this.runClock+=dt;
    this.reaction = Math.max(0, this.reaction - dt);
    // Never bank shot debt while idle, blocked or changing posture. A sustained
    // auto/committed burst may carry just the current cooldown's overshoot.
    const cadenceRemainder=this.cooldown>0 && !this.busy &&
      ['ads','hipFire'].includes(this.state) && this.wantsShot &&
      (this.mode==='auto'&&this.held || this.mode==='burst'&&this.burst>0)
      ?Math.max(0,dt-this.cooldown):0;
    this.cooldown = Math.max(0, this.cooldown - dt);
    // Exact 100ms intervals accumulate tiny positive IEEE-754 remainders at
    // common refresh rates. They must not add a whole frame to every shot.
    if(this.cooldown<1e-9)this.cooldown=0;
    this.hipRecovery = Math.max(0, this.hipRecovery - dt);
    this.firePoseHold=Math.max(0,this.firePoseHold-dt);
    this.idleSettle=Math.max(0,this.idleSettle-dt);
    if(this.state==='repack') {
      this.time+=dt;
      const due=Math.floor((this.time+1e-9)/PACK_ROUND_SECONDS);
      while(this.packMoved<due) {
        const rounds=[this.ammo,...this.magazines];
        if(!packRound(rounds,this.magazineCapacity))break;
        [this.ammo,...this.magazines]=rounds;
        this.packMoved++;this.repackedRounds++;
      }
      if(!packingPair([this.ammo,...this.magazines],this.magazineCapacity))this.stopRepack();
      return;
    }
    if(this.aim && ['hipFire','hipRaise','hipLower'].includes(this.state)) {
      this.poseTransition('hipToADS',1,.18,'ads');return;
    }
    if(!this.aim && this.state==='hipToADS') {
      this.poseTransition('adsToHip',HIP_PHASE,.18,'hipFire');return;
    }
    if(this.aim && this.state==='adsToHip') {
      this.poseTransition('hipToADS',1,.18,'ads');return;
    }
    // Long hip-fire settling is for idle only; an explicit sprint request must
    // not wait through the passive hold and slow return.
    // Matched clips must reach lowReady before runFromLow. Testing end !== run
    // here restarted that same transition every frame and pinned its clock at 0.
    // Expedite only a genuinely slower remaining return; already-fast returns
    // keep advancing, including after a quick Shift release/re-press.
    if(this.sprintIntent && this.firePoseHold<=0 && (this.state==='hipFire'||this.state==='hipLower'&&this.duration-this.time>.16)) {
      this.hipRecovery=0;this.poseTransition('hipLower',0,.16,this.matchedRun?'lowReady':'run');return;
    }
    if(this.resolveCarry())return;
    // Interrupt either side of a run transition immediately. Never interrupt
    // reload/equip/death and never bounce back to run while aim remains held.
    if (!this.carryPath && this.aim && ["enterRun", "run", "exitRun"].includes(this.state)) {
      this.aimTransition(true);
      return;
    }
    if(!this.carryPath&&this.state==='raising'&&!this.aim){this.aimTransition(false);return;}
    if(!this.carryPath&&this.state==='lowering'&&this.aim){this.aimTransition(true);return;}
    if(!this.carryPath&&this.state==='enterRun' && !this.running) {
      this.transition('exitRun','lowReady',.12,'lowReady');return;
    }
    if(!this.carryPath&&this.state==='exitRun'&&this.sprintIntent){this.transition('enterRun','run',.14,'run');return;}
    if (this.busy) {
      this.time += dt;
      // Fixed frame steps can undershoot an exact endpoint by IEEE-754 residue.
      // Ignore only sub-nanosecond error, not a genuinely unfinished action.
      if (this.time + 1e-9 >= this.duration) {
        if (this.state === "reload" || this.state === "reloadADS") {
          // Atomic physical swap; retain the outgoing magazine exactly as-is.
          if(this.reloadSlot>=0)[this.ammo,this.magazines[this.reloadSlot]]=[this.magazines[this.reloadSlot],this.ammo];
          this.reloadSlot=-1;
        }
        this.state = !this.matchedRun&&this.state==='lowering'&&this.sprintIntent?'run':this.end;
        this.carryPath=null;
        if(this.state==='run')this.runClock=0;
        if(this.state==='run')this.pose='run';
        this.duration = 0;
        this.previousPose = this.pose;
        if(['lowReady','ads','hipFire','run','noGun'].includes(this.state))this.idleSettle=this.varied(.08,.16);
      }
      if(this.busy)return;
    }
    if(this.resolveCarry())return;
    if (this.state === "dead" || this.state === "noGun") return;
    if(this.reloadRequested){this.reloadRequested=false;this.reload();return;}
    // Leave the final shot visible/audible for its recoil interval, then reload
    // before locomotion/aim can start another transition. Never advance paused.
    if (dt > 0 && this.ammo === 0 && this.reserveAmmo > 0 && this.cooldown <= 0) {
      this.reload();
      return;
    }
    if (this.running && this.state !== "run") {
      this.burst = 0;
      this.held = false;
      this.transition("enterRun", "run", .14, "run");
      return;
    }
    if (!this.running && this.state === "run") {
      this.transition("exitRun", "lowReady", .12, "lowReady");
      return;
    }
    if (this.state === "run") return;
    if (this.aim && this.state==='lowReady') {
      this.aimTransition(true);
      return;
    }
    if (!this.aim && this.state === "ads") {
      if(this.wantsShot){this.poseTransition('adsToHip',HIP_PHASE,.18,'hipFire');return;}
      this.aimTransition(false);
      return;
    }
    if(this.state==='lowReady' && this.wantsShot) {
      this.poseTransition('hipRaise',HIP_PHASE,.22,'hipFire');return;
    }
    if (this.cooldown <= 0 && this.wantsShot) {
      this.fire(cadenceRemainder);
      this.pendingShot=false;this.hipShot=false;
      if (this.burst > 0) this.burst--;
    }
    if(this.state === "hipFire" && this.hipRecovery <= 0 &&
      this.burst === 0 && !(this.mode === "auto" && this.held)) {
      this.poseTransition('hipLower',0,this.varied(.5,.85),'lowReady');
    }
  }
}
