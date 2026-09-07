// Combat counters stay frame-current; bulky inspector diagnostics are sampled.
// Avoid rewriting identical text nodes and serializing every bone every frame.
export class ZombieHud {
  constructor(hud,status,{diagnosticIntervalMs=200}={}){
    this.hud=hud;this.status=status;this.interval=diagnosticIntervalMs;
    this.nextDiagnostic=-Infinity;this.combatText=null;this.statusText=null;
  }
  update(encounter,now=performance.now()){
    const zs=encounter.stats({includeActors:false});
    const combat=`${zs.health} HEALTH · ${zs.alive} INFECTED · ${zs.dead} DOWN · G REVIVE`;
    const status=zs.mapping?`Mapping ${zs.mapped} connected cells…`:`${zs.status} · ${zs.audioReady}/5 sounds${zs.audioFailures.length?' · AUDIO FAILED':''}`;
    const changed=combat!==this.combatText||status!==this.statusText;
    if(combat!==this.combatText){this.hud.textContent=combat;this.combatText=combat;}
    if(status!==this.statusText){this.status.textContent=status;this.statusText=status;}
    if(changed||now>=this.nextDiagnostic||now<this.lastTime){
      this.status.dataset.diagnostics=JSON.stringify(encounter.stats());
      this.nextDiagnostic=now+this.interval;
    }
    this.lastTime=now;
  }
}
