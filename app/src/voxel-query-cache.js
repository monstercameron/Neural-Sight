// Exact, bounded occupancy memoization for immutable captured-level colliders.
// Contact geometry, radii and push-out calculations are unchanged. Hash
// collisions replace entries; all three integer coordinates are checked.
const worlds=new WeakMap();
export function cachedVoxelQueries(voxel){
  if(!voxel || typeof voxel.isVoxelSolid!=='function')return voxel;
  let cached=worlds.get(voxel);if(cached)return cached;
  const size=1<<17,mask=size-1,xs=new Int32Array(size),ys=new Int32Array(size),zs=new Int32Array(size),values=new Uint8Array(size);
  cached=Object.create(voxel);
  cached.isVoxelSolid=(x,y,z)=>{
    const index=(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))&mask;
    if(values[index]&&xs[index]===x&&ys[index]===y&&zs[index]===z)return values[index]===2;
    const solid=voxel.isVoxelSolid(x,y,z);
    xs[index]=x;ys[index]=y;zs[index]=z;values[index]=solid?2:1;return solid;
  };
  worlds.set(voxel,cached);worlds.set(cached,cached);return cached;
}
