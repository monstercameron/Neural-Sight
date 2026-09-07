// Teleport only: preserve loadout, ADS intent and committed weapon animations.
export function returnPlayerToSpawn({keys,fireInput,state,resetView,clearCrouchPreview}) {
  keys.clear();
  fireInput.clear();
  state.burst=0;
  state.hipShot=false;
  state.crouching=false;
  state.setMovement(false,false);
  clearCrouchPreview();
  // Resets authoritative position, camera orientation, eye height and velocity.
  resetView();
}
export const isSpawnResetKey=event=>event.code==='Backquote';

// Published capture positions are eyes. Starting above them can hit a ceiling
// (El Romeral) and move both the player and the navigation seed onto its roof.
export function findSpawnGround(voxel,spawn){
  return voxel.queryRay(spawn[0],spawn[1],spawn[2],0,-1,0,8);
}
