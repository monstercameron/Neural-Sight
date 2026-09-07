#!/usr/bin/env node
// Release audits use docs/packs; loose docs/media remains an ignored authoring input.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MOUNTS = {
  playback: 'docs/media/playback',
  poses: 'docs/media/poses',
  characters: 'docs/media/characters', audio: 'docs/media/audio',
  clips: 'docs/media/clips',
};
const BEGIN = '# BEGIN production asset allowlist (package-production.mjs)';
const END = '# END production asset allowlist';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function mediaSource(url) {
  if (typeof url !== 'string' || !url.startsWith('/media/') || /[%?#\\\x00-\x1f]/.test(url)) throw Error('Invalid runtime media URL');
  const parts = decodeURIComponent(url).split('/').slice(2);
  if (parts.some(p => !p || p.startsWith('.') || /[\\\x00]/.test(p))) throw Error('Unsafe runtime media URL');
  const mount = MOUNTS[parts.shift()];
  if (!mount) throw Error('Unapproved media mount');
  return `${mount}/${parts.join('/')}`;
}
export async function readSafe(root, relative) {
  const base = await fs.realpath(root), full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) throw Error('Path outside repository');
  // Reject symlinks even when they point inside the repository.
  let current = base;
  for (const part of path.relative(base, full).split(path.sep)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw Error(`Symlink rejected: ${relative}`);
  }
  return fs.readFile(full);
}
export function manifestURLs(manifest) {
  const urls = new Set();
  for (const [name, clip] of Object.entries(manifest)) {
    if (!Array.isArray(clip.frames) || !clip.frames.length) throw Error(`Unsupported clip schema: ${name}`);
    for (const url of clip.frames) { mediaSource(url); urls.add(url); }
    // Source provenance is deliberately not a dependency. Only an explicit
    // runtime video URL is eligible when a video player starts using one.
    if (clip.video) { mediaSource(clip.video); urls.add(clip.video); }
  }
  return [...urls];
}
export async function inventory(root = ROOT, readAsset = p => readSafe(root, p)) {
  const read = async p => (await readSafe(root, p)).toString('utf8');
  const urls = new Set(['/media/playback/manifest.json']);
  const manifest = JSON.parse(await readAsset(mediaSource('/media/playback/manifest.json')));
  for (const url of manifestURLs(manifest)) urls.add(url);
  // These modules contain data exports and no initialization side effects.
  const {CUES, DESERT_STEPS, RIFLE_SHOTS} = await import(pathToFileURL(path.join(root, 'app/src/audio-director.js')));
  for (const id of new Set(Object.values(CUES).map(c => c[0]))) {
    const name = `SFX-${String(id).padStart(2, '0')}`;
    urls.add(`/media/audio/${name}/${name}.mp3`);
  }
  for (const id of Object.values(DESERT_STEPS).flat()) urls.add(`/media/audio/desert-v1/${id}/step.wav`);
  for (const id of RIFLE_SHOTS) urls.add(`/media/audio/rifle-v2/${id}/shot.wav`);
  const zombie = await read('app/src/zombie-audio.js');
  const names = zombie.match(/const CUES\s*=\s*(\[[^;]+\])/);
  if (!names) throw Error('Zombie audio schema changed; review inventory');
  for (const [, id] of names[1].matchAll(/['"]([^'"]+)['"]/g)) urls.add(`/media/audio/zombies-v1/${id}/clip.mp3`);
  const weapon = await read('app/src/weapon-layer.js');
  const poses = [...weapon.matchAll(/["']([^"']+\.png)["']/g)].map(m => m[1]);
  if (!poses.length) throw Error('Pose loader changed; review inventory');
  for (const pose of poses) urls.add(`/media/poses/${pose}`);
  const encounter = await read('app/src/zombie-encounter.js');
  const models = encounter.match(/\[([^\]]+)\]\.map\(name\s*=>\s*load\(/);
  if (!models) throw Error('Zombie model loader changed; review inventory');
  for (const [, name] of models[1].matchAll(/['"]([^'"]+)['"]/g)) urls.add(`/media/characters/zombie/${name}.glb`);
  const files = [];
  for (const url of [...urls].sort()) {
    const source = mediaSource(url), bytes = await readAsset(source);
    if (source.endsWith('.glb')) {
      const g = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      for (const item of [...(g.images ?? []), ...(g.buffers ?? [])]) {
        if (item.uri && !item.uri.startsWith('data:')) throw Error(`External GLB dependency needs inventory: ${source}`);
      }
    }
    if (bytes.length >= 100 * 1024 * 1024) throw Error(`Asset exceeds 100 MiB: ${source}`);
    files.push({source, destination: url.slice('/media/'.length), bytes: bytes.length, sha256: hash(bytes)});
  }
  for (const source of ['docs/media/characters/zombie/ATTRIBUTION.md', 'docs/media/ASSET-NOTICES.md']) {
    const bytes = await readAsset(source);
    files.push({source, destination: source.slice('docs/media/'.length), bytes: bytes.length, sha256: hash(bytes)});
  }
  return files.sort((a,b) => a.destination.localeCompare(b.destination));
}
export function ignoreBlock() {
  return [BEGIN, '/assets/**', END].join('\n');
}
function uploadCandidates(root) {
  return [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, maxBuffer: 32 * 1024 * 1024}).toString().split('\0').filter(Boolean))];
}
export async function auditEligibility(files, root = ROOT) {
  const ignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
  if (ignore.split('\n').some(line => /^!\/?assets(?:\/|$)/.test(line.trim()))) throw Error('Original assets must be entirely ignored; remove asset exceptions');
  // Check effective rules, not just a marker string. Probe paths also work in
  // a clean clone in which the original assets directory does not exist.
  const probes = ['assets/', 'assets/__production_audit_probe__/unused.mp4'];
  let ignored;
  try { ignored = execFileSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], {cwd: root, input: probes.join('\0') + '\0'}).toString().split('\0').filter(Boolean); }
  catch { throw Error('Original assets directory must be entirely ignored'); }
  if (probes.some(p => !ignored.includes(p))) throw Error('Original assets directory must be entirely ignored');
  const {validatePackManifest} = await import('../app/src/media-pack-format.js');
  const manifest = validatePackManifest(JSON.parse(await readSafe(root, 'docs/packs/manifest.json')));
  const eligible = uploadCandidates(root), expected = new Set(manifest.packs.map(p => 'docs/packs/' + p.file));
  expected.add('docs/packs/manifest.json');
  expected.add('docs/packs/.gitignore');
  const unexpected = eligible.filter(p => p.startsWith('assets/') || p.startsWith('docs/media/') || (p.startsWith('docs/packs/') && !expected.has(p)));
  const actual = new Set(eligible);
  const missing = [...expected].filter(p => !actual.has(p));
  if (unexpected.length || missing.length) throw Error(`Upload media mismatch: ${unexpected.length} unexpected, ${missing.length} missing; paths: ${[...unexpected,...missing].join(', ')}`);
  return eligible;
}
export function secretCount(text) {
  // Heuristic defense in depth, not a claim that all credential formats exist here.
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,})\b/g,
    /\b(?:FAL_KEY|OPENAI_API_KEY|ELEVENLABS_API_KEY|API_SECRET|ACCESS_TOKEN|CLIENT_SECRET)\b\s*["']?\s*[:=]\s*["']?([A-Za-z0-9_:.+\/-]{16,})/gi,
    /https?:\/\/[^\s"'<>]+[?&](?:token|api_key|access_token|signature|x-amz-signature)=[A-Za-z0-9%_+\/-]{16,}/gi,
  ];
  return patterns.reduce((sum, pattern) => sum + [...text.matchAll(pattern)].filter(m => !/^(?:process\.env|import\.meta\.env|your[_-]|example|placeholder)/i.test(m[1] ?? '')).length, 0);
}
export async function auditSecrets(root = ROOT, unpacked = new Map()) {
  const names = uploadCandidates(root);
  const findings = [];
  const localCredentials = [];
  const knownSecrets = new Set();
  for (const dir of ['', 'app']) {
    for (const entry of await fs.readdir(path.join(root, dir), {withFileTypes: true})) {
      if (entry.isFile() && /^\.env(?:\.|$)/.test(entry.name) && entry.name !== '.env.example') {
        const relative = path.posix.join(dir, entry.name);
        const value = await fs.readFile(path.join(root, relative), 'utf8');
        const count = value.split('\n').filter(line => /^\s*[A-Z_][A-Z0-9_]*\s*=\s*\S/i.test(line)).length;
        localCredentials.push({path: relative, count});
        for (const line of value.split('\n')) {
          const match = line.match(/^\s*(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*(.*?)\s*$/i);
          const secret = match?.[1].replace(/^(['"])(.*)\1$/, '$2');
          if (secret?.length >= 12) knownSecrets.add(secret);
        }
      }
    }
  }
  for (const relative of new Set([...names, ...unpacked.keys()])) {
    const bytes = unpacked.get(relative) ?? await readSafe(root, relative);
    // Compare known local values against every candidate, including binaries.
    // Values never leave this function; reports contain paths and counts only.
    const knownCount = [...knownSecrets].filter(secret => bytes.includes(Buffer.from(secret))).length;
    const count = knownCount + (bytes.includes(0) ? 0 : secretCount(bytes.toString('utf8')));
    if (count) findings.push({path: relative, count});
  }
  return {scannedUploadFiles: new Set(names).size, uploadFindings: findings, localCredentialFiles: localCredentials};
}
export async function packageMedia(files, output, root = ROOT) {
  root = path.resolve(root);
  const dest = path.resolve(root, output), allowed = [path.join(root, 'docs/media'), path.join(root, 'work') + path.sep];
  if (dest !== allowed[0] && !dest.startsWith(allowed[1])) throw Error('Output must be docs/media or a new directory beneath work/');
  // Compatibility with old callers: canonical output is verification ONLY.
  // Even an absent/empty canonical directory must never be reconstructed here.
  if (dest === allowed[0]) { await verifyPackage(files, output, root); return; }
  validateInventory(files);
  await verifyPackage(await inventory(root), 'docs/media', root);
  try { if ((await fs.readdir(dest)).length) throw Error('Output is not empty; choose a new work/ directory'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  let ancestor = path.dirname(dest);
  while (ancestor.startsWith(path.resolve(root))) {
    try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw Error('Symlink output rejected'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
    if (ancestor === path.resolve(root)) break;
    ancestor = path.dirname(ancestor);
  }
  try { if ((await fs.lstat(dest)).isSymbolicLink()) throw Error('Symlink output rejected'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  for (const file of files) {
    const bytes = await readSafe(root, file.source);
    if (hash(bytes) !== file.sha256) throw Error(`Source changed during packaging: ${file.source}`);
    const target = path.join(dest, file.destination);
    if (!target.startsWith(dest + path.sep)) throw Error('Unsafe destination');
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, bytes, {flag: 'wx'});
  }
  await fs.writeFile(path.join(dest, 'production-inventory.json'), JSON.stringify({version: 2, files}, null, 2) + '\n', {flag: 'wx'});
}
function validateInventory(files) {
  const seen = new Set();
  for (const file of files) {
    const parts = file.destination?.split('/');
    if (!parts?.length || parts.some(p => !p || p.startsWith('.') || /[\\\x00-\x1f]/.test(p)) ||
        file.source !== `docs/media/${file.destination}` || file.destination === 'production-inventory.json' ||
        seen.has(file.destination) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid canonical inventory entry');
    seen.add(file.destination);
  }
}
export async function verifyPackage(files, output, root = ROOT) {
  validateInventory(files);
  const expected = new Set(files.map(f => f.destination)); expected.add('production-inventory.json');
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error('Symlink in package');
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative + '/');
      else if (!entry.isFile() || !expected.delete(relative)) throw Error(`Unexpected packaged file: ${relative}`);
    }
  }
  const dest = path.resolve(root, output);
  // readSafe rejects symlinks in the root and every intermediate directory.
  const recorded = JSON.parse((await readSafe(root, path.relative(root, path.join(dest, 'production-inventory.json')))).toString('utf8'));
  await walk(dest);
  if (expected.size) throw Error(`Missing packaged files: ${expected.size}`);
  if (JSON.stringify(recorded) !== JSON.stringify({version: 2, files})) throw Error('Packaged inventory does not match current canonical sources');
  for (const file of files) {
    const bytes = await readSafe(root, path.relative(root, path.join(dest, file.destination)));
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw Error(`Package hash mismatch: ${file.destination}`);
  }
}
async function main(args) {
  const valid = new Set(['--out', '--verify', '--audit', '--allowlist', '--inventory']);
  for (let i = 0; i < args.length; i++) {
    if (!valid.has(args[i])) throw Error('Usage: node scripts/package-production.mjs [--inventory|--allowlist|--audit|--verify docs/packs] (authoring check: --verify docs/media)');
    if (['--out', '--verify'].includes(args[i]) && !args[++i]) throw Error('Output argument required');
  }
  // Legacy loose-media verification is explicit, never required by a release.
  if (args.includes('--verify') && args[args.indexOf('--verify') + 1] === 'docs/media') {
    const files = await inventory(); await verifyPackage(files, 'docs/media');
    console.log(`Verified ${files.length} local loose assets`); return;
  }
  if (args.includes('--out')) throw Error('Use npm --prefix app run pack:media to publish archives; loose originals are never overwritten');
  const {verifyPacks} = await import('./pack-media.mjs');
  const {files, contents, manifest} = await verifyPacks();
  if (args.includes('--allowlist')) { console.log(ignoreBlock(files)); return; }
  if (args.includes('--inventory')) { console.log(JSON.stringify(files, null, 2)); return; }
  await auditEligibility(files);
  // Packed membership and unpacked content were validated above; also scan
  // bytes before compression so ZIP metadata cannot hide text credentials.
  const audit = await auditSecrets(ROOT, contents);
  const summary = {files: files.length, packs:manifest.packs.length, bytes: files.reduce((n,f) => n + f.bytes, 0), ...audit};
  console.log(JSON.stringify(summary, null, 2));
  if (audit.uploadFindings.length) throw Error('Possible secrets in upload tree; findings above contain only paths and counts');
  for (const flag of ['--out', '--verify']) {
    const index = args.indexOf(flag);
    if (index >= 0) {
      if (args[index + 1] !== 'docs/packs') throw Error('Release verification target must be docs/packs');
      console.log(`Verified ${files.length} packed production assets`);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
