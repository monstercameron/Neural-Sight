import {cachedVoxelQueries} from './voxel-query-cache.js';
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const length=a=>Math.hypot(a.x,a.y,a.z);
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit=a=>{const l=length(a)||1;return {x:a.x/l,y:a.y/l,z:a.z/l};};
function bodyAxes(points,frame){
  const right=unit(sub(points[frame.right].p,points[frame.left].p));
  const forward=unit(cross(right,sub(points[frame.chest].p,points[frame.pelvis].p)));
  return [right,unit(cross(forward,right)),forward];
}
export function raySphere(o,d,p,r,max=Infinity){
  const v=sub(o,p),b=dot(v,d),c=dot(v,v)-r*r,disc=b*b-c;
  if(disc<0)return null;const t=-b-Math.sqrt(disc),exit=-b+Math.sqrt(disc),distance=t>=0?t:exit;
  return distance>=0&&distance<max?distance:null;
}
export function rayCapsule(o,d,a,b,r,max=Infinity){
  const ba=sub(b,a),oa=sub(o,a),baba=dot(ba,ba),bard=dot(ba,d),baoa=dot(ba,oa),rdoa=dot(d,oa),oaoa=dot(oa,oa);
  const A=baba-bard*bard,B=baba*rdoa-baoa*bard,C=baba*oaoa-baoa*baoa-r*r*baba,h=B*B-A*C;
  let best=max,point=null;
  if(h>=0&&A>1e-9){for(const t of [(-B-Math.sqrt(h))/A,(-B+Math.sqrt(h))/A]){const y=baoa+t*bard;if(t>=0&&t<best&&y>0&&y<baba){best=t;point={x:a.x+ba.x*y/baba,y:a.y+ba.y*y/baba,z:a.z+ba.z*y/baba};}}}
  for(const p of [a,b]){const t=raySphere(o,d,p,r,best);if(t!==null){best=t;point=p;}}
  if(!point)return null;
  const hit={x:o.x+d.x*best,y:o.y+d.y*best,z:o.z+d.z*best},n=sub(hit,point),len=length(n)||1;
  return {point:hit,normal:{x:n.x/len,y:n.y/len,z:n.z/len},distance:best};
}
// Position-based articulated body. Every bone particle stays linked; secondary
// torso and angular-distance constraints prevent a chain of detached noodles.
export class ZombieRagdoll {
  constructor(joints,edges,impulse={x:0,y:0,z:0},hitIndex=0,rigidTorso=[],anatomy=null){
    this.points=joints.map((j,i)=>({p:{...j.p},prev:{x:j.p.x-impulse.x/120*(i===hitIndex?1:.35),y:j.p.y-(impulse.y+.2)/120,z:j.p.z-impulse.z/120*(i===hitIndex?1:.35)},r:j.r,mass:j.mass??1}));
    this.edges=edges.map(([a,b])=>({a,b,min:length(sub(joints[a].p,joints[b].p)),max:length(sub(joints[a].p,joints[b].p))}));
    // Limit flexion / extension at adjacent links without freezing the death pose.
    for(let i=0;i<edges.length;i++)for(let k=i+1;k<edges.length;k++){
      const e=edges[i],f=edges[k],mid=e.find(v=>f.includes(v));if(mid===undefined)continue;
      const a=e.find(v=>v!==mid),b=f.find(v=>v!==mid),l1=length(sub(joints[a].p,joints[mid].p)),l2=length(sub(joints[b].p,joints[mid].p));
      this.edges.push({a,b,min:Math.max(Math.abs(l1-l2)+.02,(l1+l2)*.3),max:(l1+l2)*.985});
    }
    // A human ribcage/pelvis is a volume, not freely folding vertebral links.
    for(let i=0;i<rigidTorso.length;i++)for(let j=i+1;j<rigidTorso.length;j++){
      const a=rigidTorso[i],b=rigidTorso[j],d=length(sub(joints[a].p,joints[b].p));
      this.edges.push({a,b,min:d*.97,max:d*1.03,internal:true});
    }
    this.contactEdges=this.edges.filter(e=>e.min===e.max);
    this.anatomy=anatomy;this.hinges=[];this.selfPairs=[];
    if(anatomy){
      const axes=bodyAxes(this.points,anatomy.frame);
      for(const [a,m,b,maxFlex=140] of anatomy.hinges){
        const ab=unit(sub(joints[b].p,joints[a].p)),am=sub(joints[m].p,joints[a].p),along=dot(am,ab);
        let bend=sub(am,{x:ab.x*along,y:ab.y*along,z:ab.z*along});
        if(length(bend)<.005)bend=axes[2];
        bend=unit(bend);
        const l1=length(am),l2=length(sub(joints[b].p,joints[m].p));
        const limit=Math.sqrt(l1*l1+l2*l2+2*l1*l2*Math.cos(maxFlex*Math.PI/180));
        const existing=this.edges.find(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a));
        if(existing)existing.min=Math.max(existing.min,limit);
        const hingeAxis=unit(cross(ab,bend));
        this.hinges.push({a,m,b,l1,l2,axis:axes.map(axis=>dot(hingeAxis,axis))});
      }
      for(const [a,m,b,maxFlex] of anatomy.cones??[]){
        const l1=length(sub(joints[a].p,joints[m].p)),l2=length(sub(joints[b].p,joints[m].p));
        this.edges.push({a,b,min:Math.sqrt(l1*l1+l2*l2+2*l1*l2*Math.cos(maxFlex*Math.PI/180)),max:l1+l2,internal:true,pivot:m,maxFlex});
      }
      // Exclude neighboring joints and rigid torso pairs. Other body volumes
      // must not pass through one another as the body folds or receives shots.
      const neighbors=joints.map(()=>new Set());
      for(const [a,b] of edges){neighbors[a].add(b);neighbors[b].add(a);}
      for(let a=0;a<joints.length;a++)for(let b=a+1;b<joints.length;b++){
        if(neighbors[a].has(b)||[...neighbors[a]].some(n=>neighbors[n].has(b)))continue;
        if(rigidTorso.includes(a)&&rigidTorso.includes(b))continue;
        const radius=(joints[a].r+joints[b].r)*.9;
        if(length(sub(joints[a].p,joints[b].p))>radius)this.selfPairs.push({a,b,radius,normal:unit(sub(joints[b].p,joints[a].p))});
      }
    }
    this.accumulator=0;this.rest=0;this.sleeping=false;this.age=0;
  }
  impulse(index,direction){const p=this.points[index]||this.points[0];for(const k of ['x','y','z'])p.prev[k]-=direction[k]*.018;this.sleeping=false;this.rest=0;}
  update(dt,voxel,bounds){
    if(dt<=0||this.sleeping)return;
    voxel=cachedVoxelQueries(voxel);
    this.accumulator+=Math.min(dt,.05);
    while(this.accumulator+1e-10>=1/120){this.step(1/120,voxel,bounds);this.accumulator-=1/120;if(this.sleeping){this.accumulator=0;break;}}
  }
  constrain(){
    for(const e of this.edges){const a=this.points[e.a],b=this.points[e.b];
      if(e.pivot!==undefined){const pivot=this.points[e.pivot].p,l1=length(sub(a.p,pivot)),l2=length(sub(b.p,pivot));e.min=Math.sqrt(l1*l1+l2*l2+2*l1*l2*Math.cos(e.maxFlex*Math.PI/180));e.max=l1+l2;continue;}
      const v=sub(b.p,a.p),l=length(v)||1e-6,target=Math.max(e.min,Math.min(e.max,l)),delta=(l-target)/l,wa=1/a.mass,wb=1/b.mass;
      for(const k of ['x','y','z']){a.p[k]+=v[k]*delta*wa/(wa+wb);b.p[k]-=v[k]*delta*wb/(wa+wb);}}
    if(this.anatomy){
      const axes=bodyAxes(this.points,this.anatomy.frame);
      for(const h of this.hinges){
        const a=this.points[h.a],m=this.points[h.m],b=this.points[h.b],ab=sub(b.p,a.p),len=length(ab);
        if(len<1e-5)continue;
        let direction=unit(ab);
        const hingeAxis={x:0,y:0,z:0};for(let i=0;i<3;i++)for(const k of ['x','y','z'])hingeAxis[k]+=axes[i][k]*h.axis[i];
        const axisDot=dot(direction,hingeAxis);
        if(Math.abs(axisDot)>.94){
          // Bound lateral swing before the limb aligns with its hinge axle.
          // Otherwise the bend plane becomes singular and can flip 180°.
          const tangent=unit(sub(direction,{x:hingeAxis.x*axisDot,y:hingeAxis.y*axisDot,z:hingeAxis.z*axisDot})),sign=Math.sign(axisDot);
          const desired={x:0,y:0,z:0},wa=1/a.mass,wb=1/b.mass;
          for(const k of ['x','y','z']){desired[k]=tangent[k]*Math.sqrt(1-.94*.94)+hingeAxis[k]*sign*.94;const error=(desired[k]-direction[k])*len;a.p[k]-=error*wa/(wa+wb);b.p[k]+=error*wb/(wa+wb);}
          direction=desired;
        }
        const preferred=cross(hingeAxis,direction);
        if(length(preferred)<1e-5)continue;
        const bend=unit(preferred),am=sub(m.p,a.p),along=dot(am,direction),offset=sub(am,{x:direction.x*along,y:direction.y*along,z:direction.z*along});
        const amount=Math.max(.01,dot(offset,bend)),wa=1/a.mass,wm=1/m.mass,wb=1/b.mass,total=wm+(wa+wb)*.25;
        for(const k of ['x','y','z']){const error=(bend[k]*amount-offset[k])*.7/total;m.p[k]+=error*wm;a.p[k]-=error*wa*.5;b.p[k]-=error*wb*.5;}
      }
      // Solve hip angles at all three particles, including the pivot. Merely
      // separating the two endpoints changes neighboring bone lengths without
      // accounting for how pivot movement changes the angle.
      for(const [ai,mi,bi,limit] of this.anatomy.cones??[]){
        const a=this.points[ai],m=this.points[mi],b=this.points[bi];
        const u=sub(a.p,m.p),v=sub(b.p,m.p),la=length(u),lb=length(v);
        if(la<1e-6||lb<1e-6)continue;
        for(const k of ['x','y','z']){u[k]/=la;v[k]/=lb;}
        const cosine=dot(u,v),error=cosine+Math.cos(limit*Math.PI/180);
        if(error<=0)continue;
        const ga={},gb={},gm={};let denominator=0;
        for(const k of ['x','y','z']){
          ga[k]=(v[k]-cosine*u[k])/la;gb[k]=(u[k]-cosine*v[k])/lb;gm[k]=-ga[k]-gb[k];
          denominator+=ga[k]*ga[k]/a.mass+gb[k]*gb[k]/b.mass+gm[k]*gm[k]/m.mass;
        }
        if(denominator<1e-8)continue;
        const lambda=error/denominator;
        for(const k of ['x','y','z']){a.p[k]-=lambda*ga[k]/a.mass;b.p[k]-=lambda*gb[k]/b.mass;m.p[k]-=lambda*gm[k]/m.mass;}
      }
      for(const pair of this.selfPairs){
        const a=this.points[pair.a],b=this.points[pair.b],v=sub(b.p,a.p),len=length(v);
        if(len>=pair.radius)continue;
        const normal=len>1e-6?unit(v):pair.normal,wa=1/a.mass,wb=1/b.mass,correction=(pair.radius-len)*.6/(wa+wb);
        for(const k of ['x','y','z']){a.p[k]-=normal[k]*correction*wa;b.p[k]+=normal[k]*correction*wb;}
      }
    }
  }
  needsMoreSolving(){
    if(!this.anatomy)return false;
    for(const e of this.contactEdges){const d=length(sub(this.points[e.a].p,this.points[e.b].p));if(Math.abs(d-e.min)>.008)return true;}
    const axes=bodyAxes(this.points,this.anatomy.frame);
    for(const h of this.hinges){
      const a=this.points[h.a].p,m=this.points[h.m].p,b=this.points[h.b].p,direction=unit(sub(b,a)),axis={x:0,y:0,z:0};
      for(let i=0;i<3;i++)for(const k of ['x','y','z'])axis[k]+=axes[i][k]*h.axis[i];
      if(Math.abs(dot(axis,direction))>.96)return true;
      if(dot(sub(m,a),unit(cross(axis,direction)))<-.002)return true;
    }
    for(const [a,m,b,limit] of this.anatomy.cones??[]){
      const u=unit(sub(this.points[a].p,this.points[m].p)),v=unit(sub(this.points[b].p,this.points[m].p));
      if(dot(u,v)>-Math.cos((limit+2)*Math.PI/180))return true;
    }
    return false;
  }
  step(dt,voxel,bounds){
    this.age+=dt;const push={x:0,y:0,z:0};
    // Dissipate internal limb motion while retaining the body's bulk impulse.
    // This models joint/soft-tissue damping instead of forcibly sleeping an
    // unsettled body after a timer or heavily damping all translation.
    const mean={x:0,y:0,z:0};let mass=0;
    for(const p of this.points){mass+=p.mass;for(const k of ['x','y','z'])mean[k]+=(p.p[k]-p.prev[k])*p.mass;}
    for(const k of ['x','y','z'])mean[k]/=mass;
    for(const p of this.points){const old={...p.p};for(const k of ['x','y','z']){const velocity=mean[k]+(p.p[k]-p.prev[k]-mean[k])*.98;p.p[k]+=Math.max(-.06,Math.min(.06,velocity*.993));}p.p.y-=9.8*dt*dt;p.prev=old;}
    for(let iteration=0;iteration<(this.anatomy?24:7);iteration++){
      // Joint/contact corrections disturb neighboring bones. Converge the
      // inexpensive articulated constraints before querying the voxel world.
      for(let solve=0;solve<4;solve++)this.constrain();
      for(const p of this.points){
        if(voxel.querySphere(p.p.x,p.p.y,p.p.z,p.r,push)){
          p.p.x+=push.x;p.p.y+=push.y;p.p.z+=push.z;
          const len=length(push)||1,n={x:push.x/len,y:push.y/len,z:push.z/len},v=sub(p.p,p.prev),vn=dot(v,n);
          for(const k of ['x','y','z'])p.prev[k]=p.p[k]-(v[k]-n[k]*Math.min(vn,0))*.7;
        }
        if(bounds)for(const [i,k] of ['x','y','z'].entries())p.p[k]=Math.max(bounds.min[i]+p.r,Math.min(bounds.max[i]-p.r,p.p[k]));
      }
      // Segment interiors also collide, so forearms cannot bridge through walls.
      if(iteration%2===0)for(const e of this.contactEdges){
        const a=this.points[e.a],b=this.points[e.b],r=Math.min(a.r,b.r)*.8;
        for(const t of [.33,.66]){const q={x:a.p.x+(b.p.x-a.p.x)*t,y:a.p.y+(b.p.y-a.p.y)*t,z:a.p.z+(b.p.z-a.p.z)*t};
          if(voxel.querySphere(q.x,q.y,q.z,r,push))for(const k of ['x','y','z']){a.p[k]+=push[k];b.p[k]+=push[k];}}
      }
      if(iteration>=6&&!this.needsMoreSolving())break;
    }
    const speed=Math.max(...this.points.map(p=>length(sub(p.p,p.prev))/dt));
    this.rest=speed<.09?this.rest+dt:0;this.sleeping=this.age>1&&this.rest>.65;
  }
}
