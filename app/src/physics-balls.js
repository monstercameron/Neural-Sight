const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const length=v=>Math.hypot(v.x,v.y,v.z);
const normalize=v=>{const n=length(v);return n>1e-8?{x:v.x/n,y:v.y/n,z:v.z/n}:null;};
function bounce(v,n){
  const approach=dot(v,n);
  if(approach>=0)return;
  const restitution=approach < -1 ? .78 : 0;
  for(const axis of ['x','y','z'])v[axis]-=(1+restitution)*approach*n[axis];
  const normalSpeed=dot(v,n);
  for(const axis of ['x','y','z'])v[axis]=normalSpeed*n[axis]+(v[axis]-normalSpeed*n[axis])*.9;
}

// Lightweight dynamic spheres on the same authoritative voxel collider as the
// player. Fixed steps + distance substeps avoid frame-rate-dependent bouncing
// and tunneling through the scan's thin walls. No second physics world needed.
export class PhysicsBalls {
  constructor({capacity=24,radius=.18}={}){this.capacity=capacity;this.radius=radius;this.reset();}
  reset(){this.balls=[];this.nextId=1;this.accumulator=0;}
  spawn(origin,direction,voxel,bounds){
    const d=normalize(direction);if(!d||!voxel)return null;
    let position=null;
    for(const distance of [.65,.9,1.15]){
      if(voxel.queryRay(origin.x,origin.y,origin.z,d.x,d.y,d.z,distance+this.radius))break;
      const p={x:origin.x+d.x*distance,y:origin.y+d.y*distance,z:origin.z+d.z*distance};
      if(bounds && ['x','y','z'].some((axis,i)=>p[axis]<bounds.min[i]+this.radius||p[axis]>bounds.max[i]-this.radius))continue;
      if(!voxel.querySphere(p.x,p.y,p.z,this.radius,{x:0,y:0,z:0}) &&
        !this.balls.some(b=>Math.hypot(p.x-b.p.x,p.y-b.p.y,p.z-b.p.z)<this.radius+b.radius))position=p;
    }
    if(!position)return null;
    if(this.balls.length>=this.capacity)this.balls.shift();
    const ball={id:this.nextId++,p:position,v:{x:d.x*4.5,y:d.y*4.5+1.5,z:d.z*4.5},radius:this.radius,age:0};
    this.balls.push(ball);return ball;
  }
  update(dt,voxel,bounds,player=null){
    if(!voxel||!Number.isFinite(dt)||dt<=0)return;
    this.accumulator+=Math.min(.05,dt);
    const step=1/120;
    while(this.accumulator+1e-10>=step){this.accumulator-=step;this.step(step,voxel,bounds,player);}
  }
  resolveWorld(b,voxel,bounds){
    const push={x:0,y:0,z:0};
    if(voxel.querySphere(b.p.x,b.p.y,b.p.z,b.radius,push)){
      const n=normalize(push);
      if(n){for(const axis of ['x','y','z'])b.p[axis]+=push[axis]+n[axis]*.001;bounce(b.v,n);}
    }
    if(bounds)for(const [i,axis] of ['x','y','z'].entries()){
      const lo=bounds.min[i]+b.radius,hi=bounds.max[i]-b.radius;
      if(b.p[axis]<lo||b.p[axis]>hi){
        const n={x:0,y:0,z:0};n[axis]=b.p[axis]<lo?1:-1;
        b.p[axis]=Math.max(lo,Math.min(hi,b.p[axis]));bounce(b.v,n);
      }
    }
  }
  step(dt,voxel,bounds,player){
    for(const b of this.balls){
      b.age+=dt;b.v.y-=9.8*dt;
      const speed=length(b.v),gain=Math.min(1,18/Math.max(speed,.001))*Math.exp(-.12*dt);
      for(const axis of ['x','y','z'])b.v[axis]*=gain;
      const substeps=Math.max(1,Math.ceil(length(b.v)*dt/.03));
      for(let i=0;i<substeps;i++){
        for(const axis of ['x','y','z'])b.p[axis]+=b.v[axis]*dt/substeps;
        this.resolveWorld(b,voxel,bounds);
      }
      // Infinite-mass player capsule nudges props without blocking FPS control.
      if(player){
        const cy=Math.max(player.y-player.eyeHeight+.2,Math.min(player.y-.1,b.p.y));
        const delta={x:b.p.x-player.x,y:b.p.y-cy,z:b.p.z-player.z};
        const distance=length(delta),overlap=b.radius+.2-distance;
        if(overlap>0){
          const n=normalize(delta)||{x:1,y:0,z:0};
          for(const axis of ['x','y','z']){b.p[axis]+=n[axis]*overlap;b.v[axis]+=n[axis]*overlap*8;}
        }
      }
    }
    for(let i=0;i<this.balls.length;i++)for(let j=i+1;j<this.balls.length;j++){
      const a=this.balls[i],b=this.balls[j],delta={x:b.p.x-a.p.x,y:b.p.y-a.p.y,z:b.p.z-a.p.z};
      const distance=length(delta),overlap=a.radius+b.radius-distance;if(overlap<=0)continue;
      const n=normalize(delta)||{x:1,y:0,z:0};
      const relative=dot({x:b.v.x-a.v.x,y:b.v.y-a.v.y,z:b.v.z-a.v.z},n);
      for(const axis of ['x','y','z']){
        a.p[axis]-=n[axis]*overlap*.5;b.p[axis]+=n[axis]*overlap*.5;
        if(relative<0){const impulse=-(1+.8)*relative*.5*n[axis];a.v[axis]-=impulse;b.v[axis]+=impulse;}
      }
    }
    for(const b of this.balls)this.resolveWorld(b,voxel,bounds);
    this.balls=this.balls.filter(b=>b.age<90 && Number.isFinite(length(b.p)));
  }
  raycast(origin,direction,maxDistance){
    const d=normalize(direction);if(!d)return null;
    let hit=null;
    for(const b of this.balls){
      const delta={x:origin.x-b.p.x,y:origin.y-b.p.y,z:origin.z-b.p.z};
      const projection=dot(delta,d),disc=projection*projection-dot(delta,delta)+b.radius*b.radius;
      if(disc<0)continue;
      const near=-projection-Math.sqrt(disc),far=-projection+Math.sqrt(disc),distance=near>=0?near:far;
      if(distance<0||distance>=maxDistance||hit&&distance>=hit.distance)continue;
      const point={x:origin.x+d.x*distance,y:origin.y+d.y*distance,z:origin.z+d.z*distance};
      hit={ballId:b.id,distance,point,normal:normalize({x:point.x-b.p.x,y:point.y-b.p.y,z:point.z-b.p.z})};
    }
    return hit;
  }
  shoot(id,direction){
    const b=this.balls.find(b=>b.id===id),d=normalize(direction);if(!b||!d)return;
    for(const axis of ['x','y','z'])b.v[axis]+=d[axis]*6;
    b.v.y+=.75;
  }
}
