// Pointer lock is requested directly from a user gesture (before audio awaits).
export function bindFpsMouse({canvas,doc,win,isPlaying,look,fire,aim,unlock,onStatus}) {
  let requesting=false;
  const capture=()=>{
    if(!isPlaying() || requesting || doc.pointerLockElement===canvas)return;
    if(!canvas.requestPointerLock){onStatus('Mouse capture unavailable · use a regular browser');return;}
    requesting=true;
    try {
      Promise.resolve(canvas.requestPointerLock()).catch(()=>{
        requesting=false;onStatus('Mouse capture blocked · click the viewport to retry');
      });
    } catch {requesting=false;onStatus('Mouse capture blocked · click the viewport to retry');}
  };
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  // Mouse events report EVERY button edge. Pointer events only report first
  // button down / last button up and therefore lose ADS+fire chords.
  canvas.addEventListener('mousedown',e=>{
    if(!isPlaying())return;
    canvas.focus();
    if(e.button===0){e.preventDefault();capture();fire(true);}
    if(e.button===2){e.preventDefault();aim(true);}
  });
  win.addEventListener('mouseup',e=>{
    if(e.button===0)fire(false);
    if(e.button===2)aim(false);
  });
  win.addEventListener('pointercancel',()=>{fire(false);aim(false);});
  doc.addEventListener('mousemove',e=>{
    if(isPlaying() && doc.pointerLockElement===canvas)look(e.movementX,e.movementY);
  });
  doc.addEventListener('pointerlockchange',()=>{
    requesting=false;
    if(doc.pointerLockElement===canvas){
      // Capture may resolve after Escape/visibility loss paused the session.
      if(!isPlaying()){
        fire(false);aim(false);doc.exitPointerLock();
        onStatus('Mouse capture released · resume to play');return;
      }
      onStatus('Mouse look · left click fire · right click aim · Space jump · Esc release');
    }
    else {fire(false);aim(false);unlock();onStatus('Click viewport to capture mouse · Space jump');}
  });
  doc.addEventListener('pointerlockerror',()=>{
    requesting=false;onStatus('Mouse capture blocked · click the viewport to retry');
  });
  return {capture};
}
