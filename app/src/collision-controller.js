import { VoxelCollision } from "./vendor/voxel-collision.ts";
import {validateVoxelMeta,readExactBinary} from './remote-level.js';

export class CollisionController {
  constructor() {
    this.enabled = true;
    this.velocityY = 0;
    this.grounded = false;
    this.contacts = 0;
    this.push = { x: 0, y: 0, z: 0 };
    this.eyeHeight=1.5;
    this.meta={gridBounds:{min:[-1000000,-1000000,-1000000],max:[1000000,1000000,1000000]}};
  }
  async init(base = '/media/level', fetcher = fetch) {
    const metadataUrl=base.endsWith('.json')?base:`${base}/scene.voxel.json`;
    const metaResponse=await fetcher(metadataUrl);
    if(!metaResponse.ok)throw new Error('Voxel metadata missing');
    this.meta = validateVoxelMeta(await metaResponse.json());
    const binResponse=await fetcher(metadataUrl.replace(/\.json$/,'.bin'));
    if(!binResponse.ok)throw new Error('Voxel payload missing');
    const binary = await readExactBinary(binResponse,(this.meta.nodeCount+this.meta.leafDataCount)*4);
    this.digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',binary))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if (
      this.meta.version !== "1.1" ||
      binary.byteLength !== (this.meta.nodeCount + this.meta.leafDataCount) * 4
    )
      throw new Error("Voxel format/size validation failed");
    const words = new Uint32Array(binary);
    this.voxel = new VoxelCollision(
      this.meta,
      words.subarray(0, this.meta.nodeCount),
      words.subarray(this.meta.nodeCount),
    );
  }
  reset() {
    this.velocityY = 0;
    this.grounded = false;
    this.eyeHeight=1.5;
  }
  jump() {
    if(!this.enabled || !this.voxel || !this.grounded)return false;
    this.velocityY=4.5; // ~1 metre rise with the existing 9.8 m/s² gravity.
    this.grounded=false;
    return true;
  }
  canStand(position) {
    if(!this.enabled || !this.voxel || this.eyeHeight>=1.5)return true;
    const feet=position.y-this.eyeHeight;
    if(feet+1.6>this.meta.gridBounds.max[1])return false;
    // Sweep the added head volume rather than interpreting floor contact as
    // blocked standing. Keep the same 20 cm radius as the locomotion capsule.
    const push={x:0,y:0,z:0};
    for(let h=this.eyeHeight-.1;h<=1.4001;h+=.025)
      if(this.voxel.querySphere(position.x,feet+h,position.z,.2,push))return false;
    // The moving sample origin need not land exactly on the final head cap.
    // Always test its full standing height before permitting expansion.
    return !this.voxel.querySphere(position.x,feet+1.4,position.z,.2,push);
  }
  setEyeHeight(position,height) {
    const next=Math.max(.9,Math.min(1.5,height));
    position.y+=next-this.eyeHeight;this.eyeHeight=next;
  }
  move(position, motion, dt) {
    if (!this.enabled || !this.voxel) {
      position.add(motion);
      return;
    }
    // Capsule: radius 20cm, total height 1.6m; camera 1.5m above feet.
    const radius = 0.2,
      halfHeight = (this.eyeHeight+.1)/2-radius,
      eyeToCenter = this.eyeHeight-(this.eyeHeight+.1)/2;
    this.velocityY = Math.max(-12, this.velocityY - 9.8 * dt);
    const vertical = this.velocityY * dt;
    const steps = Math.max(
      1,
      Math.ceil(Math.max(motion.length(), Math.abs(vertical)) / 0.04),
    );
    this.contacts = 0;
    this.grounded = false;
    for (let i = 0; i < steps; i++) {
      position.x += motion.x / steps;
      position.z += motion.z / steps;
      position.y += vertical / steps;
      // Authoritative grid boundary is solid; explicit clamp prevents leaving the scan.
      const min = this.meta.gridBounds.min,
        max = this.meta.gridBounds.max;
      position.x = Math.max(
        min[0] + radius,
        Math.min(max[0] - radius, position.x),
      );
      position.z = Math.max(
        min[2] + radius,
        Math.min(max[2] - radius, position.z),
      );
      position.y = Math.max(min[1] + this.eyeHeight, Math.min(max[1] - 0.1, position.y));
      if (
        this.voxel.queryCapsule(
          position.x,
          position.y - eyeToCenter,
          position.z,
          halfHeight,
          radius,
          this.push,
        )
      ) {
        position.x += this.push.x;
        position.y += this.push.y;
        position.z += this.push.z;
        this.contacts++;
        if (this.push.y > 1e-5) {
          this.grounded = true;
          this.velocityY = Math.max(0, this.velocityY);
        }
        if (this.push.y < -1e-5) this.velocityY = Math.min(0, this.velocityY);
      }
    }
  }
}
