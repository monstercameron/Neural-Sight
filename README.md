# Neural Sight

**[Play the live demo →](https://monstercameron.github.io/Neural-Sight/)** ·
[Project thesis & outcome](https://monstercameron.github.io/Neural-Sight/experiment.html)

A first-person browser experiment built over roughly 24 hours with **GPT-6 Astra**,
combining captured Gaussian-splat environments, generated footage of hands and a
rifle, and conventional gameplay code. The question was how far this combination
could get toward a convincing photographic game prototype in a short session.

The result is an interactive prototype with movement, aiming, firing, finite
ammunition, reloads, crouching, jumping, spatial audio, and a small zombie encounter.
The weapon footage is composited in screen space; it is not a fully modeled,
world-lit weapon. PlayCanvas renders the environment and gameplay objects, and
a WebGPU compositor handles the photographic weapon layer.

The strongest outcome is a working combination of captured environments and
responsive footage-based interaction. Its limits are still visible: capture holes
and floaters, lighting differences between footage and scene, imperfect pose joins,
source cadence, optical approximations, and variable performance. This is an
experiment report, not a finished-game announcement or a controlled benchmark.

The current film-look refinement ledger records **8 of 50 cycles complete**.
The active focus is depth of field, motion blur, temporal antialiasing and sharpness.
Zombies remain in the demo but are not the current refinement focus. Neither
completion of all 50 cycles nor an ARRI ALEXA/feature-film quality match is claimed.
The 24-hour description refers to the initial experiment, not a measured guarantee
of development time, quality or future reproducibility.

The reference-led optics pass adds a warm daylight print, restrained blue chroma,
fine post-TAA grain, gentler sharpening and a smaller TAA jitter footprint. Keyed
weapon texels are filtered in premultiplied linear light; generated smoke is
separated from the stable gun and its reflected muzzle light. Highlight diffusion
and native splat-AA trials remain off by default. These are measured prototype
improvements, not an independent 8/10 or feature-film certification. Source scan
distortions and footage/scene lighting differences remain visible.

## Try it

Open the **[live GitHub Pages demo](https://monstercameron.github.io/Neural-Sight/)**
or read the [project thesis and outcome](https://monstercameron.github.io/Neural-Sight/experiment.html).
Pages publishes the committed [`docs/`](docs/) build from `main`, over HTTPS.

Use a desktop browser with WebGPU support and hardware acceleration. Enter the
session to enable sound and mouse capture. Built-in scenes stream splats and
collision data from their publishers; the repository does not include downloaded
levels. Downloaded splat chunks, textures and voxel colliders are cached per level
in the browser and reused on later visits. The launch screen’s **Level download
cache** panel shows sizes and a one-click **Purge cache** for each scene (including
previously imported IDs). A purge leaves weapon media and other levels untouched;
caching resumes when that level is launched again. Only downloaded detail is
cached, not every quality level in advance. Storage is best effort: browser
eviction, unseen chunks, and custom URL resolution can still require the network.

Loading an arbitrary SuperSplat viewer URL requires the included resolver service:
the viewer HTML cannot be fetched directly from the browser because of CORS.
The development resolver runs locally; a hosted deployment needs its worker
deployed and configured. GitHub Pages serves static files and cannot run that
resolver. Built-in scene endpoints do not require that HTML-resolution step.

## Controls

| Input | Action |
| --- | --- |
| WASD / Shift | Move / sprint |
| Mouse / left click | Look / fire with captured mouse; drag-look is available |
| Right mouse / X | Aim; hold or toggle follows the selected setting |
| C / Ctrl / Space | Crouch / crouch / jump |
| Tap R / hold R | Reload / repack ammunition |
| V / E | Change fire mode / equip or stow |
| Escape / Tab | Pause / show or hide tools |
| G / F | Revive defeated zombies / spawn a physics test ball |
| Home | Reset view and weapon state |

Tools expose scene, sound and image-quality settings. H, N and K trigger hit,
near-miss and death test actions. The free-fly tool uses Q/Z for vertical movement.

## Run locally

Install a Node.js release supported by the pinned Vite version, then:

```sh
cd app
npm ci
npm run dev
```

Open the local URL printed by Vite. Runtime use and building need **no generation
API key**. Do not put secrets in `VITE_*`, source files, a hosted build, or the
resolver's browser configuration. Historical generation scripts and `.env` remain
local and ignored; they are not required to run this demo.

## Build for upload

From the repository root:

```sh
npm --prefix app run build:pages
node scripts/package-production.mjs --verify docs/packs
node scripts/package-production.mjs --audit
```

`docs/packs/` contains the production media: **1,011 assets in three ZIPs**, about
59.3 MiB total. A hashed manifest validates every archive and extracted file.
The browser unpacks them into in-memory Blob URLs before starting the player,
and caches the ZIPs for later visits when browser storage is available. A cold
start downloads all three packs; repeat visits reuse verified cached packs.
This reduces file/request clutter, not the underlying media size. Levels stream
separately into a per-level browser cache; this is not a fully offline game.

`build:pages` verifies packs, builds into ignored `app/dist`, and updates the
ready-to-serve `docs/` folder. A clean checkout builds using only committed packs;
it needs neither loose frames nor generation credentials. Original loose files in
`docs/media/` stay on disk, ignored. Old ZIPs and app bundles also remain on disk
but only the current release is Git-eligible. Do not upload the entire local
folder: upload Git-eligible files only.

`.gitignore` excludes the entire original `assets/` tree, raw takes, downloaded
levels, generation metadata, recordings, tests, standalone review pages,
historical ledgers, dependencies and local secrets. It preserves these files on
disk. Required manifests, endpoint images, audio, character models and notices
ship inside `docs/packs/`, alongside runtime source and build code.
The current weapon player uses extracted frames as its production media; the
unused original MP4 takes stay local and ignored. Restricting upload to video
extensions alone would break the demo.

Read [the packaging contract](project-notes/PRODUCTION-PACKAGING.md) for the
inventory, audit commands, limitations and update procedure, and
[asset notices](project-notes/ASSET-NOTICES.md) for attribution and rights context.
Nothing in the packaging workflow commits, pushes, downloads levels or purchases
generation. A secret scan is a heuristic check, not a guarantee that every possible
credential format has been detected.
