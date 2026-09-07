import {distance,groundNear,walkableEdge,crowdEdgeClear} from './zombie-navigation.js';
import {voxelAirBroadphase} from './voxel-air-broadphase.js';

const copy=p=>({x:p.x,y:p.y,z:p.z});
const directions=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
class MinHeap {
  constructor(){this.items=[];this.order=0;}
  before(a,b){return a.score<b.score||(a.score===b.score&&a.order<b.order);}
  push(node,score){
    const entry={node,cost:node.cost,score,order:this.order++},a=this.items;let i=a.length;a.push(entry);
    while(i){const parent=(i-1)>>1;if(!this.before(entry,a[parent]))break;a[i]=a[parent];i=parent;}a[i]=entry;
  }
  pop(){
    const a=this.items,first=a[0],last=a.pop();if(!a.length)return first;
    let i=0;while(i*2+1<a.length){let child=i*2+1;if(child+1<a.length&&this.before(a[child+1],a[child]))child++;if(!this.before(a[child],last))break;a[i]=a[child];i=child;}a[i]=last;return first;
  }
}

// Every yield bounds the next unit to one short edge test or heap operation.
// No whole-scene rescan, change to the shipped graph, or smaller body radius.
function* search(voxel,bounds,start,end,obstacles,{cell,radius,maxNodes}){
  // The capture is immutable. Adjacent candidate edges repeatedly ask for the
  // exact same supported footprint; cache full results (including rejection),
  // not rounded coordinates or approximated occupancy. Each job owns its cache.
  const groundCache=new Map();let groundQueries=0,groundCacheHits=0;
  const probe=(_voxel,x,y,z)=>{
    const k=`${x},${y},${z}`;
    if(groundCache.has(k)){groundCacheHits++;return groundCache.get(k);}
    groundQueries++;const p=groundNear(voxel,x,y,z,bounds);
    if(groundCache.size<maxNodes*4)groundCache.set(k,p);return p;
  };
  const edge=(a,b)=>walkableEdge(voxel,a,b,bounds,probe);
  // The final attachment can be a metre long: preserve walkableEdge's exact
  // sample locations and carried support height, but yield between samples.
  function* goalEdge(a,b){
    if(Math.abs(a.y-b.y)>.37)return false;
    const spacing=Math.min(.025,(voxel.voxelResolution??.05)*.5);
    const steps=Math.ceil(distance(a,b)/spacing);let height=a.y;
    for(let i=1;i<=steps;i++){
      yield;
      const t=i/steps,p=probe(voxel,a.x+(b.x-a.x)*t,height,a.z+(b.z-a.z)*t,bounds);
      if(!p)return false;height=p.y;
    }
    return true;
  }
  const key=(x,z,y)=>`${x},${z},${Math.round(y/.005)}`;
  const first={p:start,x:0,z:0,cost:0,parent:null},nodes=new Map([[key(0,0,start.y),first]]),open=new MinHeap();
  let closest=first,remaining=distance(start,end),visited=0,limited=false;
  const heuristic=p=>Math.max(0,distance(p,end)-1.05);
  const result=(node,status)=>{const path=[];while(node.parent){path.push(copy(node.p));node=node.parent;}return {path:path.reverse(),status,visited,nodes:nodes.size,groundQueries,groundCacheHits};};
  open.push(first,heuristic(start));
  while(open.items.length){
    yield;
    const entry=open.pop(),node=entry.node;if(entry.cost!==node.cost)continue;
    visited++;const d=distance(node.p,end);
    if(d<remaining){closest=node;remaining=d;}
    if(d<1.05&&(yield* goalEdge(node.p,end)))return result(node,'ready');
    for(const [dx,dz] of directions){
      yield;
      const x=node.x+dx,z=node.z+dz;if(Math.abs(x)*cell>radius||Math.abs(z)*cell>radius)continue;
      const p=probe(voxel,start.x+x*cell,node.p.y,start.z+z*cell);if(!p)continue;
      const k=key(x,z,p.y),old=nodes.get(k),destination=old?.p??p,cost=node.cost+distance(node.p,destination);
      if(old&&old.cost<=cost)continue;
      // A height-key collision must validate the canonical point we will
      // actually publish, not a nearby candidate that is then discarded.
      if(!crowdEdgeClear(node.p,destination,obstacles)||!edge(node.p,destination))continue;
      if(!old&&nodes.size>=maxNodes){limited=true;continue;}
      const next=old??{p,x,z};next.cost=cost;next.parent=node;nodes.set(k,next);open.push(next,cost+heuristic(destination));
    }
  }
  // A bounded search can still improve a queue position, without claiming the
  // player was reached. A no-route result is cached until the inputs change.
  if(remaining<distance(start,end)-.25)return result(closest,limited?'limited-frontier':'frontier');
  return {path:[],status:limited?'limited':'no-route',visited,nodes:nodes.size,groundQueries,groundCacheHits};
}

export class ZombieLocalRoutes {
  constructor(voxel,bounds,{cell=.1,radius=4,maxNodes=8192,maxJobs=16,now=()=>performance.now(),broadphase=true}={}){
    Object.assign(this,{voxel,bounds,cell,radius,maxNodes,maxJobs,now});this.planningVoxel=broadphase?voxelAirBroadphase(voxel):voxel;this.jobs=new Map();this.queue=[];this.lastWork=0;
  }
  cancel(id){this.jobs.delete(id);this.queue=this.queue.filter(n=>n!==id);}
  clear(){this.jobs.clear();this.queue=[];this.lastWork=0;}
  pending(id){return this.jobs.has(id)&&!this.jobs.get(id).result;}
  request(id,start,end,obstacles){
    // Neighbours outside the entire local search cannot affect its geometry.
    const relevant=obstacles.filter(p=>Math.abs(p.x-start.x)<this.radius+.6&&Math.abs(p.z-start.z)<this.radius+.6);
    let job=this.jobs.get(id);
    // Small crowd movements can reopen a passage without crossing the restart
    // thresholds. Negative results expire; pending searches are never timed out.
    const expired=job?.result&&!job.result.path.length&&this.now()-job.completedAt>=1000;
    const crowdChanged=job&&(job.obstacles.length!==relevant.length||relevant.some((p,i)=>distance(p,job.obstacles[i])>.2));
    // Moving neighbours must not restart a useful search every few frames.
    // Finish the snapshot, then validate EVERY returned edge against the live
    // crowd. A changed crowd may immediately retire a completed negative result.
    const changed=!job||expired||distance(job.start,start)>.08||distance(job.end,end)>.3||(job.result&&!job.result.path.length&&crowdChanged);
    if(changed){
      this.cancel(id);
      if(this.jobs.size>=this.maxJobs)return null;
      job={start:copy(start),end:copy(end),obstacles:relevant.map(copy),result:null};
      job.iterator=search(this.planningVoxel,this.bounds,job.start,job.end,job.obstacles,this);this.jobs.set(id,job);this.queue.push(id);
    }
    if(!job.result)return null;
    if(!job.result.path.length)return [];
    const path=job.result.path;
    // World geometry is immutable for a job. Validate its actual entry against
    // the world, and all segments against current neighbours before publishing.
    let previous=start,crowdClear=true;
    for(const point of path){if(!crowdEdgeClear(previous,point,relevant)){crowdClear=false;break;}previous=point;}
    if(!crowdClear||!walkableEdge(this.voxel,start,path[0],this.bounds)){
      this.cancel(id);return null;
    }
    this.cancel(id);return path.map(copy);
  }
  advance(budgetMs=1,maxSteps=64){
    this.lastWork=0;if(!(budgetMs>0&&maxSteps>0))return;
    const deadline=this.now()+budgetMs;
    // Round-robin one edge at a time: a hard search cannot starve another actor.
    while(this.queue.length&&this.lastWork<maxSteps&&this.now()<deadline){
      const id=this.queue.shift(),job=this.jobs.get(id);if(!job)continue;
      const step=job.iterator.next();this.lastWork++;
      if(step.done){job.result=step.value;job.completedAt=this.now();job.iterator=null;}else this.queue.push(id);
    }
  }
}
