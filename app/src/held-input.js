// Multiple bindings may own the same action; releasing one must not release all.
export class HeldInput {
  constructor(onChange){this.sources=new Set();this.onChange=onChange;}
  set(source,held){
    const was=this.sources.size>0;
    if(held)this.sources.add(source);else this.sources.delete(source);
    const active=this.sources.size>0;
    if(was!==active)this.onChange(active);
  }
  clear(){this.sources.clear();this.onChange(false);}
}
export const isCrouchHeld=keys=>keys.has('KeyC')||keys.has('ControlLeft')||keys.has('ControlRight');
export const isUiKeyEvent=e=>
  /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)||
  (e.target.tagName==='BUTTON'&&['Space','Enter'].includes(e.code))||
  (e.code==='Tab'&&!!e.target.closest?.('#lab'));
export const GAME_KEYS=new Set(['Space','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyZ','KeyC',
  'ControlLeft','ControlRight','ShiftLeft','ShiftRight','KeyX','KeyE','KeyR',
  'KeyV','KeyH','KeyN','KeyK','KeyF','KeyG','Home','Tab','Backquote']);
