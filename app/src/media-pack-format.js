// Shared by the browser loader and release verifier. No filesystem dependencies.
export const PACK_LIMIT = 25 * 1024 * 1024;
export const MEDIA_TYPES = Object.freeze({
  webp:'image/webp', png:'image/png', json:'application/json',
  mp3:'audio/mpeg', wav:'audio/wav', glb:'model/gltf-binary',
  mp4:'video/mp4', webm:'video/webm', md:'text/markdown',
});
export const mediaType = name => MEDIA_TYPES[name.split('.').pop()];
export function validatePackManifest(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.packs) ||
      !manifest.packs.length || manifest.packs.length > 32) throw Error('Unsupported media pack manifest');
  const paths = new Set(), names = new Set();
  let total = 0;
  for (const pack of manifest.packs) {
    if (!/^[a-f0-9]{64}$/.test(pack.sha256) || pack.file !== `media-${pack.sha256}.zip` ||
        names.has(pack.file) || !Number.isSafeInteger(pack.bytes) || pack.bytes <= 0 || pack.bytes > PACK_LIMIT ||
        !Array.isArray(pack.entries) || !pack.entries.length) throw Error('Invalid media pack');
    names.add(pack.file);
    let expanded = 0;
    for (const entry of pack.entries) {
      const name = entry.path;
      if (typeof name !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(name) ||
          name.split('/').some(p => !p || p.startsWith('.')) || !mediaType(name) || paths.has(name) ||
          !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > PACK_LIMIT ||
          !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Invalid media entry');
      paths.add(name); expanded += entry.bytes;
    }
    if (expanded > PACK_LIMIT || paths.size > 10000) throw Error('Media pack expansion limit exceeded');
    total += expanded;
  }
  if (total !== manifest.bytes || paths.size !== manifest.files || total > 256 * 1024 * 1024)
    throw Error('Media manifest totals mismatch');
  return manifest;
}
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function unpackArchive(bytes, pack, unzip) {
  const expected = new Map(pack.entries.map(e => [e.path, e]));
  const seen = new Set();
  const data = unzip(bytes, {filter:entry => {
    if (!expected.has(entry.name) || seen.has(entry.name) || expected.get(entry.name).bytes !== entry.originalSize)
      throw Error('Archive membership mismatch');
    seen.add(entry.name); return true;
  }});
  if (seen.size !== expected.size || Object.keys(data).length !== expected.size) throw Error('Archive membership mismatch');
  return data;
}
