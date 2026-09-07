// Opt-in QA clock only. Normal sessions never construct this controller.
export const REVIEW_LOOK_STEPS=[['Look left 6°',-6,0],['Look right 6°',6,0],
  ['Look left 2°',-2,0],['Look right 2°',2,0],['Look up 1°',0,-1],['Look down 1°',0,1]];
export const REVIEW_STEP_RATES=[30,60,75,120,144,165,240];
export class OpticsSweep {
  constructor(){this.time=0;this.angle=0;}
  update(dt){
    if(!(dt>0))return 0;
    this.time+=dt;const angle=12*Math.sin(this.time*Math.PI/3),delta=angle-this.angle;
    this.angle=angle;return delta;
  }
}
export class MotionReviewClock {
  constructor(){this.running=false;this.frames=0;this.time=0;this.stepRate=120;}
  setStepRate(rate){
    if(!REVIEW_STEP_RATES.includes(Number(rate)))return;
    this.stepRate=Number(rate);this.running=false;this.frames=0;
  }
  step(frames=1){this.running=false;this.frames+=frames;}
  describe(){return {kind:'motion-review',mode:this.running?'running':'frame-step',simulationTime:this.time,stepRate:this.stepRate,queuedFrames:this.frames,performanceEvidence:false};}
  tick(dt){
    if(!(dt>0))return 0;
    const amount=this.running?dt:this.frames>0?1/this.stepRate:0;
    if(!this.running&&this.frames>0)this.frames--;
    this.time+=amount;return amount;
  }
}
export function mountMotionReview({container,look,aim,reset,fire=()=>{},isFiring=()=>false,move=()=>{},reload=()=>{},mode=()=>{}}){
  const clock=new MotionReviewClock(),panel=document.createElement('section');
  panel.setAttribute('aria-label','Motion review controls');panel.style.cssText='border-bottom:1px solid #ffffff30;padding-bottom:12px;margin-bottom:14px';
  const title=document.createElement('strong');title.textContent='FRAME-STEP MOTION REVIEW';panel.append(title);
  const status=document.createElement('p');status.id='motion-review-status';panel.append(status);
  const rate=document.createElement('select');rate.setAttribute('aria-label','Review simulation step rate');
  for(const hz of REVIEW_STEP_RATES){const option=document.createElement('option');option.value=String(hz);option.textContent=`${hz} Hz simulation steps`;rate.append(option);}
  rate.value=String(clock.stepRate);rate.addEventListener('change',()=>clock.setStepRate(rate.value));panel.append(rate);
  const actions=[['Step 1 frame',()=>clock.step()],['Advance 8 frames',()=>clock.step(8)],['Play review',()=>{clock.running=true;clock.frames=0;}],['Freeze review',()=>{clock.running=false;clock.frames=0;stopAction();}],['Toggle review ADS',aim],['Reset review',()=>{stopAction();clock.running=false;clock.frames=0;clock.time=0;sweep=null;sweepButton.textContent='Start optics sweep';reset();}]];
  for(const [label,fn] of actions){const button=document.createElement('button');button.textContent=label;button.addEventListener('click',fn);panel.append(button);}
  // QA-only, user-visible repeatable motion through the real look handler.
  // Never created in ordinary sessions; pausing the review also pauses sweep.
  let sweep=null;const sweepButton=document.createElement('button');
  sweepButton.textContent='Start optics sweep';
  sweepButton.addEventListener('click',()=>{
    if(sweep){look(-sweep.angle/.11,0);sweep=null;clock.running=false;}
    else {stopAction();sweep=new OpticsSweep();clock.running=true;clock.frames=0;}
    sweepButton.textContent=sweep?'Stop optics sweep':'Start optics sweep';
  });panel.append(sweepButton);
  const tick=clock.tick.bind(clock),describe=clock.describe.bind(clock);
  let actionReview=null;
  const actionButton=document.createElement('button');actionButton.textContent='Start film action review · 24s';
  const stopAction=()=>{if(actionReview){move([]);fire(false);actionReview=null;}actionButton.textContent='Start film action review · 24s';};
  actionButton.addEventListener('click',()=>{
    if(actionReview){stopAction();return;}
    reset();sweep=null;sweepButton.textContent='Start optics sweep';clock.time=0;clock.frames=0;clock.running=true;
    actionReview={time:0,index:0,yaw:0};actionButton.textContent='Stop film action review';
  });panel.append(actionButton);
  // QA only: real movement and state-machine inputs, no pose teleporting during
  // the sequence. Labels and timestamps remain available in recorded metadata.
  const sequence=[
    [1,'slow pan',()=>{}],[3,'ADS raise',aim],[4,'ADS single',()=>fire(true)],
    [4.2,'release',()=>fire(false)],[5,'burst mode',mode],[5.3,'ADS burst',()=>fire(true)],
    [5.7,'release',()=>fire(false)],[6.5,'auto mode',mode],[7,'ADS auto',()=>fire(true)],
    [8,'release',()=>fire(false)],[8.5,'ADS reload',reload],[12,'ADS lower',aim],
    [13,'hip fire',()=>fire(true)],[14,'release',()=>fire(false)],
    [16,'strafe right',()=>move(['KeyD'])],[16.7,'strafe left',()=>move(['KeyA'])],
    [17.4,'stop strafe',()=>move([])],[18,'sprint',()=>move(['KeyW','ShiftLeft'])],
    [19.2,'sprint stop + ADS',()=>{move([]);aim();}],
    [21,'crouch ADS',()=>move(['ControlLeft'])],[22,'stand',()=>move([])],
    [23,'lower',aim],[24,'complete',stopAction],
  ];
  clock.tick=dt=>{
    const admitted=tick(dt);if(sweep)look(sweep.update(admitted)/.11,0);
    if(actionReview&&admitted>0){
      actionReview.time+=admitted;
      const t=actionReview.time,target=t<1?0:t<3?6*Math.sin((t-1)*Math.PI):t<16?0:4*Math.sin((t-16)*Math.PI/2);
      look((target-actionReview.yaw)/.11,0);actionReview.yaw=target;
      while(actionReview&&actionReview.index<sequence.length&&sequence[actionReview.index][0]<=t){const event=sequence[actionReview.index++];actionReview.stage=event[1];event[2]();}
    }
    if(actionReview&&dt===0){stopAction();}
    return admitted;
  };
  clock.describe=()=>({...describe(),...(sweep?{opticsSweep:{seconds:sweep.time,yaw:sweep.angle,period:6,amplitude:12}}:{}),...(actionReview?{filmAction:{seconds:actionReview.time,stage:actionReview.stage??'idle'}}:{})});
  // Small controlled inputs separate cone interior from its boundary and let
  // reviewers inspect vertical counter-steering through the real look handler.
  for(const [label,dx,dy] of REVIEW_LOOK_STEPS){
    const button=document.createElement('button');button.textContent=label;
    button.addEventListener('click',()=>look(dx/.11,dy/.11));panel.append(button);
  }
  const trigger=document.createElement('button');trigger.textContent='Hold review trigger';
  trigger.setAttribute('aria-pressed','false');
  trigger.addEventListener('click',()=>fire(!isFiring()));panel.append(trigger);
  container.prepend(panel);
  clock.publish=({offset,state})=>{
    // Reflect real input ownership; pause/blur/reset can release the trigger.
    trigger.setAttribute('aria-pressed',String(isFiring()));
    status.textContent=`${clock.running?'PLAYING':'FROZEN'} · ${clock.time.toFixed(4)} s · ${state} · follow ${offset.x.toFixed(5)}, ${offset.y.toFixed(5)}`;
  };
  return clock;
}
