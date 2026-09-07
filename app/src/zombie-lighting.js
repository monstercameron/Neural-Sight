import * as pc from 'playcanvas';

// Scene.ambientLight is an encoded color; ForwardRenderer linearizes it before
// dispatch. Express fill in linear radiance here, then encode exactly once.
// Keep a cooler sky fill beneath the existing warmer directional daylight.
export const ZOMBIE_SKY_FILL=Object.freeze([.28,.32,.38]);
export function zombieAmbientColor(){return new pc.Color(...ZOMBIE_SKY_FILL).gamma();}
