export const REPACK_HOLD_SECONDS=.65;
// Distinguish tap on release from a long hold; cancellation never synthesizes a tap.
export class ReloadInput {
  constructor({reload,startRepack,stopRepack}){Object.assign(this,{reload,startRepack,stopRepack});this.held=false;this.age=0;this.long=false;}
  press(){if(this.held)return;this.held=true;this.age=0;this.long=false;}
  update(dt){
    if(!this.held||this.long)return;
    this.age+=Math.max(0,Math.min(.05,Number(dt)||0));
    if(this.age+1e-9>=REPACK_HOLD_SECONDS){this.long=true;this.startRepack();}
  }
  release(){if(!this.held)return;this.held=false;if(this.long)this.stopRepack();else this.reload();}
  clear(){this.held=false;this.age=0;this.long=false;this.stopRepack();}
}
