# Packed runtime / GitHub Pages

The release consists of runtime/build source, deployment notes, and `docs/`.
Production media is 1,011 assets in three content-hashed ZIPs (62,155,990 bytes).
The weapon still uses 969 WebP frames internally; archives remove loose-file
clutter and request overhead, not frame data. ZIP STORE avoids recompressing
already compressed images and sound. Every ZIP stays below 25 MiB.

## Build and verify a clean checkout

Use Node 24 LTS and run from the repository root:

```sh
npm --prefix app ci
npm --prefix app run build:pages
npm --prefix app run audit:upload
```

This verifies archive and entry SHA-256 hashes, safe paths, exact membership,
runtime dependency coverage and self-contained GLBs. The secret audit scans
Git-eligible files AND unpacked contents. It reports paths/counts, never values;
it is heuristic, not an exhaustive credential/history audit.

Builds require only `docs/packs`, not ignored loose assets. Vite builds into
ignored `app/dist`; the publisher copies only generated app outputs into `docs`.
It never empties `docs`. Current hashed bundles and packs are allowlisted in
generated ignore files. Historical versions stay on disk, ignored.

## Browser loading and caching

Bootstrap fetches the small manifest with revalidation, then sequentially loads
and verifies each ZIP. Pack/expanded-size limits and path validation reject
invalid archives. It unpacks assets into typed Blobs; manifest, frames, audio,
poses and GLBs retain their logical `/media/` identifiers inside the app.
Weapon packs need no service worker or server extraction. The separate
`level-cache-sw.js` module controls only approved, versioned publisher scene
URLs, covering engine XHR/image/fetch loaders as well as collider reads.

The Cache API stores only ZIP responses in an app-path-specific namespace.
SHA-256 names invalidate changed packs; corrupt cache entries are replaced.
Old entries in that namespace are pruned only after successful full loading.
Storage denial/quota/eviction never blocks playback: verified network bytes
remain usable. A failure screen offers retry and cache clearing. Live Blob URLs
last for the page session and failed partial loads revoke their URLs.

A cold launch downloads roughly 59.3 MiB and allocates compressed media in
memory, in addition to later decoded frames/textures. Subsequent launches still
verify and unpack cached archives. Cache persistence is best effort and may be
evicted by the browser. HTML, the weapon manifest, uncached level detail and
custom URL resolution still need network access; do not claim complete offline
support. HTTPS (or localhost) is required.

Each level gets its own Cache API namespace scoped to the Pages project. Scene
files use cache-first reads without revalidation; versioned URLs distinguish
publisher versions. Use the launch screen’s Level download cache panel to purge
stale or unwanted data. Purge detaches only that scene's cache immediately
and prevents late downloads from refilling it. Caching stays paused until the next
explicit launch of that level. Other tabs already rendering it retain in-memory
assets. Failed, opaque, redirected and partial responses are not stored. A storage
failure falls back to streaming with a visible cache status. The panel includes
previously cached custom IDs so they can be purged without re-importing them.

## Updating media intentionally

Original `assets/**`, downloaded levels, unused MP4 takes, and loose `docs/media/**`
remain local and ignored. They are not deleted. On the authoring workstation:

1. Update the required files under `docs/media` and its version-2
   `production-inventory.json` (byte lengths and SHA-256 values).
2. If loader schemas changed, update the dependency extractor in
   `scripts/package-production.mjs`. Preserve all attribution.
3. Run `npm --prefix app run pack:media`. It validates local inventory, audits
   source content, writes deterministic ZIPs and verifies the packed release.
4. Run `build:pages` and `audit:upload`; commit the new manifest/packs, generated
   ignore rules and current build. Do not force-add ignored files.

For media editing on a clean checkout, extract ZIP entries into a new local
`docs/media/` directory using a ZIP utility. Reconstruct the version-2 inventory
from pack entries: `source = docs/media/<path>`, `destination = <path>`, retain
`bytes` and `sha256`, sort by destination. This authoring-only operation is never
a prerequisite for running or rebuilding the release.

## Publish `/docs` on GitHub Pages

The [live demo](https://monstercameron.github.io/Neural-Sight/) is published from
`main` → `/docs` in `monstercameron/Neural-Sight`, with HTTPS enforced.
The repository website field and README point to that same address.
To reproduce these settings in a fork after uploading Git-eligible files:

1. Open repository **Settings → Pages**.
2. Choose **Deploy from a branch**, select your publishing branch and **/docs**.
3. Save and use the HTTPS address GitHub reports when deployment completes.

The committed build has relative paths and `.nojekyll`; no custom domain or
server build is required. These are GitHub's supported
[branch publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
Never drag the entire original local folder into an upload: Git ignore rules do
not protect a filesystem copy from including secrets, raw takes and levels.

Built-in levels stream from publisher endpoints and are not included in ZIPs.
Arbitrary SuperSplat viewer URLs need the optional
[resolver deployment](../deploy/scene-resolver/README.md), because Pages cannot
run Node middleware. Keep publisher attribution visible and review
[asset rights](ASSET-NOTICES.md) before public release. Public availability does
not grant scene redistribution rights.
