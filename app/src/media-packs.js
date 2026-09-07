import {unzipSync} from 'fflate';
import {validatePackManifest, sha256, mediaType, unpackArchive} from './media-pack-format.js';
import {installMediaUrls} from './media-url.js';

// Cache the ZIPs, not thousands of individual frame responses. The cache is
// namespaced to this Pages project; hashes identify immutable pack versions.
export function cacheName(base) { return `neural-sight-media-v1:${base}`; }
export async function verifiedArchive(pack, url, {cache, fetcher = fetch, onProgress = () => {}} = {}) {
  const valid = async bytes => bytes.byteLength === pack.bytes && await sha256(bytes) === pack.sha256;
  try {
    const response = await cache?.match(url);
    if (response) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (await valid(bytes)) { onProgress(bytes.length, true); return bytes; }
      await cache.delete(url);
    }
  } catch { /* Private mode/quota/cache corruption must not prevent playback. */ }
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, {cache:attempt ? 'reload' : 'default', signal:AbortSignal.timeout(120000)});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const chunks = []; let size = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const {value, done} = await reader.read(); if (done) break;
            size += value.length;
            if (size > pack.bytes) throw Error('Archive exceeds expected size');
            chunks.push(value); onProgress(size, false);
          }
        } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      } else { const data = new Uint8Array(await response.arrayBuffer()); chunks.push(data); size = data.length; }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (!await valid(bytes)) throw Error('Archive integrity check failed');
      try { await cache?.put(url, new Response(bytes, {headers:{'Content-Type':'application/zip'}})); }
      catch { /* Persistence is best effort. Verified bytes are still usable. */ }
      onProgress(bytes.length, false); return bytes;
    } catch (error) { failure = error; }
  }
  throw Error(`Could not load media pack: ${failure?.message}. Check your connection and retry.`);
}

export async function prepareMedia({base = new URL(import.meta.env?.BASE_URL ?? './', document.baseURI).href, onProgress = () => {}} = {}) {
  const response = await fetch(new URL('packs/manifest.json', base), {cache:'no-cache', signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw Error(`Media manifest unavailable (HTTP ${response.status})`);
  const manifest = validatePackManifest(await response.json());
  let cache;
  try { cache = await caches.open(cacheName(base)); } catch { /* Optional browser storage. */ }
  const urls = new Map(), wanted = new Set();
  const total = manifest.packs.reduce((n,p) => n+p.bytes, 0);
  let loaded = 0, cacheHits = 0;
  try {
    for (const [index, pack] of manifest.packs.entries()) {
      const url = new URL('packs/' + pack.file, base).href;
      wanted.add(url);
      let hit = false;
      const bytes = await verifiedArchive(pack, url, {cache, onProgress:(bytes, cached) => {
        hit = cached;
        onProgress({loaded:loaded+bytes, total, index:index+1, packs:manifest.packs.length, cached, phase:'loading'});
      }});
      if (hit) cacheHits++;
      onProgress({loaded:loaded+bytes.length, total, index:index+1, packs:manifest.packs.length, phase:'unpacking'});
      // STORE archives avoid expensive decompression. Yield before each pack
      // and every 32 Blob allocations so the loading UI can paint.
      await new Promise(resolve => setTimeout(resolve, 0));
      const data = unpackArchive(bytes, pack, unzipSync);
      for (const [i, entry] of pack.entries.entries()) {
        const value = data[entry.path];
        if (!value || value.length !== entry.bytes || await sha256(value) !== entry.sha256) throw Error(`Invalid media: ${entry.path}`);
        urls.set(entry.path, URL.createObjectURL(new Blob([value], {type:mediaType(entry.path)})));
        delete data[entry.path];
        if (i % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      loaded += bytes.length;
    }
    installMediaUrls(urls);
  } catch (error) {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    throw error;
  }
  // Only remove stale entries belonging to THIS project after full success.
  try { for (const request of await cache?.keys() ?? []) if (!wanted.has(request.url)) await cache.delete(request); } catch {}
  return {files:urls.size, packs:manifest.packs.length, bytes:total, cacheHits};
}
