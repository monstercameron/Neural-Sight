# Neural Sight

**[Play the live demo →](https://monstercameron.github.io/Neural-Sight/)** ·
[Project thesis & outcome](https://monstercameron.github.io/Neural-Sight/experiment.html) ·
[Explore SuperSplat](https://superspl.at/)

A photographic FPS playground built over roughly 24 hours with **GPT-6 Astra**.
Captured places, generated hands and weapon footage, and responsive gameplay—all
running in a browser.

The idea is simple: **how much realism can we get from captured and pre-generated
assets, and how quickly can we turn them into something fun to play?**

## Captured worlds, generated presence

Gaussian splats provide the static world: weathered timber, sunlit stone, rusty
metal and the lighting captured with them. Instead of reconstructing every
surface as a conventional mesh and material, the scene preserves its photographed
appearance as a collection of 3D Gaussians. You can move through it and look around;
it isn't a flat background video.

The hands and weapon take a different shortcut. AI-generated footage is prepared
ahead of time, extracted into frames, and composited in screen space. A state
machine connects low ready, aiming, firing, running, crouching and reloads.
Camera motion, elastic free-look, recoil compensation and sound give those fixed
assets a responsive performance.

**Generation happens before play. Interaction happens in real time.** No model
request sits between a mouse movement and the next frame.

PlayCanvas renders the splats and dynamic objects. Published voxel colliders
provide ground contact and bullet ray hits. A WebGPU compositor brings the world
and weapon together with color grading, peripheral focus, motion blur, temporal
antialiasing and sharpening.

## Realism and performance

The experiment puts captured appearance to work where it is strongest: **static
scenes**. Lighting and surface detail are already present in the capture, while
gameplay code handles movement, physics and interaction.

Performance comes down to what is visible and how much work each frame requires:

- Streamed levels of detail and a configurable splat budget control scene cost.
- Prepared weapon frames keep generation out of the gameplay loop.
- Three ZIP packs hold the production media; the browser unpacks them in memory
  and caches them for later visits.
- Downloaded splat chunks, textures and colliders are cached separately per level.

These are useful tradeoffs, not free realism. Large splat scenes still cost GPU
time, bandwidth and memory; video frames need decoding and compositing; cinematic
effects add work. Captures have holes and baked lighting, and screen-space footage
cannot provide arbitrary weapon viewpoints. This prototype explores the balance—it
doesn't establish a performance win over rasterization or path tracing.

## Built to play with

Sprint through a captured place. Fight the recoil to keep a sight on target.
Swap magazines or slowly repack their remaining rounds. Toss beach balls into the
scene, shoot them, or try the experimental zombie encounter.

The tools panel exposes the image and motion settings so you can change the feel
while playing. GPT-6 Astra helped build and iterate across gameplay, shaders,
asset processing, audio and browser testing. The point was to make an unusual
idea playable quickly, learn from it, and have fun with the result.

## Try it

Open the **[live demo](https://monstercameron.github.io/Neural-Sight/)** in a desktop
browser with WebGPU and hardware acceleration. Choose a level, then enter the
session to enable sound and mouse capture.

The first visit loads about **59 MiB of production media**, plus streamed level
data. Later visits reuse browser caches when available. In the launcher, **Level
download cache → Purge cache** clears one scene without clearing weapon media.
Only downloaded detail is cached, and browsers may evict stored data.

The four featured scenes work directly. Adding other SuperSplat URLs on the
hosted demo requires the optional [scene resolver](deploy/scene-resolver/README.md).

## Controls

| Input | Action |
| --- | --- |
| WASD / Shift | Move / sprint |
| Mouse / left click | Look / fire |
| Right mouse / X | Aim; hold by default, toggle available in settings |
| C or Ctrl / Space | Crouch / jump |
| Tap R / hold R | Swap magazine / repack rounds |
| V / E | Change fire mode / equip or stow |
| F / G | Toss a ball / revive defeated zombies |
| Escape / Tab | Pause / show tools |
| ~ / Home | Return to spawn / reset view and weapon state |

## Run locally

Use Node 24, then:

```sh
cd app
npm ci
npm run dev
```

No generation API key is needed to run or build the game.

To rebuild the GitHub Pages site from the repository root:

```sh
npm --prefix app run build:pages
npm --prefix app run audit:upload
```

Pages serves `main` → `/docs`. Production media lives in `docs/packs/`; raw
generations, loose working frames, downloaded levels and credentials stay ignored.
See the [packaging notes](project-notes/PRODUCTION-PACKAGING.md) for asset updates.

## Credits

Scenes stream from their [SuperSplat](https://superspl.at/) publishers, with
attribution shown in the level selector. The prototype uses PlayCanvas, generated
weapon footage and sound, and third-party character assets. See
[asset notices](project-notes/ASSET-NOTICES.md) for credits and reuse terms.
