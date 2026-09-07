// A connected walkable graph, not a straight-line chase or a render mesh guess.
export const ZOMBIE_RADIUS=.25, ZOMBIE_HEIGHT=1.78;
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function standingClear(voxel,p,bounds,r=ZOMBIE_RADIUS){
  if(!voxel)return false;
  if(bounds&&(p.x-r<bounds.min[0]||p.x+r>bounds.max[0]||p.z-r<bounds.min[2]||p.z+r>bounds.max[2]||p.y+ZOMBIE_HEIGHT>bounds.max[1]))return false;
  const push={x:0,y:0,z:0};
  // Keep bottom sphere off the contact surface; the ground sample owns support.
  for(let h=r+.045;h<ZOMBIE_HEIGHT-r+.01;h+=.18)
    if(voxel.querySphere(p.x,p.y+h,p.z,r,push))return false;
  return true;
}
export function groundNear(voxel,x,y,z,bounds){
  const hit=voxel.queryRay(x,y+.42,z,0,-1,0,.95);
  if(!hit||Math.abs(hit.y-y)>.43)return null;
  const p={x,y:hit.y+.025,z};
  if(standingClear(voxel,p,bounds))return p;
  // Do not drop the capsule onto the lower tread while its footprint still
  // overlaps the higher ledge. Retain the supported height until it clears.
  // This is not permission to float: require nearby ground at that height.
  if(p.y<y&&y-p.y<=.37&&standingClear(voxel,{x,y,z},bounds)){
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4,r=ZOMBIE_RADIUS*.8;
      const support=voxel.queryRay(x+Math.cos(angle)*r,y+.1,z+Math.sin(angle)*r,0,-1,0,.18);
      if(support&&Math.abs(support.y+.025-y)<=.055)return {x,y,z};
    }
  }
  return null;
}
export function walkableEdge(voxel,a,b,bounds,probe=groundNear){
  if(Math.abs(a.y-b.y)>.37)return false;
  const spacing=Math.min(.025,(voxel.voxelResolution??.05)*.5);
  const steps=Math.ceil(distance(a,b)/spacing);let height=a.y;
  for(let i=1;i<=steps;i++){
    const t=i/steps,p=probe(voxel,a.x+(b.x-a.x)*t,height,a.z+(b.z-a.z)*t,bounds);
    if(!p)return false;
    height=p.y;
  }
  return true;
}
// Exact horizontal segment/capsule test for a snapshot of living neighbours.
// Local steering still validates every actual step as those neighbours move.
export function crowdEdgeClear(a,b,obstacles=[]){
  const dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz,r=.53-1e-6;
  return obstacles.every(p=>{
    if(Math.abs(p.y-a.y)>=1.2&&Math.abs(p.y-b.y)>=1.2)return true;
    const startGap=Math.hypot(a.x-p.x,a.z-p.z);
    // Preserve steering's overlap recovery: an already intersecting actor can
    // separate monotonically, but cannot cut deeper through its neighbour.
    if(startGap<r)return (a.x-p.x)*dx+(a.z-p.z)*dz>=0&&Math.hypot(b.x-p.x,b.z-p.z)>startGap+1e-8;
    const t=length2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/length2)):0;
    return Math.hypot(a.x+dx*t-p.x,a.z+dz*t-p.z)>=r;
  });
}
export class ZombieNavigation {
  constructor(voxel,bounds,{cell=.5,radius=30,maxNodes=9000}={}){
    Object.assign(this,{voxel,bounds,cell,radius,maxNodes});this.generation=0;this.nodes=[];this.cells=new Map();this.queue=[];this.cursor=0;this.ready=false;this.edgeValidity=new Map();
  }
  begin(eye,eyeHeight=1.5){
    this.generation++;
    this.nodes=[];this.cells.clear();this.edgeValidity.clear();this.cursor=0;this.queue=[];this.ready=false;
    let p=groundNear(this.voxel,eye.x,eye.y-eyeHeight,eye.z,this.bounds);
    // The player's narrower capsule can stand beside railings or under foliage
    // that a full-size NPC cannot. Seed nearby clear ground, never inside it.
    if(!p)for(const r of [.3,.6,.9,1.2,1.8,2.4,3,4,5]){for(let i=0;i<24;i++){const t=i*Math.PI/12;p=groundNear(this.voxel,eye.x+Math.cos(t)*r,eye.y-eyeHeight,eye.z+Math.sin(t)*r,this.bounds);if(p)break;}if(p)break;}
    if(!p){this.ready=true;return false;}
    this.origin=p;this.add(0,0,p);return true;
  }
  key(x,z){return `${x},${z}`;}
  hydrate(data,digest){
    if(data.version!==2||!digest||data.collisionDigest!==digest||!data.nodes?.length||data.nodes.length>this.maxNodes)return false;
    if(data.nodes.some((n,i)=>n.id!==i||![n.x,n.y,n.z].every(Number.isFinite)||!Array.isArray(n.links)||n.links.some(id=>!Number.isInteger(id)||id<0||id>=data.nodes.length)))return false;
    this.generation++;
    this.nodes=data.nodes;this.origin=data.origin;this.cell=data.cell;this.cells=new Map(this.nodes.map(n=>[this.key(n.gx,n.gz),n]));this.edgeValidity.clear();this.queue=[];this.cursor=0;this.ready=true;return true;
  }
  add(x,z,p){const n={...p,gx:x,gz:z,id:this.nodes.length,links:[]};this.nodes.push(n);this.cells.set(this.key(x,z),n);this.queue.push(n);return n;}
  buildStep(budgetMs=3){
    const deadline=performance.now()+budgetMs;
    while(this.cursor<this.queue.length&&this.nodes.length<this.maxNodes&&performance.now()<deadline){
      const a=this.queue[this.cursor++];
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const gx=a.gx+dx,gz=a.gz+dz;
        if(Math.hypot(gx,gz)*this.cell>this.radius)continue;
        const key=this.key(gx,gz);let b=this.cells.get(key);
        if(!b){
          const p=groundNear(this.voxel,this.origin.x+gx*this.cell,a.y,this.origin.z+gz*this.cell,this.bounds);
          if(!p||!walkableEdge(this.voxel,a,p,this.bounds))continue;
          b=this.add(gx,gz,p);
        }else if(a.links.includes(b.id)||!walkableEdge(this.voxel,a,b,this.bounds))continue;
        a.links.push(b.id);b.links.push(a.id);
      }
    }
    this.ready=this.cursor>=this.queue.length||this.nodes.length>=this.maxNodes;
    return this.ready;
  }
  nearest(p,max=2){let best=null,d=max;for(const n of this.nodes){const v=distance(n,p);if(v<d){best=n;d=v;}}return best;}
  reachableStart(p,obstacles=[]){
    const candidates=[];for(const n of this.nodes){const d=distance(n,p);if(d<2)candidates.push({n,d});}
    candidates.sort((a,b)=>a.d-b.d);
    return candidates.find(c=>crowdEdgeClear(p,c.n,obstacles)&&walkableEdge(this.voxel,p,c.n,this.bounds))?.n??null;
  }
  edgeClear(a,b){
    const key=a.id*this.maxNodes+b.id;
    if(!this.edgeValidity.has(key))this.edgeValidity.set(key,walkableEdge(this.voxel,a,b,this.bounds));
    return this.edgeValidity.get(key);
  }
  path(start,end,{obstacles=[],allowPartial=false}={}){
    const from=this.reachableStart(start,obstacles),to=this.nearest(end);
    if(!from||!to)return [];
    // A crowd can occupy the exact destination. Reach a clear approach within
    // melee range instead of routing every actor through the same neighbour.
    const approachRadius=obstacles.length?1.05:0;
    const open=new Set([from.id]),cost=new Map([[from.id,0]]),came=new Map();
    let closest=from,closestDistance=distance(from,end);
    const reconstruct=last=>{
      let id=last;const result=[];while(id!==from.id){result.push(this.nodes[id]);id=came.get(id);}
      if(distance(start,from)>.025||(result.length&&(!crowdEdgeClear(start,result.at(-1),obstacles)||!walkableEdge(this.voxel,start,result.at(-1),this.bounds))))result.push(from);
      return result.reverse();
    };
    while(open.size){
      let id=-1,score=Infinity;
      for(const i of open){const s=cost.get(i)+Math.max(0,distance(this.nodes[i],to)-approachRadius);if(s<score){id=i;score=s;}}
      const node=this.nodes[id];
      const remaining=distance(node,end);
      if(remaining<closestDistance){closest=node;closestDistance=remaining;}
      if(id===to.id||(approachRadius&&distance(node,end)<approachRadius&&walkableEdge(this.voxel,node,end,this.bounds))){
        return reconstruct(id);
      }
      open.delete(id);const n=this.nodes[id];
      for(const next of n.links){const c=cost.get(id)+distance(n,this.nodes[next]);if(c<(cost.get(next)??Infinity)&&crowdEdgeClear(n,this.nodes[next],obstacles)&&this.edgeClear(n,this.nodes[next])){cost.set(next,c);came.set(next,id);open.add(next);}}
    }
    // A temporary crowd choke point must not freeze a distant pursuer at its
    // spawn. Approach the closest safely reachable frontier, then wait/replan.
    // This is explicitly opt-in; it is not a claim to reach an unreachable goal.
    if(allowPartial&&obstacles.length&&closestDistance<distance(start,end)-.25)return reconstruct(closest.id);
    return [];
  }
  spawnPoints(count,eye,forward){
    const feet={...eye,y:eye.y-1.5};
    const choices=this.nodes.filter(n=>distance(n,feet)>7&&distance(n,feet)<19&&n.links.length>=2);
    choices.sort((a,b)=>{
      const score=n=>Math.abs(distance(n,feet)-11)-((n.x-feet.x)*forward.x+(n.z-feet.z)*forward.z)*.3;
      return score(a)-score(b);
    });
    const picked=[];for(const p of choices){if(picked.every(q=>distance(p,q)>3.3)){picked.push(p);if(picked.length===count)break;}}
    return picked;
  }
}
