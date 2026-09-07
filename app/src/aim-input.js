export class AimInput {
  constructor(onChange=()=>{},mode='hold') {
    this.onChange=onChange;this.mode=mode==='toggle'?'toggle':'hold';
    this.sources=new Set();this.active=false;
  }
  publish(value) {this.active=value;this.onChange(value);}
  setMode(mode) {this.mode=mode==='toggle'?'toggle':'hold';this.clear();}
  press(source) {
    if(this.sources.has(source))return;
    this.sources.add(source);
    this.publish(this.mode==='hold'?true:!this.active);
  }
  release(source) {
    this.sources.delete(source);
    if(this.mode==='hold')this.publish(this.sources.size>0);
  }
  clear() {this.sources.clear();this.publish(false);}
}

// Keep each physical keyboard key independent, just like mouse/X ownership.
export function bindAimButton(button,aimInput,pressAim){
  const keys=['Space','Enter'];
  button.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    button.setPointerCapture(e.pointerId);pressAim('button');
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])
    button.addEventListener(type,()=>aimInput.release('button'));
  button.addEventListener('keydown',e=>{
    if(!keys.includes(e.code))return;
    e.preventDefault();if(!e.repeat)pressAim(`button-key-${e.code}`);
  });
  button.addEventListener('keyup',e=>{
    if(keys.includes(e.code)){e.preventDefault();aimInput.release(`button-key-${e.code}`);}
  });
  button.addEventListener('blur',()=>{
    for(const key of keys)aimInput.release(`button-key-${key}`);
  });
}
