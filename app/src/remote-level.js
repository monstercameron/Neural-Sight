export function sceneId(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'superspl.at' || url.port || url.username || url.password)
    throw new Error('Use a public https://superspl.at/scene/… URL.');
  const id = url.pathname.match(/^\/scene\/([a-f0-9]{8})\/?$/i)?.[1] ??
    (url.pathname === '/s' ? url.searchParams.get('id') : null);
  if (!/^[a-f0-9]{8}$/i.test(id ?? '')) throw new Error('The SuperSplat scene ID is not valid.');
  return id.toLowerCase();
}
export function publicAsset(input) {
  const u = new URL(input);
  const allowed = u.hostname === 'd28zzqy0iyovbz.cloudfront.net' ||
    (u.hostname === 's3-eu-west-1.amazonaws.com' && /^\/(splats|images)\.playcanvas\.com\//.test(u.pathname));
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || !allowed)
    throw new Error('Unsupported publisher asset origin.');
  return u.href;
}
const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export function sceneDependency(input, contentUrl) {
  const base=new URL('.',contentUrl),url=new URL(input,contentUrl);
  publicAsset(url.href);
  if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw new Error('Scene dependency leaves the publisher scene directory.');
  return url.href;
}
// Every streamed chunk and its texture assets passes through this registry.
// Keep checks at load time as well as inspection: publisher content can change.
export function guardSceneAssets(registry,contentUrl,baseURI,onError=()=>{}) {
  const load=registry.load.bind(registry),characters=new URL('./media/characters/zombie/',baseURI),blocked=new WeakSet();
  let reject;const failure=new Promise((_,r)=>{reject=r;});failure.catch(()=>{});
  registry.load=asset=>{
    try {
      const raw=asset.getFileUrl?.();
      // GLB parser creates named texture assets backed by embedded bytes, not
      // network URLs. SOG references never populate file.contents.
      const embedded=asset.type==='texture'&&asset.file?.contents instanceof ArrayBuffer;
      if(raw&&!embedded){const url=new URL(raw,baseURI);const owned=url.origin===characters.origin&&url.pathname.startsWith(characters.pathname)&&/\/(walk|attack|revive)\.glb$/.test(url.pathname);if(!owned)sceneDependency(url.href,contentUrl);}
    } catch(error){
      if(!blocked.has(asset)){blocked.add(asset);reject(error);onError(error);}
      // Let one-shot engine listeners detach before its bounded LOD retry.
      // Synchronous error emission re-enters the same listener recursively.
      queueMicrotask(()=>{asset.fire('error',error,asset);registry.fire('error',error,asset);});return;
    }
    return load(asset);
  };
  return {failure};
}
export function validateSog(meta,contentUrl) {
  if(meta.version!==2||!Number.isSafeInteger(meta.count)||meta.count<1)throw new Error('Invalid SOG v2 metadata.');
  for(const [key,count] of [['means',2],['scales',1],['quats',1],['sh0',1],...(meta.shN?[['shN',2]]:[])]){
    const files=meta[key]?.files;
    if(!Array.isArray(files)||files.length!==count||files.some(f=>typeof f!=='string'||!f))throw new Error(`SOG ${key} textures are missing or invalid.`);
    for(const file of files)sceneDependency(file,contentUrl);
  }
  if(!vector(meta.means.mins)||!vector(meta.means.maxs))throw new Error('Invalid SOG bounds.');
  for(const key of ['scales','sh0'])if(!Array.isArray(meta[key].codebook)||meta[key].codebook.length!==256||!meta[key].codebook.every(Number.isFinite))throw new Error(`Invalid SOG ${key} codebook.`);
}
export async function readExactBinary(response,expected) {
  if(!Number.isSafeInteger(expected)||expected<4||expected>256*1024*1024)throw new Error('Invalid collision byte limit.');
  const reader=response.body?.getReader();if(!reader)throw new Error('Collision stream unavailable.');
  const output=new Uint8Array(expected);let offset=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;if(offset+value.byteLength>expected)throw new Error('Collision payload exceeds its declared size.');output.set(value,offset);offset+=value.byteLength;}
    if(offset!==expected)throw new Error('Collision payload is truncated.');
    return output.buffer;
  }finally{void reader.cancel().catch(()=>{});}
}
export function levelFromBootstrap(id, b) {
  const camera = b.settings?.cameras?.[0]?.initial;
  if (!vector(camera?.position) || !vector(camera?.target)) throw new Error('Scene has no supported initial camera.');
  return {id, name: b.name || `SuperSplat ${id}`, subtitle: 'Imported public scene',
    author: b.author || 'See publisher for attribution and reuse rights',
    source: `https://superspl.at/scene/${id}`, contentUrl: publicAsset(b.contentUrl),
    collisionUrl: b.collisionUrl ? publicAsset(b.collisionUrl) : null,
    posterUrl: b.posterUrl ? publicAsset(b.posterUrl) : null,
    spawn: camera.position, target: camera.target, lods: 1};
}
async function readJson(url, fetcher) {
  const r = await fetcher(url, {signal: AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error(`Publisher returned HTTP ${r.status}.`);
  return r.json();
}
export function validateVoxelMeta(meta) {
  if (meta.version !== '1.1' || !Number.isSafeInteger(meta.nodeCount) || meta.nodeCount < 1 ||
    !Number.isSafeInteger(meta.leafDataCount) || meta.leafDataCount < 0 ||
    !Number.isFinite(meta.voxelResolution) || meta.voxelResolution <= 0 ||
    meta.leafSize !== 4 || !Number.isInteger(meta.treeDepth) || meta.treeDepth < 1 || meta.treeDepth > 24 ||
    !vector(meta.gridBounds?.min) || !vector(meta.gridBounds?.max) ||
    !meta.gridBounds.min.every((n,i) => n < meta.gridBounds.max[i]))
    throw new Error('Published voxel colliders have an unsupported format.');
  if ((meta.nodeCount + meta.leafDataCount) * 4 > 256 * 1024 * 1024)
    throw new Error('Voxel payload exceeds this prototype’s 256 MB limit.');
  return meta;
}
export async function inspectLevel(level, fetcher = fetch) {
  const lod = await readJson(publicAsset(level.contentUrl), fetcher);
  const streamed=Number.isInteger(lod.lodLevels)&&lod.lodLevels>=1&&lod.lodLevels<=32&&Array.isArray(lod.filenames);
  const sog=lod.version===2&&Number.isSafeInteger(lod.count)&&lod.count>0&&Array.isArray(lod.means?.files)&&Array.isArray(lod.sh0?.files);
  if(!streamed&&!sog)throw new Error('Unsupported scene format. This prototype supports streamed LOD and SOG v2 metadata scenes.');
  if(sog&&lod.count>10000000)throw new Error('Single-resolution scene exceeds this prototype’s 10-million-splat limit.');
  if(sog)validateSog(lod,level.contentUrl);
  if(streamed)for(const file of [...lod.filenames,...(lod.environment?[lod.environment]:[])]){
    if(typeof file!=='string'||!file)throw new Error('Invalid scene dependency.');sceneDependency(file,level.contentUrl);
  }
  let colliderStatus = 'No published voxel colliders · free-fly only';
  if (level.collisionUrl) {
    validateVoxelMeta(await readJson(publicAsset(level.collisionUrl), fetcher));
    colliderStatus = 'Voxel metadata verified · binary checked at launch';
  }
  return {...level, lods: streamed?lod.lodLevels:1,format:streamed?'lod':'sog',colliderStatus};
}
export async function importLevel(input, {catalog = [], resolver = '', fetcher = fetch} = {}) {
  const id = sceneId(input), known = catalog.find(l => l.id === id);
  if (known) return inspectLevel(known, fetcher);
  if (!resolver) throw new Error('Custom URL import needs a resolver. Configure its HTTPS URL below; the four featured scenes work without one.');
  const url = new URL(resolver, globalThis.location?.href ?? 'http://localhost/');
  if (url.protocol !== 'https:' && !(url.origin === globalThis.location?.origin)) throw new Error('Resolver must use HTTPS.');
  url.searchParams.set('url', `https://superspl.at/scene/${id}`);
  const b = await readJson(url.href, fetcher);
  return inspectLevel(levelFromBootstrap(id, b), fetcher);
}
