#!/usr/bin/env node
// Explicit authoring operation: retain loose originals; publish only verified packs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT, inventory, verifyPackage, readSafe, auditSecrets} from './package-production.mjs';
import {validatePackManifest, PACK_LIMIT, unpackArchive} from '../app/src/media-pack-format.js';
const {zipSync, unzipSync} = createRequire(new URL('../app/package.json', import.meta.url))('fflate');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyPacks(root = ROOT) {
  const manifest = validatePackManifest(JSON.parse(await readSafe(root, 'docs/packs/manifest.json')));
  const contents = new Map();
  for (const pack of manifest.packs) {
    const bytes = await readSafe(root, `docs/packs/${pack.file}`);
    if (bytes.length !== pack.bytes || digest(bytes) !== pack.sha256) throw Error(`Archive hash mismatch: ${pack.file}`);
    const unpacked = unpackArchive(bytes, pack, unzipSync);
    for (const entry of pack.entries) {
      const data = Buffer.from(unpacked[entry.path]);
      if (data.length !== entry.bytes || digest(data) !== entry.sha256) throw Error(`Entry hash mismatch: ${entry.path}`);
      contents.set(`docs/media/${entry.path}`, data);
    }
  }
  // Re-derive dependencies from current runtime code using ONLY packed bytes.
  // A fresh checkout must not silently depend on ignored loose assets.
  const files = await inventory(root, async name => {
    if (!contents.has(name)) throw Error(`Runtime dependency missing from packs: ${name}`);
    return contents.get(name);
  });
  if (files.length !== contents.size) throw Error('Packs contain unused media outside the runtime inventory');
  return {manifest, files, contents};
}
async function safeWrite(root, relative, bytes, immutable = false) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), {recursive:true});
  for (const name of ['docs', 'docs/packs', relative]) {
    try { if ((await fs.lstat(path.join(root, name))).isSymbolicLink()) throw Error('Archive output symlink rejected'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (immutable) {
    try { await fs.writeFile(target, bytes, {flag:'wx'}); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!(await fs.readFile(target)).equals(Buffer.from(bytes))) throw Error('Existing immutable pack differs');
    }
  } else await fs.writeFile(target, bytes);
}
export async function packMedia(root = ROOT) {
  const files = await inventory(root);
  await verifyPackage(files, 'docs/media', root);
  const contents = new Map();
  for (const file of files) {
    const bytes = await readSafe(root, file.source);
    if (digest(bytes) !== file.sha256) throw Error('Source changed while packaging');
    contents.set(file.source, bytes);
  }
  const audit = await auditSecrets(root, contents);
  if (audit.uploadFindings.length) throw Error('Secret audit failed; inspect --audit (values never logged)');
  const groups = [[]]; let size = 0;
  // Leave ample ZIP header space under 25 MiB. Media is already compressed;
  // STORE keeps packaging deterministic and extraction cheap on startup.
  for (const file of files) {
    if (file.bytes > 24 * 1024 * 1024) throw Error('Single asset too large; split it before packaging');
    if (size + file.bytes > 24 * 1024 * 1024) { groups.push([]); size = 0; }
    groups.at(-1).push(file); size += file.bytes;
  }
  const packs = [];
  for (const group of groups) {
    const input = Object.fromEntries(group.map(f => [f.destination, contents.get(f.source)]));
    const bytes = zipSync(input, {level:0, mtime:new Date(2020, 0, 1)});
    const sha256 = digest(bytes), file = `media-${sha256}.zip`;
    if (bytes.length > PACK_LIMIT) throw Error('ZIP exceeds pack limit');
    await safeWrite(root, `docs/packs/${file}`, bytes, true);
    packs.push({file, bytes:bytes.length, sha256, entries:group.map(f => ({path:f.destination, bytes:f.bytes, sha256:f.sha256}))});
  }
  const manifest = validatePackManifest({version:1, files:files.length, bytes:files.reduce((n,f) => n+f.bytes,0), packs});
  await safeWrite(root, 'docs/packs/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  await safeWrite(root, 'docs/packs/.gitignore', '# Generated; retain old archives on disk but ship only this release.\n/*\n!/.gitignore\n!/manifest.json\n' + packs.map(p => '!/' + p.file).join('\n') + '\n');
  await verifyPacks(root);
  console.log(`Packed ${files.length} files into ${packs.length} ZIPs (${packs.reduce((n,p)=>n+p.bytes,0)} bytes). Loose originals untouched.`);
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packMedia().catch(error => { console.error(error.message); process.exitCode = 1; });
}
