import * as pc from "playcanvas";
import { WeaponState } from "./state-machine.js";
import { WeaponLayer, weaponScreenOffset } from "./weapon-layer.js";
import { FramePlayer } from "./frame-player.js";
import { CollisionController } from "./collision-controller.js";
import { AudioDirector } from "./audio-director.js";
import { MuzzleFlash, MUZZLES } from "./muzzle-flash.js";
import { cinematicDof } from "./cinematic-dof.js";
import { createGradeLut, gradeAmount } from "./cinematic-grade.js";
import {installFilmFinish} from './film-finish.js';
import { installDisplayLutChunks } from "./color-pipeline.js";
import { installFilmTone } from "./film-tone.js";
import {installFilmComposite} from './film-composite.js';
import {SceneGpuMeter} from './scene-gpu-meter.js';
import { SprintFocus, peripheralFocusRadius } from "./sprint-focus.js";
import { AdsView } from "./ads-view.js";
import { AdsSway } from "./ads-sway.js";
import { installSprintFocus } from "./sprint-focus-shader.js";
import { ViewBob } from "./view-bob.js";
import {StrideCycle} from './stride-cycle.js';
import { HeadLead } from "./head-lead.js";
import { GunRecoil } from "./recoil.js";
import { WeaponMotionBlur } from "./motion-blur.js";
import { SprintMotion } from './sprint-motion.js';
import { FiringPlayback } from './firing-playback.js';
import { authoredRecoilReady } from './recoil-presentation.js';
import { TemporalHistory,taaSettings,attachTemporalHistory } from './temporal-aa.js';
import {attachDofTemporalInput} from './dof-temporal-input.js';
import { WeaponPosture } from "./weapon-posture.js";
import { WeaponFraming, RunFraming } from "./weapon-framing.js";
import { AdsControl } from "./ads-control.js";
import {Ballistics, shotScreenPoint} from './ballistics.js';
import {resolveSceneShot,applySceneShot} from './scene-shot.js';
import {FramePacingCapture} from './frame-pacing.js';
import {BulletImpacts} from './bullet-impacts.js';
import {PhysicsBalls} from './physics-balls.js';
import {PhysicsBallView} from './physics-ball-view.js';
import {ZombieEncounter} from './zombie-encounter.js';
import {ZombieHud} from './zombie-hud.js';
import {mountMotionReview} from './motion-review.js';
import {EncounterRecording} from './encounter-recording.js';
import {installZombieRenderPass} from './zombie-render-pass.js';
import {sharpeningAmount} from './sharpening.js';
import {CameraKick} from './camera-kick.js';
import {AimInput,bindAimButton} from './aim-input.js';
import {Crouch} from './crouch.js';
import {LEVELS,levelById,levelBase,lodOptions} from './levels.js';
import {importLevel,inspectLevel,guardSceneAssets} from './remote-level.js';
import {fetchLocal} from './local-fetch.js';
import {resumeLevelCache} from './level-cache.js';
import {mountLevelCache} from './level-cache-ui.js';
import {bindFpsMouse} from './fps-mouse.js';
import {HeldInput,GAME_KEYS,isCrouchHeld,isUiKeyEvent} from './held-input.js';
import {returnPlayerToSpawn,isSpawnResetKey,findSpawnGround} from './spawn-reset.js';
import {MovementMomentum,sprintDirectionScale} from './movement-momentum.js';
import {TurnTilt} from './turn-tilt.js';
import {SceneBrightness,readSceneBrightness,saveSceneBrightness} from './scene-brightness.js';
import {ReloadInput} from './reload-input.js';
import "./style.css";
const $ = (id) => document.getElementById(id);
const audio = new AudioDirector(message => {
  $("audio-status").textContent = message;
  $("sound").textContent = audio.muted ? "Sound off" :
    audio.context?.state === "running" ? "Sound on" : "Enable sound";
  $("sound").setAttribute("aria-pressed", String(audio.muted));
});
function activateAudio() {
  let timer;
  return Promise.race([
    audio.unlock(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Playback blocked · click Enable sound")), 3000); }),
  ]).catch(error => {
    $("audio-status").textContent = "Audio failed: " + error.message;
    $("sound").textContent = "Retry sound";
  }).finally(() => clearTimeout(timer));
}
function recoverAudio() {
  if (!audio.muted && audio.context?.state !== "running") void activateAudio();
}
let playing = false, damage = 0;
let fpsMouse;
const gunRecoil = new GunRecoil();
const cameraKick = new CameraKick();
const turnTilt = new TurnTilt();
const crouch=new Crouch();
const movementMomentum=new MovementMomentum();
const weaponMotionBlur = new WeaponMotionBlur();
const weaponPosture = new WeaponPosture();
const weaponFraming = new WeaponFraming();
const runFraming = new RunFraming();
const adsControl = new AdsControl();
const aimMouse = {x:0,y:0};
const muzzleFlash = new MuzzleFlash();
const viewBob = new ViewBob();
const headLead = new HeadLead();
const ballistics = new Ballistics();
let bulletImpacts;
const physicsBalls=new PhysicsBalls();
let physicsBallView;
let zombies;
let motionReview;
const playerPosition = new pc.Vec3();
const canvas = $("application-canvas"),
  state = new WeaponState(),
  keys = new Set();
const aimInput=new AimInput(value=>state.setAim(value));
const fireInput=new HeldInput(value=>state.trigger(value));
const reloadInput=new ReloadInput({reload:()=>action('reload'),startRepack:()=>{manual=false;return state.startRepack();},stopRepack:()=>state.stopRepack()});
let yaw = 0,
  pitch = 0,
  world,
  app,
  camera,
  manual = false,
  elapsed = 0,
  fpsTime = 0,
  frames = 0,
  collision,
  collisionMesh;
let selectedLevel=LEVELS[0];
let spawn=selectedLevel.spawn,target=selectedLevel.target;
let startupFailed=false;
const strideCycle=new StrideCycle();
const temporalHistory=new TemporalHistory();
const streamErrors=new Map();
function clearError() {
  $("error").hidden=true;
  $("error-message").textContent='';
}
function fail(error) {
  console.error(error);
  $("error").hidden = false;
  $("error-message").textContent = String(error.message || error);
  $("loading").hidden=true;
}
function resetView() {
  temporalHistory.reset();
  turnTilt.reset();
  movementMomentum.reset();
  crouch.reset();
  playerPosition.set(...spawn);
  viewBob.reset();
  strideCycle.reset();
  weaponPosture.y=0;
  adsControl.reset();
  aimMouse.x=aimMouse.y=0;
  camera.setPosition(...spawn);
  const dx = target[0] - spawn[0],
    dy = target[1] - spawn[1],
    dz = target[2] - spawn[2];
  yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
  pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  headLead.reset(yaw,pitch);
  camera.setEulerAngles(pitch, yaw, 0);
  collision?.reset();
}
function release() {
  strideCycle.reset();
  reloadInput.clear();
  turnTilt.reset();
  movementMomentum.reset();
  aimInput.clear();
  aimMouse.x=aimMouse.y=0;
  keys.clear();
  fireInput.clear();
  state.burst = 0;
  state.hipShot=false;
  state.setMovement(false, false);
}
function look(dx, dy) {
  const oldPitch=pitch;
  yaw -= dx * 0.11;
  if(playing && !manual)turnTilt.addTurn(-dx*.11);
  pitch = pc.math.clamp(pitch - dy * 0.11, -80, 80);
  // Collect only applied look input; clamped pitch cannot create phantom torque.
  if(state.state==="ads" && playing && !manual) {
    const rad=Math.PI/180,projection=2*Math.tan(camera.camera.fov*rad/2);
    aimMouse.x += dx*.11*rad/(projection*Math.max(.5,canvas.clientWidth/canvas.clientHeight));
    aimMouse.y += (oldPitch-pitch)*rad/projection;
  }
}
function action(name) {
  manual = false;
  if (name === "equip") {
    if(!state.busy && !['dead','noGun'].includes(state.state))aimInput.clear();
    state.equip();
  }
  if (name === "reload") state.reload();
  if(name==='repack'){if(state.state==='repack')state.stopRepack();else state.startRepack();}
  if (name === "mode") { state.changeMode(); audio.play("selector"); }
  if (name === "hit") { state.hit(); damage = .32; audio.play("hit"); audio.play("gear"); }
  if (name === "miss") { state.hit(true); audio.play("miss", -.3); }
  if (name === "death") {aimInput.clear();state.die();}
  if (name === "reset") {
    state.reset();
    audio.stop();
    audio.reset();
    muzzleFlash.reset();
    gunRecoil.reset();
    cameraKick.reset();
    ballistics.reset();
    bulletImpacts?.reset();
    physicsBalls.reset();physicsBallView?.reset();
    zombies?.reset();
    damage = 0;
    release();
    resetView();
  }
}
function toggleTools() {
  const open = $("lab").classList.toggle("collapsed") === false;
  document.body.classList.toggle("tools-open", open);
  $("tools").setAttribute("aria-expanded", String(open));
  if (open && document.pointerLockElement) document.exitPointerLock();
}
function pause() {
  playing = false;
  release();
  audio.stop();
  document.body.classList.remove("playing");
  $("session-overlay").hidden = false;
  $("session-title").innerHTML = "Field session<br />paused.";
  $("play").innerHTML = "Resume session <span>→</span>";
  if (document.pointerLockElement) document.exitPointerLock();
  $("play").focus();
}
async function start() {
  $("loading").textContent=`${selectedLevel.name} · starting WebGPU…`;
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: [pc.DEVICETYPE_WEBGPU],
    antialias: false,
    powerPreference: "high-performance",
  });
  if (device.deviceType === pc.DEVICETYPE_NULL)
    throw new Error("No graphics device available.");
  device.maxPixelRatio = Math.min(devicePixelRatio, 1.5);
  app = new pc.Application(canvas, { graphicsDevice: device });
  const sceneBrightness=new SceneBrightness();
  let gpuMeter=null;
  const brightnessControls=()=>({enabled:$("scene-light-enabled").checked,
    strength:Number($("scene-light-strength").value),bias:Number($("scene-light-bias").value)});
  let savedLight;
  try{savedLight=readSceneBrightness(localStorage,selectedLevel.id);}catch{savedLight={enabled:true,strength:1,bias:0};}
  $("scene-light-enabled").checked=savedLight.enabled;
  $("scene-light-strength").value=savedLight.strength;
  $("scene-light-bias").value=savedLight.bias;
  for(const id of ['scene-light-enabled','scene-light-strength','scene-light-bias'])
    $(id).addEventListener('input',()=>{try{saveSceneBrightness(localStorage,selectedLevel.id,brightnessControls());}catch{}});
  // frameend follows PlayCanvas GPU submission; postrender is BEFORE submit.
  // Shared composition meters the raw world target, not the now-combined canvas.
  app.on('frameend',()=>{
    if(playing && !manual && $("scene-light-enabled").checked && $("loading").hidden){
      if(filmComposite)gpuMeter?.sample(cameraFrame.renderPassCamera?.sceneTexture?.impl.gpuTexture,
        gradeTexture.impl.gpuTexture,sceneBrightness,performance.now(),{
          enabled:$("film-tone-enabled").checked,knee:Number($("film-tone-knee").value),
          grade:gradeAmount($("grade-enabled").checked,$("grade-strength").value),exposure:app.scene.exposure});
      else sceneBrightness.sample(canvas,performance.now());
    }
  });
  installDisplayLutChunks(pc, device);
  installFilmTone(pc,device);
  function updateFilmTone(){device.scope.resolve('filmToneParams').setValue([
    $("film-tone-enabled").checked?1:0,Number($("film-tone-knee").value)]);}
  for(const id of ['film-tone-enabled','film-tone-knee'])$(id).addEventListener('input',updateFilmTone);
  updateFilmTone();
  const sprintFocus=new SprintFocus();
  const sprintMotion=new SprintMotion();
  const adsView=new AdsView();
  const adsSway=new AdsSway();
  const sprintFocusUniform=installSprintFocus(pc,device);
  const filmComposite=installFilmComposite(pc,device);
  const updateFilmFinish=installFilmFinish(pc,device);
  app.on('destroy',()=>{gpuMeter?.destroy();filmComposite?.destroy();});
  const detailSharpenUniform=device.scope.resolve('detailSharpen');
  const updateSharpening=()=>{
    const amount=sharpeningAmount($("sharpen-enabled").checked,$("sharpen-strength").value);
    detailSharpenUniform.setValue(amount);
    $("sharpen-status").textContent=amount>0 ? `DETAIL SHARPEN · ${Math.round(amount*100)}% · center-weighted` : "SHARPENING OFF";
  };
  for(const id of ["sharpen-enabled","sharpen-strength"])$(id).addEventListener('input',updateSharpening);
  updateSharpening();
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.scene.gsplat.splatBudget = Number($("launch-quality").value)*1e6;
  $("quality").value=$("launch-quality").value;
  // Evict unused chunks sooner; the default 100-tick cache can retain many
  // high-detail allocations while touring a large capture.
  app.scene.gsplat.cooldownTicks=20;
  app.scene.gsplat.lodUpdateAngle=3;
  app.scene.gsplat.lodBehindPenalty = 3;
  const updateSplatOptics=()=>{
    app.scene.gsplat.antiAlias=$('splat-aa').checked;
    app.scene.gsplat.minPixelSize=Math.max(1,Math.min(3,Number($('splat-min-pixels').value)||2));
    temporalHistory.reset();
  };
  for(const id of ['splat-aa','splat-min-pixels'])$(id).addEventListener('input',updateSplatOptics);
  updateSplatOptics();
  camera = new pc.Entity("First person camera");
  camera.addComponent("camera", {
    clearColor: new pc.Color(0.12, 0.16, 0.18),
    farClip: 700,
    nearClip: 0.05,
    fov: 75,
    toneMapping: pc.TONEMAP_LINEAR,
  });
  app.root.addChild(camera);
  const depthSupported = pc.CameraFrame.isSplatSceneDepthSupported(device);
  const cameraFrame = new pc.CameraFrame(app, camera.camera);
  cameraFrame.rendering.toneMapping = pc.TONEMAP_LINEAR;
  cameraFrame.rendering.samples = 1;
  app.scene.gsplat.sceneDepthWrite = depthSupported;
  let taaStability=.88;
  function updateTaa(){
    const settings=taaSettings($("taa-enabled").checked,$("taa-jitter").value,$("taa-stability").value,depthSupported);
    taaStability=settings.stability;
    Object.assign(cameraFrame.taa,{enabled:settings.enabled,jitter:settings.jitter});
    cameraFrame.update();
    temporalHistory.reset();
    attachTemporalHistory(pc,device,cameraFrame,temporalHistory,()=>taaStability);
    $("taa-status").textContent=settings.enabled?'TAA · depth reprojection · adaptive history · video/HUD stay sharp':
      depthSupported?'TAA OFF':'TAA unavailable · scene depth unsupported';
  }
  for(const id of ['taa-enabled','taa-jitter','taa-stability'])$(id).addEventListener('input',updateTaa);
  updateTaa();
  cameraFrame.dof.highQuality = true;
  cameraFrame.dof.blurRings = 3;
  cameraFrame.dof.blurRingPoints = 4;
  function updateDof() {
    const settings = cinematicDof($("dof-enabled").checked, $("dof-strength").value, $("dof-focus").value);
    Object.assign(cameraFrame.dof, settings, {enabled: depthSupported && settings.enabled});
    cameraFrame.update();
    $("dof-status").textContent = depthSupported
      ? settings.enabled ? `DEPTH DOF · sharp center · edge focus ${settings.focusDistance}m` : "DOF OFF"
      : "Scene depth unsupported · foreground softness only";
  }
  for (const id of ["dof-enabled", "dof-strength", "dof-focus"]) $(id).addEventListener("input", updateDof);
  updateDof();
  const gradeControls=()=>({blueCompression:Number($("grade-blue-compression").value),midtoneSoftness:Number($("grade-midtone-softness").value),shadowSeparation:Number($("grade-shadow-separation").value),filmPrint:Number($("film-print").value)});
  let gradeData = createGradeLut(gradeControls());
  let weaponGradeLayer=null,lastGradeKey=null;
  const gradeTexture = new pc.Texture(device, {
    name: "Neural Sight · NATURAL DAYLIGHT PRINT LUT", width: 256, height: 16,
    format: pc.PIXELFORMAT_RGBA8, srgb: false, mipmaps: false,
    minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  gradeTexture.lock().set(gradeData);
  gradeTexture.unlock();
  cameraFrame.colorLUT.texture = gradeTexture;
  function updateGrade() {
    const controls=gradeControls(),{blueCompression,midtoneSoftness,shadowSeparation}=controls,gradeKey=JSON.stringify(controls);
    if(gradeKey!==lastGradeKey){
      gradeData=createGradeLut(controls);
      gradeTexture.lock().set(gradeData);gradeTexture.unlock();
      weaponGradeLayer?.setGradeData(gradeData);
      lastGradeKey=gradeKey;
    }
    const amount = gradeAmount($("grade-enabled").checked, $("grade-strength").value);
    cameraFrame.colorLUT.intensity = amount;
    cameraFrame.update();
    $("grade-status").textContent = amount > 0
      ? `DAYLIGHT FILM PRINT · ${Math.round(amount*100)}% · palette ${Math.round(controls.filmPrint*100)}% · blue ${Math.round(blueCompression*100)}% · shared LUT` : "COLOR GRADE OFF";
  }
  for (const id of ["grade-enabled", "grade-strength","grade-blue-compression","grade-midtone-softness","grade-shadow-separation","film-print"]) $(id).addEventListener("input", updateGrade);
  updateGrade();
  resetView();
  app.start();
  $("backend").textContent = device.deviceType.toUpperCase();
  const layer = new WeaponLayer();
  $("loading").textContent=`${selectedLevel.name} · loading weapon poses…`;
  await layer.init($("weapon-canvas"),{graphicsDevice:device,composite:filmComposite,sceneCanvas:canvas});
  weaponGradeLayer=layer;layer.setGradeData(gradeData);
  if(filmComposite){gpuMeter=new SceneGpuMeter();await gpuMeter.init(device.wgpu);}
  $("weapon-backend").textContent = filmComposite?"WEBGPU · SHARED LINEAR HDR COMPOSITE":"WEBGPU · WGSL KEY · SEPARATE FALLBACK";
  const framePlayer = new FramePlayer();
  const firingPlayback=new FiringPlayback();
  $("loading").textContent=`${selectedLevel.name} · preparing video frames…`;
  await framePlayer.init().catch(console.warn);
  state.matchedRun=!!framePlayer.matchedRun;
  state.animatedRun=framePlayer.clips.runLateral?.authoredMotion!==false;
  collision = new CollisionController();
  $("loading").textContent=`${selectedLevel.name} · loading collision…`;
  if(selectedLevel.collisionUrl)await collision.init(selectedLevel.collisionUrl,fetchLocal);
  else {collision.enabled=false;$("collision-toggle").disabled=true;}
  // Publisher camera positions are eye points, not guaranteed FPS spawns.
  // Settle onto nearby ground before entering, preserving the published X/Z.
  const ground=collision.voxel&&findSpawnGround(collision.voxel,spawn);
  if(ground && Number.isFinite(ground.y)) {
    const dy=ground.y+1.5+.03-spawn[1];
    spawn=[spawn[0],spawn[1]+dy,spawn[2]];
    target=[target[0],target[1]+dy,target[2]];
    resetView();
  }
  $("collision-toggle").addEventListener("click", () => {
    movementMomentum.reset();
    collision.enabled = !collision.enabled;
    collision.reset();
  });
  bulletImpacts=new BulletImpacts(app);
  physicsBallView=new PhysicsBallView(app);
  const zombieLayer=new pc.Layer({name:'Infected · depth-aware dynamic actors'});app.scene.layers.push(zombieLayer);
  installZombieRenderPass(app,cameraFrame,zombieLayer);
  zombies=new ZombieEncounter(app,collision,audio,{depthSupported,hasSplatDepth:()=>!!cameraFrame.renderPassCamera?.sceneDepthTexture&&app.scene.gsplat.sceneDepthWrite,layerId:zombieLayer.id,onDamage:(_,health)=>{
    if(['dead','death'].includes(state.state))return;
    action(health<=0?'death':'hit');
  }});
  if(collision.voxel)void zombies.init(playerPosition,camera.forward).catch(error=>{zombies.status='Zombie loading failed: '+error.message;console.error(error);});
  else {zombies.enabled=false;zombies.status='No published colliders · encounter disabled';$('zombies-enabled').checked=false;$('zombies-enabled').disabled=true;$('revive-zombies').disabled=true;$('zombie-hud').textContent='FREE FLY · NO COLLIDERS';$('zombies-status').textContent=zombies.status;}
  const reviveZombies=()=>{if(playing&&!manual)zombies.revive();};
  const zombieHud=new ZombieHud($('zombie-hud'),$('zombies-status'));
  $("revive-zombies").addEventListener('click',reviveZombies);
  $("zombies-enabled").addEventListener('change',e=>{zombies.enabled=e.target.checked;});
  const pacing=new FramePacingCapture(),pacingButton=document.createElement('button'),pacingStatus=document.createElement('p');
  pacingButton.textContent='Capture 60s frame pacing';pacingButton.id='capture-pacing';pacingStatus.id='pacing-status';pacingStatus.textContent='Frame pacing · no capture yet';
  $('zombies-status').after(pacingButton,pacingStatus);
  pacingButton.onclick=()=>{if(pacing.running)pacing.finish();else pacing.start({level:selectedLevel.name,zombiesEnabled:zombies.enabled,population:zombies.population,width:canvas.width,height:canvas.height,renderer:device.deviceType});};
  const recordButton=document.createElement('button'),recordStatus=document.createElement('p');recordButton.textContent='Record encounter · 30s';recordButton.id='record-encounter';recordStatus.id='recording-status';recordStatus.textContent='Local video + game audio · not a performance capture';pacingStatus.after(recordButton,recordStatus);
  if(import.meta.env.PROD){recordButton.hidden=true;recordStatus.hidden=true;}
  const recording=new EncounterRecording({scene:canvas,weapon:filmComposite?null:document.getElementById('weapon-canvas'),audio,
    describe:()=>({level:selectedLevel.id,renderer:device.deviceType,dofInput:cameraFrame.renderPassCamera?.neuralDofInput?.source,
      imageSettings:{...gradeControls(),grade:Number($('grade-strength').value),grain:Number($('film-grain').value),diffusion:Number($('film-diffusion').value),lens:Number($('dof-strength').value),sharpness:Number($('sharpen-strength').value),taa:Number($('taa-stability').value),jitter:Number($('taa-jitter').value),taaEnabled:$('taa-enabled').checked,dofEnabled:$('dof-enabled').checked,textureEnabled:$('film-texture-enabled').checked,highlightKnee:Number($('film-tone-knee').value),splatAA:$('splat-aa').checked,minPixelSize:Number($('splat-min-pixels').value),detail:Number($('quality').value),lod:Number($('lod').value),referencePrintVersion:8},
      health:zombies.health,living:zombies.actors.filter(a=>!a.ragdoll).length,dead:zombies.actors.filter(a=>a.ragdoll).length,playing,manual,simulationClock:motionReview?.describe()??{kind:'live',simulationTime:elapsed},position:{x:playerPosition.x,y:playerPosition.y,z:playerPosition.z}}),
    onStatus:(message,result)=>{recordButton.textContent=recording.active?'Stop + save recording':'Record encounter · 30s';recordStatus.textContent=message;if(result){const link=document.createElement('a');link.href=result.video;link.textContent='Open recording';link.target='_blank';recordStatus.append(' · ',link);}recordStatus.dataset.capture=JSON.stringify(result??{});}});
  recordButton.onclick=async()=>{if(recording.active)return recording.stop();if(!playing||manual||pacing.running){recordStatus.textContent='Enter live play and finish the frame-time capture first';return;}try{await recording.start();}catch(error){recordStatus.textContent=error.message;}};
  const capturePacing=pacingButton.onclick;pacingButton.onclick=()=>{if(recording.starting||recording.active||recording.saving){pacingStatus.textContent='Stop video recording before measuring frame pacing';return;}capturePacing();};
  const spawnBall=()=>{
    if(!playing||manual||['dead','death'].includes(state.state))return;
    const ball=physicsBalls.spawn(camera.getPosition(),camera.forward,collision.voxel,collision.meta.gridBounds);
    $("balls-status").textContent=ball?'Ball spawned · shoot or bump it':'No clear space ahead · turn away from the wall';
  };
  $("spawn-ball").addEventListener('click',spawnBall);
  $("clear-balls").addEventListener('click',()=>{physicsBalls.reset();physicsBallView.reset();$("balls-status").textContent='Balls cleared';});
  $("mesh-toggle").disabled=!selectedLevel.mesh;
  if(!selectedLevel.mesh)$("mesh-toggle").textContent="Voxel collision active · no debug mesh";
  $("mesh-toggle").addEventListener("click", async () => {
    if (collisionMesh) {
      collisionMesh.enabled = !collisionMesh.enabled;
      return;
    }
    $("mesh-toggle").textContent = "Loading mesh…";
    app.assets.loadFromUrl(
      selectedLevel.mesh,
      "container",
      (err, a) => {
        if (err) {
          $("mesh-toggle").textContent = "Mesh not ready";
          return;
        }
        collisionMesh = a.resource.instantiateRenderEntity();
        const material = new pc.StandardMaterial();
        material.diffuse = new pc.Color(0.15, 1, 0.5);
        material.emissive = new pc.Color(0.05, 0.3, 0.1);
        material.opacity = 0.32;
        material.blendType = pc.BLEND_NORMAL;
        material.depthWrite = false;
        material.cull = pc.CULLFACE_NONE;
        material.update();
        for (const c of collisionMesh.findComponents("render"))
          for (const mi of c.meshInstances) {
            mi.material = material;
            mi.renderStyle = pc.RENDERSTYLE_WIREFRAME;
          }
        app.root.addChild(collisionMesh);
        $("mesh-toggle").textContent = "Toggle mesh";
      },
    );
  });
  // Verify the chosen endpoint with bounded retries before invoking the loader.
  $("loading").textContent=`${selectedLevel.name} · streaming publisher splats…`;
  const sceneSecurity=guardSceneAssets(app.assets,selectedLevel.contentUrl,document.baseURI,error=>{startupFailed=true;fail(error);});
  await fetchLocal(selectedLevel.contentUrl);
  const asset = new pc.Asset(selectedLevel.name, "gsplat", {
    url: selectedLevel.contentUrl,
  });
  app.assets.add(asset);
  await Promise.race([sceneSecurity.failure,new Promise((resolve, reject) => {
    asset.ready(resolve);
    asset.once("error", reject);
    app.assets.load(asset);
  })]);
  if(asset.resource.octree)asset.resource.octree.assetLoader.maxConcurrentLoads=1;
  app.assets.on('error',(error,failedAsset)=>{
    const url=failedAsset?.file?.url;
    if(!url?.startsWith(levelBase(selectedLevel)+'/'))return;
    streamErrors.set(url,String(error?.message||error));
    setTimeout(()=>{
      if(!streamErrors.has(url))return;
      fail(new Error(`Level stream could not load ${url}: ${streamErrors.get(url)}. Retry the level or choose a lower detail budget.`));
    },1200);
  });
  app.assets.on('load',loadedAsset=>{
    if(streamErrors.delete(loadedAsset?.file?.url) && !streamErrors.size && !startupFailed)clearError();
  });
  world = new pc.Entity(`${selectedLevel.name} — publisher splats`);
  world.setEulerAngles(0, 0, 180);
  world.addComponent("gsplat", {
    asset,
    unified: true,
    lodRangeMin: 0,
    lodRangeMax: selectedLevel.lods-1,
  });
  app.root.addChild(world);
  $("loading").hidden = true;
  $("scene-status").textContent = `NETWORK · ${selectedLevel.lods} quality level(s) · ${selectedLevel.name}`;
  clearError();
  document.documentElement.dataset.renderer = "ready";
  $("play").disabled = false;
  $("play").innerHTML = "Enter field session <span>→</span>";
  $("play").addEventListener("click", async () => {
    $("play").disabled = true;
    $("play").textContent = "Starting audio…";
    playing = true;
    document.body.classList.add("playing");
    $("session-overlay").hidden = true;
    canvas.focus();
    fpsMouse.capture();
    await activateAudio();
    $("play").disabled = false;
  });
  $("menu").addEventListener("click", pause);
  $("tools").addEventListener("click", toggleTools);
  $("sound").addEventListener("click", () => {
    if (!audio.muted && audio.context?.state === "running") audio.setMuted(true);
    else {
      audio.setMuted(false);
      void activateAudio();
    }
  });
  $("sound-test").addEventListener("click", async () => {
    audio.setMuted(false);
    if (audio.volume === 0) { audio.setVolume(.75); $("volume").value = ".75"; }
    await activateAudio();
    audio.peak = 0;
    audio.play("shot");
  });
  $("volume").addEventListener("input", e => audio.setVolume(Number(e.target.value)));
  const effectIds = [
    "taa-enabled","taa-jitter","taa-stability","splat-aa","splat-min-pixels",
    "motion-enabled","motion-shutter","motion-radius","motion-history","sprint-motion-enabled","sprint-motion-strength",
    "recoil-enabled","recoil-strength","recoil-noise","recoil-recovery",
    "hip-fire-chaos",
    "ads-control-enabled","ads-control-weight","ads-control-settling",
    "ads-sway-enabled","ads-sway-strength","ads-sway-rate",
    "head-lead","head-cone-screen","bob-enabled","bob-strength","run-frame-boost",
    "grade-enabled","grade-strength","grade-blue-compression","grade-midtone-softness","grade-shadow-separation","film-print","film-texture-enabled","film-grain","film-diffusion","film-tone-enabled","film-tone-knee","dof-enabled","dof-strength","dof-focus","dof-temporal-input",
    "sprint-focus-enabled","sprint-focus-strength","sprint-focus-preview","peripheral-focus-radius",
    "ads-zoom-enabled","ads-fov-tightening","ads-focus-enabled","ads-focus-strength",
    "flash-enabled","firing-video-enabled","flash-opacity","flash-strength","flash-size","flash-duration","flash-preview",
    "flash-light-enabled","flash-light-strength",
    "key-enabled","key-threshold","key-softness","key-despill",
    "impacts-enabled","shot-rays",
    "sharpen-enabled","sharpen-strength",
    "camera-kick-enabled","camera-kick-strength","camera-kick-recovery",
    "crouch-preview",
    "scene-light-enabled","scene-light-strength","scene-light-bias",
  ];
  // Visible numeric readouts on every effect slider; defaults remain one click away.
  for(const id of effectIds) {
    const input=$(id);
    if(input.type!=="range") continue;
    const output=document.createElement("output");
    output.htmlFor=id;
    output.style.cssText="float:right;color:#e3cfaa;font-variant-numeric:tabular-nums";
    document.querySelector('label[for="'+id+'"]').append(output);
    const refresh=()=>{output.value=input.value;};
    input.addEventListener("input",refresh); refresh();
  }
  $("effects-reset").addEventListener("click",()=>{
    for(const id of effectIds) {
      const input=$(id);
      if(input.type==="checkbox") input.checked=input.defaultChecked;
      else input.value=input.defaultValue;
      input.dispatchEvent(new Event("input"));
      input.dispatchEvent(new Event("change"));
    }
  });
  $("hud-toggle").addEventListener("click", () => {
    const hidden = document.body.classList.toggle("clean-capture");
    $("hud-toggle").textContent = hidden ? "Show HUD" : "Hide HUD · clean capture";
  });
  $("quality").addEventListener("change", (e) => {
    app.scene.gsplat.splatBudget = Number(e.target.value) * 1e6;
  });
  $("lod").addEventListener("change", (e) => {
    const v = Number(e.target.value);
    world.gsplat.lodRangeMin = v < 0 ? 0 : v;
    world.gsplat.lodRangeMax = v < 0 ? selectedLevel.lods-1 : v;
    $("quality-note").textContent =
      v < 0
        ? "Adaptive detail within budget"
        : "Fixed LOD preview · may exceed budget";
  });
  $("scrub").addEventListener("input", () => {
    aimInput.clear();
    manual = true;
    fireInput.clear();
    state.burst = 0;
  });
  $("resume").addEventListener("click", () => {
    manual = false;
  });
  const aimMode=$("ads-input-mode");
  try {if(localStorage.getItem('neural-sight.ads-mode')==='toggle')aimMode.value='toggle';} catch {}
  const updateAimMode=()=>{
    aimInput.setMode(aimMode.value);
    const verb=aimInput.mode==='hold'?'Hold':'Tap';
    $("ads-input-status").textContent=`${verb} right mouse / X / Aim button to aim`;
    $("play-hint").textContent=`Mouse look · Left click fire · ${verb} X / right mouse to aim · C / Ctrl crouch · Space jump`;
    try {localStorage.setItem('neural-sight.ads-mode',aimInput.mode);} catch {}
  };
  aimMode.addEventListener('change',updateAimMode);updateAimMode();
  const pressAim=source=>{
    if(!playing)return;
    recoverAudio();manual=false;aimInput.press(source);
  };
  const aimButton=$("aim-button");
  bindAimButton(aimButton,aimInput,pressAim);
  for (const b of document.querySelectorAll('[data-action]:not([data-action="aim"])'))
    b.addEventListener("click", () => { recoverAudio(); action(b.dataset.action); });
  const fire = $("fire");
  fire.addEventListener("pointerdown", (e) => {
    if(e.button!==0 || !playing)return;
    recoverAudio();
    manual = false;
    fire.setPointerCapture(e.pointerId);
    fireInput.set('button',true);
  });
  for (const e of ["pointerup", "pointercancel", "lostpointercapture"])
    fire.addEventListener(e, () => fireInput.set('button',false));
  fpsMouse=bindFpsMouse({canvas,doc:document,win:window,isPlaying:()=>playing,
    look,
    fire:held=>{if(held){recoverAudio();manual=false;}fireInput.set('mouse',held);},
    aim:held=>held?pressAim('mouse'):aimInput.release('mouse'),
    unlock:()=>{release();if(playing && $("lab").classList.contains('collapsed'))pause();},
    onStatus:message=>{$("input-hint").textContent=message;},
  });
  $("enter").addEventListener('click',()=>{if(playing){canvas.focus();fpsMouse.capture();}});
  if(new URLSearchParams(location.search).get('motionReview')==='1'){
    motionReview=mountMotionReview({
      container:$('lab'),look,aim:()=>{const aiming=!state.aim;aimInput.clear();state.setAim(aiming);},reset:()=>action('reset'),
      fire:held=>{if(!playing)return;if(held){recoverAudio();manual=false;}fireInput.set('review',held);},
      isFiring:()=>fireInput.sources.has('review'),
      move:codes=>{for(const code of ['KeyW','KeyA','KeyD','ShiftLeft','ControlLeft'])keys.delete(code);for(const code of codes)keys.add(code);},
      reload:()=>action('reload'),mode:()=>action('mode'),
    });
    pacingButton.disabled=true;
    pacingStatus.textContent='Frame pacing unavailable in frame-step review · use a normal session';
    recordStatus.textContent='Motion-study video · simulation clock metadata included · not live performance evidence';
  }
  window.addEventListener("keydown", (e) => {
    if (isUiKeyEvent(e)) return;
    if (e.code === "Escape") {
      e.preventDefault();
      if (playing) pause();
      return;
    }
    if (!playing) return;
    recoverAudio();
    // Consume gameplay shortcuts even with Ctrl held (Ctrl+R, Ctrl+W, etc.).
    if (GAME_KEYS.has(e.code))
      e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if(isSpawnResetKey(e)) {
      reloadInput.clear();
      returnPlayerToSpawn({keys,fireInput,state,resetView,
        clearCrouchPreview:()=>{$("crouch-preview").checked=false;}});
      return;
    }
    if(e.code==='KeyX'){e.preventDefault();pressAim('keyboard');}
    if(e.code==='KeyR')reloadInput.press();
    if(e.code==='KeyF')spawnBall();
    if(e.code==='KeyG')reviveZombies();
    if (e.code === "Space") {
      if(!manual && !['dead','death'].includes(state.state))collision.jump();
    }
    const actions = {
      KeyE: "equip",
      KeyV: "mode",
      KeyH: "hit",
      KeyN: "miss",
      KeyK: "death",
      Home: "reset",
    };
    if (actions[e.code]) action(actions[e.code]);
    if (e.code === "Tab") {
      e.preventDefault();
      toggleTools();
    }
  });
  window.addEventListener("keyup", (e) => {
    if(e.code==='KeyR')reloadInput.release();
    if(e.code==='KeyX')aimInput.release('keyboard');
    keys.delete(e.code);
  });
  window.addEventListener("blur", () => { release(); audio.stop(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing) pause();
  });
  window.addEventListener("resize", () => app.resizeCanvas());
  app.on("update", (dt) => {
    // DOF toggles may rebuild CameraFrame passes; attach once to each new TAA pass.
    attachTemporalHistory(pc,device,cameraFrame,temporalHistory,()=>taaStability);
    const meter = audio.meter();
    attachDofTemporalInput(cameraFrame,()=>$('dof-temporal-input').checked);
    $('dof-input-status').textContent=`DOF source · ${cameraFrame.renderPassCamera?.neuralDofInput?.source??'pending'} · trial`;
    $("audio-meter").value = meter.level;
    $("audio-peak").textContent = meter.peak > 0
      ? "Output peak " + (20 * Math.log10(meter.peak)).toFixed(1) + " dBFS"
      : "No output detected yet · Test gunshot";
    const actualDt = dt;
    dt = playing ? Math.min(dt, 0.05) : 0;
    if(motionReview)dt=motionReview.tick(dt);
    reloadInput.update(dt);
    elapsed += dt;
    updateFilmFinish?.($('film-texture-enabled').checked?Number($('film-grain').value):0,
      $('film-texture-enabled').checked?Number($('film-diffusion').value):0,elapsed);
    camera.setEulerAngles(pitch, yaw, 0);
    const dx = Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
      dz = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const moving = !!(dx || dz);
    if(playing && !manual && !['dead','death'].includes(state.state)) {
      const held=isCrouchHeld(keys)||$("crouch-preview").checked;
      crouch.update({held,dt,canStand:held || collision.canStand(playerPosition)});
      collision.setEyeHeight(playerPosition,crouch.eyeHeight);
    }
    // Capsule/eye height still ease safely; released crouch no longer holds
    // sprint hostage until the final visual standing frame.
    state.crouching=crouch.target===1;
    $("crouch-status").textContent=`${crouch.active?'CROUCHED':'STANDING'} · eye ${crouch.eyeHeight.toFixed(2)}m${crouch.blocked?' · ceiling blocks standing':''}`;
    const runPreview=$("run-preview").checked && !manual && playing;
    state.setMovement(moving||runPreview, runPreview || keys.has("ShiftLeft") || keys.has("ShiftRight"));
    state.shotPresentationDuration=$("firing-video-enabled").checked&&$("flash-enabled").checked?(framePlayer.clips.fireHip?.duration||0):0;
    if (!manual && playing) state.update(dt);
    const adsLens=adsView.update({state:state.state,aim:state.aim,dt,manual,
      remaining:Math.max(0,state.duration-state.time),
      zoomEnabled:$("ads-zoom-enabled").checked,tightening:$("ads-fov-tightening").value,
      blurEnabled:$("ads-focus-enabled").checked,blurStrength:$("ads-focus-strength").value,
      dofEnabled:$("dof-enabled").checked && Number($("dof-strength").value)>0,
    });
    camera.camera.fov=adsLens.fov;
    $("ads-view-status").textContent=`ADS VIEW · ${adsLens.fov.toFixed(1)}° FOV · edge softness ${Math.round(adsLens.peripheral*100)}%`;
    // Speed, footsteps, bob and HUD all use the same ADS-resolved sprint state.
    const run = state.running;
    const sprintScale=sprintDirectionScale(dx,dz);
    let distance = 0;
    if (playing && !["dead", "death"].includes(state.state)) {
      const motion = camera.forward.clone();
      motion.y = 0;
      motion.normalize().mulScalar(dz);
      const right = camera.right.clone();
      right.y = 0;
      right.normalize().mulScalar(dx);
      motion.add(right);
      if(collision.enabled) {
        const displacement=movementMomentum.update({x:motion.x,z:motion.z,dt,
          running:run,sprintScale,ads:state.aim || state.state==='ads',crouching:state.crouching,
          grounded:collision.grounded});
        motion.set(displacement.x,0,displacement.z);
      } else {
        movementMomentum.reset();
        if(motion.lengthSq())motion.normalize().mulScalar(dt*(state.crouching?1.1:run?5*sprintScale:2));
        motion.y =
          (Number(keys.has("KeyQ")) - Number(keys.has("KeyZ"))) * dt * 2;
      }
      const position = playerPosition.clone();
      collision.move(position, motion, dt);
      const before = playerPosition;
      if(collision.enabled)movementMomentum.resolveCollision(motion,{x:position.x-before.x,z:position.z-before.z});
      distance = Math.hypot(position.x - before.x, position.z - before.z);
      playerPosition.copy(position);
    } else movementMomentum.reset();
    const gaitDistance=runPreview&&run?5*dt:distance;
    const stride=strideCycle.update({distance:gaitDistance,dt,grounded:collision.enabled&&collision.grounded,
      running:run,active:playing&&!manual&&!['dead','death'].includes(state.state)});
    if (playing && !manual) audio.update(state, gaitDistance, collision.enabled && collision.grounded,stride.footfalls);
    const sprintSoftness=sprintFocus.update({
      running:run && !manual && !['dead','death'].includes(state.state),moving:distance>0.0001,
      ads:state.aim || state.pose==='ads',dt,
      enabled:$("sprint-focus-enabled").checked,
      dof:$("dof-enabled").checked && Number($("dof-strength").value)>0,
      strength:Number($("sprint-focus-strength").value)/100,
      preview:$("sprint-focus-preview").checked && !manual,
    });
    // Shared peripheral pass: ADS and sprint hand over rather than stacking blur.
    const peripheralSoftness=Math.max(sprintSoftness,adsLens.peripheral);
    const sprintMotionAmount=sprintMotion.update({dt,running:run,
      moving:gaitDistance>.0001,ads:state.aim||state.state==='ads',
      enabled:$("motion-enabled").checked&&$("sprint-motion-enabled").checked&&!manual&&playing,
      strength:Number($("sprint-motion-strength").value)/100});
    device.scope.resolve('sprintMotion').setValue([
      sprintMotionAmount*Math.min(1,Number($("motion-shutter").value)*2),
      Number($("motion-radius").value)*2,
    ]);
    sprintFocusUniform.setValue([peripheralSoftness,peripheralFocusRadius(
      $("dof-enabled").checked,$("dof-strength").value,$("peripheral-focus-radius").value)]);
    $("sprint-focus-status").textContent=`SPRINT BORDER SOFTNESS · +${Math.round(sprintSoftness*100)}% · center protected`;
    const gait = viewBob.update({
      dt, distance:gaitDistance, moving: (distance>.0001||runPreview&&run) && !manual && !["dead","death"].includes(state.state),
      grounded: collision.enabled && collision.grounded, running: run,
      ads: state.aim || state.pose === "ads", enabled: $("bob-enabled").checked,
      strength: Number($("bob-strength").value)*(crouch.active?.45:1),
      authoredRun:state.matchedRun && framePlayer.clips.runLateral?.authoredMotion!==false,
      stride,
      turnRate:turnTilt.rate,
      runCarryWeight:state.matchedRun?state.runCarryWeight:(run?1:0),
    });
    // Start from the authoritative position every frame: no accumulated drift.
    const eye = playerPosition.clone().add(camera.right.clone().mulScalar(gait.lateral));
    eye.y += gait.height;
    camera.setPosition(eye);
    const headRoll=turnTilt.update({dt,ads:state.aim,
      enabled:!manual && !['dead','death'].includes(state.state)});
    camera.setEulerAngles(pitch + gait.pitch, yaw, gait.roll+headRoll);
    const freeScreen=Number($("head-cone-screen").value)/100;
    const posture=weaponPosture.update({state:state.state,dt,freeAngle:1,
      remaining:Math.max(0,state.duration-state.time),progress:state.progress,authoredRun:state.matchedRun,running:run,aiming:state.aim,hipFraming:manual?null:state.hipFraming,
      aspect:canvas.clientWidth/canvas.clientHeight,posePhase:manual?null:state.presentationPhase});
    posture.shrink=runFraming.update({shrink:posture.shrink,phase:state.runCarryWeight,
      boost:manual?0:Number($("run-frame-boost").value)/100,dt,
      continuous:state.matchedRun&&!!state.carryFrame});
    const follow = headLead.update({
      dt, yaw, pitch, ads: !posture.reloading && (state.aim || state.state === "ads"),
      enabled: $("head-lead").checked && !manual && !["noGun","dead","death"].includes(state.state),
      freeScreen: freeScreen*posture.freeAngle,
      aspect: canvas.clientWidth/canvas.clientHeight, fov: camera.camera.fov,
    });
    motionReview?.publish({offset:follow,state:state.state});
    const bottomReserve=weaponFraming.update({dt,freeScreen:freeScreen*posture.freeAngle,
      fov:camera.camera.fov,ads:!posture.reloading&&(state.aim||state.state==='ads'),
      enabled:$("head-lead").checked&&!manual});
    const recoil = gunRecoil.update({
      shots: state.shots, dt, ads: state.lastShotStance === "ads",
      hipFire: state.lastShotStance === "hipFire", hipChaos:Number($("hip-fire-chaos").value),
      enabled: $("recoil-enabled").checked && !manual && !["noGun", "dead", "death"].includes(state.state),
      strength: Number($("recoil-strength").value),
      variation: Number($("recoil-noise").value),
      recovery: Number($("recoil-recovery").value),
    });
    const sway=adsSway.update({dt,active:state.state==='ads' && !manual,
      enabled:$("ads-sway-enabled").checked && !manual,
      strength:$("ads-sway-strength").value,rate:$("ads-sway-rate").value,
      fov:camera.camera.fov,aspect:canvas.clientWidth/canvas.clientHeight,
    });
    const control=adsControl.update({
      dt,mouseX:aimMouse.x,mouseY:aimMouse.y,recoil:{x:recoil.x+sway.x,y:recoil.y+sway.y},
      enabled:$("ads-control-enabled").checked && !manual && !['dead','death','noGun'].includes(state.state),
      active:state.state==='ads',
      weight:Number($("ads-control-weight").value),
      settling:Number($("ads-control-settling").value),
    });
    // A frozen review frame must not consume correction input before its
    // spring gets a simulation step; release() still clears paused sessions.
    if(dt>0)aimMouse.x=aimMouse.y=0;
    $("ads-stability").value=control.stability;
    $("ads-control-status").textContent=state.state!=="ads" ? "ADS only · camera input stays direct" :
      !$("ads-control-enabled").checked ? "COUNTER-STEERING OFF" :
      "SIGHT STABILITY "+Math.round(control.stability*100)+"% · shots follow sight displacement";
    damage = Math.max(0, damage - dt);
    $("hit-feedback").style.opacity = String(damage);
    $("death-notice").hidden = state.state !== "dead";
    document.body.classList.toggle("weapon-stowed", ["noGun", "dead"].includes(state.state));
    const progress = manual ? Number($("scrub").value) : state.progress,
      smooth = progress * progress * (3 - 2 * progress);
    let from = manual ? "lowReady" : state.previousPose,
      to = manual ? "ads" : state.pose;
    const crouchClip=manual?null:crouch.clip(state.state,distance>.0001);
    const playbackState=crouchClip && framePlayer.clips[crouchClip] ? crouchClip : state.state;
    const poseFrame=manual?null:crouchClip&&playbackState===crouchClip?
      crouch.transitionFrame(crouchClip,framePlayer.clips):state.carryFrame;
    const firingFrame=firingPlayback.update({shots:state.shots,stance:state.lastShotStance,state:state.state,
      busy:state.busy,dt,enabled:!manual&&playing&&$("flash-enabled").checked&&$("firing-video-enabled").checked,clips:framePlayer.clips});
    const frame = framePlayer.frame(
      manual ? "raising" : playbackState,
      crouchClip && playbackState===crouchClip ? crouch.progress : progress,
      state.idleSettle>0 && !state.busy && !moving && !state.aim && !run ? 0 : dt,
      manual,
      state.presentationPhase,
      firingFrame ?? poseFrame,
    );
    const flash = muzzleFlash.update(state.shots, dt, state.state, $("flash-enabled").checked, Number($("flash-duration").value)/1000);
    if ($("flash-preview").checked && $("flash-enabled").checked && MUZZLES[state.state] && !manual) {
      Object.assign(flash, MUZZLES[state.state], {strength: 1, seed: 2.4});
    }
    flash.strength *= Number($("flash-strength").value);
    flash.size *= Number($("flash-size").value);
    flash.light = $("flash-light-enabled").checked ? Number($("flash-light-strength").value) : 0;
    // Legacy footage includes lighting. Stable-base footage instead uses the
    // shader's light-only branch: generated effects never get a second flame.
    if(frame?.generatedFlash && !frame.stableBase){flash.strength=0;flash.light=0;}
    // Suppression belongs to the shot's stance, not a subsequent aim change.
    // CameraKick consumes suppressed events without storing a hidden impulse.
    const authoredRecoil=authoredRecoilReady(framePlayer,state.lastShotStance,
      !manual && $("flash-enabled").checked && $("firing-video-enabled").checked);
    const weaponX=gait.weaponX+recoil.x+control.x+sway.x;
    const weaponY=gait.weaponY+state.reaction*.008+recoil.y+control.y+sway.y+(manual?0:posture.y);
    const rollLimit=gunRecoil.hipProfile?.012:.008;
    // Keep the combat roll cap separate: it would clip the few-degree running
    // swing down to <1 degree. Gait rotation is bounded and eases away on ADS.
    const weaponRoll=Math.max(-rollLimit,Math.min(rollLimit,recoil.roll+control.roll+sway.roll))+gait.weaponRoll;
    // Stable canonical imagery shares the aim transform; its new shot impulse
    // is visual follow-through, excluded from that same bullet below.
    // Generated gun pixels are discarded; only flash/smoke animate behind it.
    const visualX=weaponX;
    const visualY=weaponY;
    const visualRoll=weaponRoll;
    const npcCpuStart=pacing.running?performance.now():0;
    zombies.update(dt,playerPosition,camera,{active:playing&&!manual,playerAlive:!['dead','death'].includes(state.state),eyeHeight:collision.eyeHeight});
    const npcCpuMs=pacing.running?performance.now()-npcCpuStart:0;
    physicsBalls.update(manual?0:dt,collision.voxel,collision.meta.gridBounds,
      ['dead','death'].includes(state.state)?null:{x:playerPosition.x,y:playerPosition.y,z:playerPosition.z,eyeHeight:collision.eyeHeight});
    ballistics.update({shots:state.shots,active:playing&&!manual,
      makeRay:id=>{
        const screen=shotScreenPoint({stance:state.lastShotStance,shot:id,
          aspect:canvas.clientWidth/canvas.clientHeight,fov:camera.camera.fov,
          // Counter-steering, sway and prior recoil still affect accuracy;
          // only the new shot's own impulse is excluded from that bullet.
          hipChaos:Number($("hip-fire-chaos").value),
          follow,bottomReserve,
          x:weaponX-recoil.x+gunRecoil.shotPose.x,
          y:weaponY-recoil.y+gunRecoil.shotPose.y,
          roll:Math.max(-rollLimit,Math.min(rollLimit,gunRecoil.shotPose.roll+control.roll+sway.roll))+gait.weaponRoll,
          shrink:posture.shrink,lower:posture.lower});
        const origin=camera.getPosition().clone();
        const target=camera.camera.screenToWorld(screen.x*canvas.clientWidth,screen.y*canvas.clientHeight,250);
        const direction=target.sub(origin).normalize();
        return {origin:{x:origin.x,y:origin.y,z:origin.z},
          direction:{x:direction.x,y:direction.y,z:direction.z},screen};
      },
      raycast:(origin,direction,range)=>resolveSceneShot({voxel:collision.voxel,balls:physicsBalls,zombies},origin,direction,range),
      onHit:record=>applySceneShot({balls:physicsBalls,zombies,impacts:bulletImpacts},record),
    });
    // Publish after hitscan commits so a kill and its DOWN count share a frame.
    if(collision.voxel)zombieHud.update(zombies);
    // Cosmetic recoil follows shot resolution, so a just-fired bullet is never
    // redirected by its own camera impulse. Base mouse aim/movement stay direct.
    const cameraImpulse=cameraKick.update({shots:state.shots,dt,
      ads:state.lastShotStance==='ads',
      suppressed:authoredRecoil,
      enabled:$("camera-kick-enabled").checked && !manual && !['death','dead','noGun'].includes(state.state),
      strength:$("camera-kick-strength").value,recovery:$("camera-kick-recovery").value});
    camera.setEulerAngles(pitch+gait.pitch+cameraImpulse.pitch,
      yaw+cameraImpulse.yaw,gait.roll+headRoll+cameraImpulse.roll);
    $("camera-kick-status").textContent=authoredRecoil&&Math.abs(cameraImpulse.pitch)<.001?'STABLE SIGHTS · generated effects only · no extra camera bounce':
      `CAMERA KICK · ${cameraImpulse.pitch.toFixed(2)}° · visual spring, no aim drift`;
    bulletImpacts.update(dt,camera,$("impacts-enabled").checked,collision.voxel);
    physicsBallView.update(physicsBalls.balls,camera,collision.voxel,dt);
    $("balls-count").textContent=`${physicsBalls.balls.length} / ${physicsBalls.capacity} balls · F alternates beach / soccer`;
    const lastShot=ballistics.last;
    $("ballistics-status").textContent=!collision.voxel ? "RAYCAST UNAVAILABLE · no collision data" :
      lastShot ? `SHOT ${lastShot.id} · ${lastShot.hit ? (lastShot.hit.ballId!==undefined?'BALL '+lastShot.hit.ballId+' · ':'HIT ')+lastShot.hit.distance.toFixed(1)+'m' : 'MISS / 250m range'} · ${ballistics.hits} hits` :
      "HITSCAN READY · 250m · voxel surface";
    $("ballistics-detail").textContent=lastShot ?
      `END ${[lastShot.end.x,lastShot.end.y,lastShot.end.z].map(v=>v.toFixed(2)).join(', ')} · ${bulletImpacts.slots.filter(s=>s.mark.entity.enabled).length} visible marks` : "No shots yet";
    if($("shot-rays").checked && lastShot) {
      // Debug only: persistent most recent ray and surface-normal cross.
      const end=new pc.Vec3(lastShot.end.x,lastShot.end.y,lastShot.end.z);
      const origin=new pc.Vec3(lastShot.origin.x,lastShot.origin.y,lastShot.origin.z);
      const color=lastShot.hit?new pc.Color(.4,1,.65):new pc.Color(1,.6,.2);
      app.drawLine(origin,end,color,false);
      for(const axis of [pc.Vec3.RIGHT,pc.Vec3.UP,pc.Vec3.FORWARD])
        app.drawLine(end.clone().sub(axis.clone().mulScalar(.1)),end.clone().add(axis.clone().mulScalar(.1)),color,false);
    }
    const motionKey=firingFrame?.clip??playbackState;
    const screenMotion=weaponScreenOffset({x:visualX,y:visualY,roll:visualRoll,
      aspect:canvas.clientWidth/canvas.clientHeight,follow,bottomReserve,
      shrink:manual?0:posture.shrink,lower:manual?0:posture.lower});
    const motion=weaponMotionBlur.update({
      x:screenMotion.x,y:screenMotion.y,
      scale:Number($("run-frame-boost").value)>0?1-posture.shrink:1,
      roll:visualRoll,dt,key:motionKey,
      enabled:$("motion-enabled").checked && !manual,
      shutter:Number($("motion-shutter").value),maxPixels:Number($("motion-radius").value),
      historyMix:frame?.generatedFlash?0:Number($("motion-history").value),
      sprintAmount:sprintMotionAmount,
    });
    const sceneEV=sceneBrightness.update(dt,brightnessControls());
    $("scene-light-status").textContent=!$("scene-light-enabled").checked?'SCENE MATCH OFF':
      sceneBrightness.error?`SCENE METER · ${sceneBrightness.error}`:
      `${selectedLevel.name} · ${sceneBrightness.luminance===null?'sampling…':Math.round(sceneBrightness.luminance*100)+'% linear luma'} · video ${sceneEV>=0?'+':''}${sceneEV.toFixed(2)} EV`;
    layer.render({
      flashOpacity:Number($("flash-opacity").value),
      sceneEV,
      sharpening:sharpeningAmount($("sharpen-enabled").checked,$("sharpen-strength").value),
      motion,dt,motionKey,
      sprintSoftness:peripheralSoftness,
      keyEnabled:$("key-enabled").checked,
      keyThreshold:Number($("key-threshold").value),
      keySoftness:Number($("key-softness").value),
      despill:Number($("key-despill").value),
      grade: gradeAmount($("grade-enabled").checked, $("grade-strength").value),
      filmToneEnabled:$("film-tone-enabled").checked,filmToneKnee:Number($("film-tone-knee").value),
      dof: cinematicDof($("dof-enabled").checked, $("dof-strength").value, $("dof-focus").value, state.state === "ads").foregroundRadius,
      flash: manual ? {} : flash,
      from,
      to,
      // Unfilmed actions use a pose cut, never a double-gun dissolve.
      blend: frame ? smooth : (progress < .5 ? 0 : 1),
      x: visualX,
      y: visualY,
      follow,bottomReserve,
      shrink: manual ? 0 : posture.shrink,
      lower: manual ? 0 : posture.lower,
      roll: visualRoll,
      frame,
    });
    $("state").textContent = manual
      ? "SCRUB PREVIEW"
      : state.state.replace(/([A-Z])/g, " $1").toUpperCase();
    $("movement").textContent =
      !moving && distance>.0001 ? "COASTING" : crouch.active ? (distance>.0001?'CROUCH WALK':'CROUCHED') : run && distance>.0001 ? "RUN" : distance>.0001 ? "WALK" : "STILL";
    $("ammo").textContent = String(state.ammo).padStart(2, "0");
    $("reserve-ammo").textContent = String(state.magazines.filter(n=>n>0).length);
    $("magazine-rounds").textContent=state.magazines.map(n=>`${n}/30`).join(' · ');
    $("magazine-action").textContent=state.state==='repack'
      ? `PACKING · ${Math.max(0,state.duration-state.time).toFixed(1)}s · release R to stop`
      : reloadInput.held&&!reloadInput.long?'HOLD R · preparing to repack':'';
    $("repack-status").textContent=state.state==='repack'
      ? `REPACKING · ${state.packMoved} rounds moved · ${Math.max(0,state.duration-state.time).toFixed(1)}s remaining · release R to stop`
      : reloadInput.held&&!reloadInput.long?'Keep holding R to repack; release to swap':
        `SPARES [${state.magazines.join(' / ')}] · tap R to swap · hold R to repack`;
    $("mode").textContent = state.mode.toUpperCase();
    $("timeline-fill").style.width = progress * 100 + "%";
    $("transition").textContent = manual
      ? "LOW READY → ADS · endpoint blend"
      : state.busy
        ? state.previousPose +
          " → " +
          state.pose +
          " · " +
          state.time.toFixed(2) +
          " / " +
          state.duration.toFixed(2) +
          "s"
        : state.pose + " · idle placeholder";
    if (frame)
      $("transition").textContent =
        (manual ? "RAISE STUDY" : playbackState) +
        " · frame " +
        (frame.index + 1) +
        " / " +
        frame.total +
        " · video draft";
    $("events").textContent = state.events.slice(0, 3).join(" / ");
    fpsTime += actualDt;
    if(pacing.running)pacing.sample(actualDt*1000,{active:playing&&!manual&&!document.hidden&&!motionReview,cpuMs:npcCpuMs,actors:zombies.actors.length,playerAlive:!['dead','death'].includes(state.state)});
    if(pacing.running){pacingButton.textContent='Cancel frame capture';pacingStatus.textContent=`Capturing · ${pacing.elapsed.toFixed(0)} / 60 s`;}
    else if(pacing.result){const r=pacing.result;pacingButton.textContent='Capture 60s frame pacing';pacingStatus.textContent=`${r.status} · frame p95 ${r.frameMs?.p95.toFixed(1)??'—'} ms · NPC CPU p95 ${r.npcCpuMs?.p95.toFixed(1)??'—'} ms · ${r.frames} frames`;pacingStatus.dataset.capture=JSON.stringify(r);}
    frames++;
    $("collision-status").textContent = collision.enabled
      ? "VOXEL 5cm · " +
        (collision.grounded ? "GROUNDED" : "AIR") +
        (collision.contacts ? " · CONTACT" : "")
      : "FREE FLY · Q/Z HEIGHT";
    if (fpsTime > 0.5) {
      const format=cameraFrame.renderPassCamera?.sceneTexture?.format;
      const hdrFormat=format===pc.PIXELFORMAT_111110F?'RGB11F':
        format===pc.PIXELFORMAT_RGBA16F?'RGBA16F':format===pc.PIXELFORMAT_RGBA32F?'RGBA32F':null;
      $("film-tone-status").textContent=hdrFormat?`${hdrFormat} HDR working buffer → SDR · shoulder ${$("film-tone-enabled").checked?'ON':'OFF'}`:
        'SDR working-buffer fallback · pre-clipped highlights cannot be restored';
      $("fps").textContent = Math.round(frames / fpsTime) + " FPS";
      const pos = playerPosition;
      $("position").textContent = [pos.x, pos.y, pos.z]
        .map((v) => v.toFixed(1))
        .join(", ");
      fpsTime = 0;
      frames = 0;
    }
  });
  window.neuralSight = { app, state, camera, layer, audio, framePlayer, collision, cameraFrame, viewBob, playerPosition, headLead, ballistics, bulletImpacts, physicsBalls, physicsBallView,zombies };
}
// No renderer, collision downloads, or frame decoding before an explicit choice.
// Returning to the selector reloads the document: old GPU devices, workers, and
// in-flight chunk streams cannot accumulate across level switches.
$("loading").hidden=true;
$("session-overlay").hidden=true;
try {selectedLevel=levelById(localStorage.getItem('neural-sight.level'));} catch {}
function selectLevel(level) {
  selectedLevel=level;
  for(const card of $("level-cards").children)
    card.setAttribute('aria-pressed',String(card.dataset.level===level.id));
  $("level-selection-note").textContent=`${level.name} · ${level.format==='sog'?'single-resolution SOG':`${level.lods} streamed LODs`} · ${level.colliderStatus || 'colliders checked at launch'} · ${level.author}${level.license?' · '+level.license:' · reuse rights unconfirmed'}`;
  $('scene-source').href=level.source;
}
function addLevelCard(level) {
  const card=document.createElement('button');card.className='level-card';card.dataset.level=level.id;
  const poster=document.createElement('img');poster.crossOrigin='anonymous';if(level.posterUrl)poster.src=level.posterUrl;poster.alt='';
  const name=document.createElement('strong');name.textContent=level.name;
  const subtitle=document.createElement('span');subtitle.textContent=level.subtitle;
  card.append(poster,name,subtitle);card.addEventListener('click',()=>selectLevel(level));
  $("level-cards").append(card);
}
for(const level of LEVELS)addLevelCard(level);
const levelCacheUi=mountLevelCache($('level-cache-panel'),LEVELS);
const resolverDefault=import.meta.env.DEV?'./api/scene':(import.meta.env.VITE_SCENE_RESOLVER_URL||'');
// Static Pages has no resolver. Enable only when the build supplies a real
// endpoint (Vite dev installs its own); never trust a stale saved placeholder.
const customImportAvailable=Boolean(resolverDefault);
$('scene-url').disabled=!customImportAvailable;
$('import-scene').disabled=!customImportAvailable;
$('scene-import-mode').textContent=customImportAvailable?'URL import available':'Local development only';
$('scene-import-availability').textContent=customImportAvailable
  ? 'Paste a public SuperSplat URL to inspect and add it.'
  : 'Custom URL import is unavailable on this GitHub Pages demo. Choose a featured level below, or run locally to import other scenes.';
$('scene-local-help').hidden=customImportAvailable;
try {
  const saved=JSON.parse(localStorage.getItem('neural-sight.custom-scene')||'null');
  // Only store the source URL, never trust persisted asset URLs or metadata.
  if(typeof saved==='string')$('scene-url').value=saved;
} catch {}
$('add-scene-form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!customImportAvailable)return;
  $('import-scene').disabled=true;$('import-status').textContent='Inspecting publisher scene and voxel metadata…';
  try {
    const level=await importLevel($('scene-url').value.trim(),{catalog:LEVELS,resolver:resolverDefault});
    const old=[...$('level-cards').children].find(c=>c.dataset.level===level.id);old?.remove();
    addLevelCard(level);selectLevel(level);levelCacheUi.add(level);
    $('import-status').textContent=`${level.lods} quality levels · ${level.colliderStatus}`;
    try {localStorage.setItem('neural-sight.custom-scene',level.source);}catch{}
  } catch(error){
    $('import-status').textContent=error.message;
  }
  finally{$('import-scene').disabled=false;}
});
selectLevel(selectedLevel);
async function launchLevel() {
  $("launch-level").disabled=true;
  try {await resumeLevelCache(selectedLevel.id);selectedLevel=await inspectLevel(selectedLevel);selectLevel(selectedLevel);}
  catch(error){$('level-selection-note').textContent=error.message;$('launch-level').disabled=false;return;}
  spawn=[...selectedLevel.spawn];target=[...selectedLevel.target];
  audio.footstepSurface=selectedLevel.id==='fb3b5ed5'?'desert':'default';
  try {localStorage.setItem('neural-sight.level',selectedLevel.id);} catch {}
  document.title=`Neural Sight — ${selectedLevel.name}`;
  canvas.setAttribute('aria-label',`${selectedLevel.name} 3D splat viewport`);
  const heading=document.querySelector('header h1');
  heading.textContent=selectedLevel.name;
  const subtitle=document.createElement('span');subtitle.textContent=selectedLevel.subtitle;heading.append(subtitle);
  $("session-title").textContent=`Step into ${selectedLevel.name}.`;
  $("session-description").textContent=`Explore ${selectedLevel.subtitle.toLowerCase()} with screen-space video and ${selectedLevel.collisionUrl?'voxel collision':'free-fly movement · no published colliders'}.`;
  document.querySelector('.session-credit').textContent=`Scene: ${selectedLevel.author} · ${selectedLevel.license||'Reuse rights unconfirmed'} · generated footage approval pending.`;
  const sourceLink=document.createElement('a');sourceLink.href=selectedLevel.source;sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';sourceLink.textContent=' Publisher / scene rights ↗';document.querySelector('.session-credit').append(sourceLink);
  document.querySelector('footer small').textContent=`${selectedLevel.author} · ${selectedLevel.license||'reuse rights unconfirmed'}`;
  $("lod").replaceChildren(...lodOptions(selectedLevel).map(o=>new Option(o.label,o.value)));
  $("level-picker").hidden=true;$("session-overlay").hidden=false;
  $("loading").textContent=`Loading ${selectedLevel.name}…`;$("loading").hidden=false;
  clearError();
  try {await start();} catch(error) {startupFailed=true;fail(error);}
}
$("launch-level").addEventListener('click',launchLevel);
for(const id of ['change-level','error-level-picker'])$(id).addEventListener('click',()=>location.reload());
$("retry-level").addEventListener('click',()=>{
  // A one-shot session flag retries the current selection in a fresh renderer.
  try {sessionStorage.setItem('neural-sight.retry',selectedLevel.source);} catch {}
  location.reload();
});
try {
  const retry=sessionStorage.getItem('neural-sight.retry');sessionStorage.removeItem('neural-sight.retry');
  if(retry) {
    void importLevel(retry.startsWith('https:')?retry:levelById(retry).source,{catalog:LEVELS,resolver:resolverDefault})
      .then(level=>{if(!LEVELS.some(l=>l.id===level.id))addLevelCard(level);selectLevel(level);return launchLevel();})
      .catch(error=>{$('import-status').textContent=error.message;$('level-selection-note').textContent=error.message;});
  }
} catch {}
