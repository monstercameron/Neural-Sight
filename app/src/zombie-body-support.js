import * as pc from 'playcanvas';

// Read the shipped skinned geometry once. Revival needs actual body support,
// not an ankle-only proxy while the character is still lying on its side.
export function createBodySupport(model){
  const groups=[];
  for(const render of model.findComponents('render'))for(const mi of render.meshInstances){
    const skin=mi.skinInstance;if(!skin?.bones?.length)continue;
    const positions=[],joints=[],weights=[];mi.mesh.getPositions(positions);mi.mesh.getVertexStream(pc.SEMANTIC_BLENDINDICES,joints);mi.mesh.getVertexStream(pc.SEMANTIC_BLENDWEIGHT,weights);
    if(!positions.length||weights.length!==positions.length/3*4||joints.length!==weights.length)continue;
    groups.push({positions,joints,weights,bones:skin.bones,inverse:skin.skin.inverseBindPose,matrices:skin.bones.map(()=>new pc.Mat4()),worldPositions:new Float64Array(positions.length)});
  }
  return groups;
}

export function bodySupportGap(groups,voxel,supportProbeY){
  let probeY=-Infinity;
  for(const g of groups??[]){
    // Reuse full-precision storage rather than allocate thousands of point
    // objects per actor per pose. Float64 retains the previous JS arithmetic.
    if(g.worldPositions?.length!==g.positions.length)g.worldPositions=new Float64Array(g.positions.length);
    for(let i=0;i<g.bones.length;i++)g.matrices[i].mul2(g.bones[i].getWorldTransform(),g.inverse[i]);
    for(let vertex=0;vertex<g.positions.length/3;vertex++){
      const px=g.positions[vertex*3],py=g.positions[vertex*3+1],pz=g.positions[vertex*3+2];let x=0,y=0,z=0;
      for(let k=0;k<4;k++){
        const index=vertex*4+k,w=g.weights[index];if(!w)continue;const m=g.matrices[g.joints[index]].data;
        x+=(m[0]*px+m[4]*py+m[8]*pz+m[12])*w;y+=(m[1]*px+m[5]*py+m[9]*pz+m[13])*w;z+=(m[2]*px+m[6]*py+m[10]*pz+m[14])*w;
      }
      const offset=vertex*3;g.worldPositions[offset]=x;g.worldPositions[offset+1]=y;g.worldPositions[offset+2]=z;
      probeY=Math.max(probeY,y+1);
    }
  }
  let gap=Infinity;
  if(Number.isFinite(supportProbeY))probeY=supportProbeY;
  // Every vertex matters on steps: a higher vertex can have less terrain
  // clearance than a lower neighbour. Start above the entire body so deeply
  // embedded vertices cannot evade the floor query during the rebase blend.
  // Runtime supplies a probe above the validated navigation floor but below
  // head height, so an overhead roof is not mistaken for ground support.
  for(const g of groups??[])for(let i=0;i<g.worldPositions.length;i+=3){
    const x=g.worldPositions[i],y=g.worldPositions[i+1],z=g.worldPositions[i+2];
    const hit=voxel.queryRay(x,probeY,z,0,-1,0,Math.max(3,probeY-y+1));
    if(hit)gap=Math.min(gap,y-hit.y-.008);
  }
  return Number.isFinite(gap)?gap:null;
}

export function supportRevival(actor,voxel,explicitWeight){
  const gap=bodySupportGap(actor.bodySupport,voxel,actor.p.y+.65);if(gap===null)return;
  const t=Math.max(0,Math.min(1,actor.time/.12)),weight=explicitWeight??t*t*(3-2*t);
  const correction=Math.min(.35,gap)*weight;
  const p=actor.model.getLocalPosition().clone();p.y-=correction;actor.model.setLocalPosition(p);
  actor.revivalSupport={gap,correction};
}
