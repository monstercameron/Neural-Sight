// Local audition candidates, not approved masters. No network generation at runtime.
import {mediaUrl} from './media-url.js';
// Conservative gains leave headroom for decoded MP3 overshoot and overlapping cues.
export const CUES = {
  equip: [1, .85], stow: [5, .85], raise: [27, .7, .55], lower: [27, .6, .45],
  // The measured boot sample has ~39ms leading silence. Start just before its transient.
  step: [9, .5, .22, .035], runStep: [9, .88, .22, .035], run: [10, .35],
  magOut: [11, .45], magIn: [12, .45], bolt: [13, .35], settle: [14, .35],
  shot: [15, .65], casing: [19, .3], dry: [18, .6],
  selector: [25, .2], hit: [22, .35], gear: [23, .35],
  miss: [20, .7], death: [29, .45],
};
const MARKERS = {
  reload: [[.8, 'magOut'], [1.95, 'magIn'], [2.7, 'bolt'], [3.5, 'settle']],
  reloadADS: [[.05, 'lower'], [.85, 'magOut'], [1.9, 'magIn'], [2.65, 'bolt'], [3.15, 'settle'], [3.45, 'raise']],
  equip: [[0, 'equip']], stow: [[0, 'stow']],
  raising: [[0, 'raise']], lowering: [[0, 'lower']],
  hipRaise: [[0,'raise']], hipLower: [[0,'lower']],
  enterRun: [[0, 'run']], exitRun: [[0, 'settle']], death: [[0, 'death']],
};
export const DESERT_STEPS = {
  step: ['walk-1','walk-2','walk-3'],
  runStep: ['run-1','run-2','run-3'],
};
export const RIFLE_SHOTS=['shot-1','shot-2','shot-3'];

export class AudioDirector {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.buffers = new Map();
    this.voices = new Set();
    this.muted = false;
    this.volume = .75;
    this.loading = false;
    this.failures = 0;
    this.peak = 0;
    this.footstepSurface = 'default';
    this.random = Math.random;
    this.reset();
  }
  reset() {
    this.lastState = '';
    this.lastTime = -1;
    this.shots = 0;
    this.dryFires = 0;
    this.repackedRounds=0;
    this.stride = 0;
    this.lastFootfall=0;
    this.lastStepVariant={};
    this.lastShotVariant=null;
  }
  async unlock() {
    if (!this.context || this.context.state === 'closed') {
      this.buffers.clear();
      this.context = new AudioContext({latencyHint: 'interactive'});
      this.master = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.samples = new Float32Array(this.analyser.fftSize);
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -9;
      compressor.knee.value = 6;
      compressor.ratio.value = 12;
      compressor.attack.value = .003;
      compressor.release.value = .12;
      compressor.connect(this.master).connect(this.analyser).connect(this.context.destination);
      this.bus = compressor;
      this.context.onstatechange = () => this.report();
      this.setVolume(this.volume);
      this.ready = this.load();
    }
    // Called synchronously from a user gesture, before waiting on asset loading.
    if (this.context.state !== 'running') await this.context.resume();
    await this.ready;
    this.report();
  }
  async load() {
    this.loading = true;
    this.report();
    let failures = 0;
    await Promise.all([...new Set(Object.values(CUES).map(c => c[0]))].map(async id => {
      try {
        const name = 'SFX-' + String(id).padStart(2, '0');
        const response = await fetch(mediaUrl(`/media/audio/${name}/${name}.mp3`));
        if (!response.ok) throw new Error(name);
        this.buffers.set(id, await this.context.decodeAudioData(await response.arrayBuffer()));
      } catch { failures++; }
    }));
    await Promise.all(Object.values(DESERT_STEPS).flat().map(async id=>{
      try{
        const response=await fetch(mediaUrl(`/media/audio/desert-v1/${id}/step.wav`));
        if(!response.ok)throw new Error(id);
        this.buffers.set(id,await this.context.decodeAudioData(await response.arrayBuffer()));
      }catch{failures++;}
    }));
    await Promise.all(RIFLE_SHOTS.map(async id=>{
      try{
        const response=await fetch(mediaUrl(`/media/audio/rifle-v2/${id}/shot.wav`));
        if(!response.ok)throw new Error(id);
        this.buffers.set(id,await this.context.decodeAudioData(await response.arrayBuffer()));
      }catch{failures++;}
    }));
    this.failures = failures;
    this.loading = false;
    this.report();
  }
  report() {
    const state = this.context?.state;
    const message = this.muted ? 'MUTED' : !state ? 'Click Sound to enable audio' :
      this.loading ? 'Loading local sound effects…' : state !== 'running' ?
      `Audio ${state} · click Sound to resume` :
      `${this.buffers.size} SFX READY${this.failures ? ` · ${this.failures} failed` : ''}`;
    this.onStatus(message);
  }
  meter() {
    if (this.context?.state !== 'running' || !this.analyser) return {level: 0, peak: this.peak};
    this.analyser.getFloatTimeDomainData(this.samples);
    let level = 0;
    for (const sample of this.samples) level = Math.max(level, Math.abs(sample));
    this.peak = Math.max(this.peak, level);
    return {level, peak: this.peak};
  }
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, .02);
  }
  setMuted(value) {
    this.muted = value;
    this.setVolume(this.volume);
    this.report();
  }
  stop() {
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
    this.voices.clear();
  }
  play(name, pan = 0) {
    let cue = CUES[name],rate=1;
    if(name==='shot'){
      const available=RIFLE_SHOTS.filter(id=>this.buffers.has(id));
      const choices=available.filter(id=>id!==this.lastShotVariant);
      const pool=choices.length?choices:available;
      if(pool.length){
        const id=pool[Math.min(pool.length-1,Math.floor(this.random()*pool.length))];
        this.lastShotVariant=id;
        cue=[id,.78*(.97+.03*this.random())];
        rate=.99+.02*this.random();
      }
    }
    if(this.footstepSurface==='desert' && DESERT_STEPS[name]){
      const available=DESERT_STEPS[name].filter(id=>this.buffers.has(id));
      const choices=available.filter(id=>id!==this.lastStepVariant[name]);
      const pool=choices.length?choices:available;
      if(pool.length){
        const id=pool[Math.min(pool.length-1,Math.floor(this.random()*pool.length))];
        this.lastStepVariant[name]=id;
        cue=[id,(name==='runStep'?.85:.6)*(.94+.06*this.random())];
        rate=.97+.06*this.random();
      }
    }
    const buffer = cue && this.buffers.get(cue[0]);
    if (!buffer || this.muted || this.context?.state !== 'running') { this.report(); return false; }
    if (this.voices.size >= 16) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const stereo = this.context.createStereoPanner();
    source.buffer = buffer;
    if(source.playbackRate)source.playbackRate.value=rate;
    stereo.pan.value = pan;
    const offset=Math.min(cue[3]||0,buffer.duration);
    const duration = Math.min(buffer.duration-offset, cue[2] || buffer.duration)/rate;
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0, now);
    // Gunshot attacks need a sub-millisecond ramp, not the Foley's 5ms softening.
    gain.gain.linearRampToValueAtTime(cue[1], now + (name==='shot'?.0008:.005));
    gain.gain.setValueAtTime(cue[1], now + Math.max(.006, duration - .035));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain).connect(stereo).connect(this.bus);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect(); gain.disconnect(); stereo.disconnect();
    };
    source.start(now,offset);
    source.stop(now + duration);
    return true;
  }
  update(state, distance, grounded, footfalls=null) {
    if (state.state !== this.lastState || state.time < this.lastTime) this.lastTime = -1;
    for (const [time, cue] of MARKERS[state.state] || []) {
      if (this.lastTime < time && state.time >= time) this.play(cue);
    }
    if (state.shots > this.shots) { this.play('shot'); this.play('casing', .3); }
    if (state.dryFires > this.dryFires) this.play('dry');
    if(state.repackedRounds>this.repackedRounds)this.play('selector');
    this.repackedRounds=state.repackedRounds||0;
    this.shots = state.shots;
    this.dryFires = state.dryFires;
    this.lastState = state.state;
    this.lastTime = state.time;
    if(footfalls!==null){
      for(const footfall of footfalls){
        if(footfall.id<=this.lastFootfall)continue;
        this.lastFootfall=footfall.id;
        if(grounded && !['dead','death'].includes(state.state))this.play(footfall.running?'runStep':'step',footfall.pan);
      }
    }else if (grounded && distance > .0001 && !['dead', 'death'].includes(state.state)) {
      this.stride += distance;
      const stride = state.running ? 1.4 : .85;
      if (this.stride >= stride) {
        this.stride %= stride;
        this.play(state.running ? 'runStep' : 'step', this.foot ? .12 : -.12);
        this.foot = !this.foot;
      }
    } else this.stride = 0;
  }
}
