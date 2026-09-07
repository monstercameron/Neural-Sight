# Neural Sight browser runtime

This directory contains the PlayCanvas/WebGPU prototype described in the
[project README](../README.md). It combines streamed Gaussian splats, collision
data, a photographic hands/weapon overlay, Web Audio, and conventional dynamic
objects including zombies. The current image-quality pass is at **8/50**; zombie
refinement is deferred. The prototype has no final visual-quality acceptance.

## Development and deployment

```sh
npm ci
npm run dev
```

Use the URL printed by Vite. WebGPU, hardware acceleration, and a user gesture
for sound are required. Pointer lock depends on the browser; drag-look is available.
See the root README for controls.

From the repository root:

```sh
npm --prefix app run build:pages
node scripts/package-production.mjs --verify docs/packs
```

`build:pages` verifies `../docs/packs`, builds into ignored `app/dist` and publishes
application code into `../docs`. Both Vite and Pages load the same three ZIPs,
verify their contents and install in-memory Blob URLs before starting gameplay.
ZIP responses are cached per project path; blocked or evicted browser storage
falls back to network loading. A loading screen offers retry and cache clearing.
Loose originals and old hashed builds stay on disk but are gitignored.
Versioned SuperSplat downloads use a separate per-level service-worker cache,
including the renderer's nested chunks/textures and voxel data. Open **Level
download cache** in the launcher to inspect sizes or purge a single level.
Purge does not clear weapon packs or other scenes. Only downloaded detail is
retained, and browser storage eviction can still require a future download.
For a static release preview, serve `../docs` over HTTP (not `file://`). A
successful bundle build alone does not prove all remote scenes or transitions.

Built-in levels use publisher-hosted splat/collision endpoints. Arbitrary
SuperSplat viewer URLs additionally need HTML resolution through the local
development resolver or a separately deployed resolver worker. Pages cannot run
server middleware. Confirm worker configuration and publisher availability before
claiming an arbitrary URL works in the hosted demo. No API generation credential
belongs in client configuration or a static build.

## Verification

Runtime asset verification runs from the repository root:

```sh
node scripts/package-production.mjs --verify docs/packs
node scripts/package-production.mjs --audit
```

Development tests and review fixtures remain on the original workstation but are
gitignored at the user's request; a clean checkout contains runtime/build files,
not the historical test suite. The original workstation can still run
`node test-core.mjs` and `node --test ../scripts/package-production.test.mjs`.
An asset audit or bundle build is not a completed browser/visual acceptance.

To repack intentionally updated local runtime media, run `npm run pack:media`,
then `npm run build:pages`. This explicit authoring step needs the local
`docs/media` inventory; ordinary clean-checkout builds do not. See the packaging
contract for restoring loose authoring inputs from ZIPs without raw generations.

Browser acceptance should cover entry, aiming and reversals, sprinting, crouch,
fire/reload, sound, pause/resume, built-in remote scene loading, and operation
under a repository subpath. Test arbitrary URL resolution separately. Do not count
frame-stepped motion studies as real-time performance evidence.

## Current limitations

Captured worlds contain holes, floaters and baked lighting. Screen-space weapon
footage has no recovered geometric depth or world lighting; focus and motion
effects are approximations. Missing frames can hold the previous image. Source
cadence, transitions, optical consistency and performance still need refinement.
Film-look controls are custom processing, not an ARRI color-science transform.
No sustained frame-rate claim, cross-device guarantee or renderer-quality win is
established by the experiment.

The [packaging contract](../project-notes/PRODUCTION-PACKAGING.md) explains which
assets ship and why. [Asset notices](../project-notes/ASSET-NOTICES.md) accompany
the demo; third-party captures are streamed rather than included in this repo.
