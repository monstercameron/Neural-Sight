// Conservative empty-space rejection for the shipped immutable voxel octree.
// Only skip the original sphere solver when its entire candidate voxel AABB is
// empty. Any occupied/unknown region uses the original solver and push-outs.
const counts=Uint8Array.from({length:256},(_,n)=>{let total=0;while(n){n&=n-1;total++;}return total;});
export function voxelAirBroadphase(voxel){
  if(!(voxel?.nodes instanceof Uint32Array)||!(voxel.leafData instanceof Uint32Array)||voxel.leafSize!==4||!Number.isInteger(voxel.treeDepth)||voxel.treeDepth<0||voxel.treeDepth>24)return voxel;
  if(![voxel.gridMinX,voxel.gridMinY,voxel.gridMinZ,voxel.numVoxelsX,voxel.numVoxelsY,voxel.numVoxelsZ,voxel.voxelResolution].every(Number.isFinite)||voxel.voxelResolution<=0)return voxel;
  // The original reader can repeat low-bit leaf masks beyond an undersized
  // tree. Such metadata is not safe for our spatial empty-box proof.
  const treeExtent=4*2**voxel.treeDepth;
  if(![voxel.numVoxelsX,voxel.numVoxelsY,voxel.numVoxelsZ].every(n=>Number.isInteger(n)&&n>0&&n<=treeExtent))return voxel;
  const wrapper=Object.create(voxel),nodes=voxel.nodes,leaves=voxel.leafData,res=voxel.voxelResolution;
  wrapper.querySphere=(cx,cy,cz,r,out)=>{
    if(![cx,cy,cz,r].every(Number.isFinite)||r<=0)return voxel.querySphere(cx,cy,cz,r,out);
    const x=voxel.flipXY?-cx:cx,y=voxel.flipXY?-cy:cy,z=cz;
    const minX=Math.max(0,Math.floor((x-r-voxel.gridMinX)/res)),maxX=Math.min(voxel.numVoxelsX-1,Math.floor((x+r-voxel.gridMinX)/res));
    const minY=Math.max(0,Math.floor((y-r-voxel.gridMinY)/res)),maxY=Math.min(voxel.numVoxelsY-1,Math.floor((y+r-voxel.gridMinY)/res));
    const minZ=Math.max(0,Math.floor((z-r-voxel.gridMinZ)/res)),maxZ=Math.min(voxel.numVoxelsZ-1,Math.floor((z+r-voxel.gridMinZ)/res));
    if(!nodes.length||minX>maxX||minY>maxY||minZ>maxZ)return false;
    function occupied(index,bx,by,bz,size){
      if(bx>maxX||by>maxY||bz>maxZ||bx+size<=minX||by+size<=minY||bz+size<=minZ)return false;
      if(index>=nodes.length)return true; // malformed data: never invent empty space
      const word=nodes[index]>>>0;if(word===0xff000000)return true;
      const mask=word>>>24,base=word&0xffffff;
      if(!mask){
        if(base*2+1>=leaves.length)return true;
        const lo=leaves[base*2],hi=leaves[base*2+1];if(!(lo||hi))return false;
        // The reader permits an early mixed leaf, whose mask repeats by local
        // modulo-4 indices. Treat it conservatively if above the normal leaf.
        if(size!==4)return true;
        for(let iz=Math.max(bz,minZ);iz<=Math.min(bz+3,maxZ);iz++)
          for(let iy=Math.max(by,minY);iy<=Math.min(by+3,maxY);iy++)
            for(let ix=Math.max(bx,minX);ix<=Math.min(bx+3,maxX);ix++){
              const bit=((iz&3)<<4)|((iy&3)<<2)|(ix&3);
              if(((bit<32?lo:hi)>>>(bit&31))&1)return true;
            }
        return false;
      }
      if(size<=4)return true;
      const half=size/2;
      for(let octant=0;octant<8;octant++)if(mask&(1<<octant)){
        const child=base+counts[mask&((1<<octant)-1)];
        if(occupied(child,bx+(octant&1)*half,by+((octant>>1)&1)*half,bz+((octant>>2)&1)*half,half))return true;
      }
      return false;
    }
    return occupied(0,0,0,0,4*2**voxel.treeDepth)?voxel.querySphere(cx,cy,cz,r,out):false;
  };
  return wrapper;
}
