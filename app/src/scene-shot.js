import {raycastVoxel} from './ballistics.js';

// One nearest-surface decision shared by the game and encounter regression
// tests. Each successive query is bounded by the closest existing hit.
export function resolveSceneShot({voxel,balls,zombies},origin,direction,range){
  const wall=raycastVoxel(voxel,origin,direction,range);
  const prop=balls.raycast(origin,direction,wall?.distance??range)??wall;
  return zombies.raycast(origin,direction,prop?.distance??range)??prop;
}

export function applySceneShot({balls,zombies,impacts},record){
  if(record.hit.zombieId!==undefined)zombies.shoot(record);
  else if(record.hit.ballId!==undefined)balls.shoot(record.hit.ballId,record.direction);
  else impacts.spawn(record);
}
