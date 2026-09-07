// Shared service-worker logic and offline tests. Publisher URLs remain intact
// so nested SOG/LOD dependencies and PlayCanvas XHR/image loaders keep working.
export function publisherLevelId(input) {
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || /%|\\/.test(u.pathname)) return null;
    const prefix = u.hostname === 'd28zzqy0iyovbz.cloudfront.net' ? '' :
      u.hostname === 's3-eu-west-1.amazonaws.com' ? '(?:splats\\.playcanvas\\.com|images\\.playcanvas\\.com/splat)/' : null;
    if (prefix === null) return null;
    return u.pathname.match(new RegExp(`^/${prefix}([a-f0-9]{8})/v[0-9]+/[^/].+$`, 'i'))?.[1].toLowerCase() ?? null;
  } catch { return null; }
}
const validId = id => { if (!/^[a-f0-9]{8}$/.test(id)) throw Error('Invalid level cache ID'); return id; };
export class LevelCache {
  constructor({storage, scope, fetcher = (...args) => fetch(...args)}) {
    this.storage = storage; this.scope = scope; this.fetcher = fetcher;
    this.prefix = `neural-sight-levels-v1:${scope}:`;
    this.epochs = new Map(); this.paused = new Set(); this.locks = new Map(); this.errors = new Map();
    this.hits=0;this.downloads=0;
    this.ready = this.restore();
  }
  name(id) { return this.prefix + validId(id); }
  async restore() {
    try {
      this.control = await this.storage.open(this.prefix + 'control');
      for (const request of await this.control.keys()) {
        const id = new URL(request.url).pathname.split('/').pop();
        if (/^[a-f0-9]{8}$/.test(id) && (await (await this.control.match(request)).json()).paused) this.paused.add(id);
      }
    } catch { this.unavailable = true; }
  }
  mutate(id, fn) {
    const task = (this.locks.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.locks.set(id, task);
    void task.finally(() => { if (this.locks.get(id) === task) this.locks.delete(id); }).catch(() => {});
    return task;
  }
  async pauseRecord(id, paused) {
    if (!this.control) throw Error('Browser storage unavailable');
    await this.control.put(new URL(`__level-cache__/${id}`, this.scope).href, Response.json({paused}));
  }
  async purge(id) {
    validId(id); await this.ready;
    this.paused.add(id); this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    // Delete the named cache immediately, even if an old Cache object is still
    // draining a response body. That detached object cannot recreate its name.
    // Epoch checks reject delayed writes; paused reads cannot reopen the cache.
    await this.mutate(id, async () => {
      await this.storage.delete(this.name(id));
      await this.pauseRecord(id, true);
    });
    this.errors.delete(id);
    return {id, purged:true, paused:true};
  }
  async resume(id) {
    validId(id); await this.ready;
    await this.mutate(id, async () => {
      await this.pauseRecord(id, false); this.paused.delete(id); this.errors.delete(id);
    });
  }
  async read(request, keepAlive = () => {}) {
    const id = publisherLevelId(request.url);
    if (!id || request.method !== 'GET' || request.headers.has('range')) return this.fetcher(request);
    await this.ready;
    const epoch = this.epochs.get(id) ?? 0;
    let cache;
    if (!this.unavailable && !this.paused.has(id)) {
      try {
        cache = await this.storage.open(this.name(id));
        const cached = await cache.match(request.url);
        if (cached?.status === 200 && !cached.redirected && cached.type !== 'opaque') {this.hits++;return cached;}
      } catch { this.errors.set(id, 'Browser storage unavailable; downloads are not retained.'); }
    }
    // Own persistence explicitly; a purge must not resurrect the same bytes
    // from the HTTP cache on the next load. Never cache partial/failed responses.
    this.downloads++;
    const response = await this.fetcher(request, {cache:'no-store'});
    if (cache && response.status === 200 && !response.redirected && response.type !== 'opaque') {
      const copy = response.clone();
      const write = (async () => {
        if (this.paused.has(id) || (this.epochs.get(id) ?? 0) !== epoch) { await copy.body?.cancel(); return; }
        try { await cache.put(request.url, copy); }
        catch { this.errors.set(id, 'Storage full or blocked; some downloaded assets could not be saved.'); }
      })();
      keepAlive(write.catch(() => {}));
    }
    return response;
  }
  async stats() {
    await this.ready;
    const result = {};
    for (const name of await this.storage.keys()) {
      if (!name.startsWith(this.prefix)) continue;
      const id = name.slice(this.prefix.length); if (!/^[a-f0-9]{8}$/.test(id)) continue;
      const cache = await this.storage.open(name), requests = await cache.keys();
      let bytes = 0, unknown = 0;
      for (const request of requests) {
        const size = (await cache.match(request))?.headers.get('content-length');
        if (size !== null && size !== undefined && /^\d+$/.test(size)) bytes += Number(size); else unknown++;
      }
      result[id] = {files:requests.length, bytes, unknown, paused:this.paused.has(id), error:this.errors.get(id)};
    }
    for (const id of new Set([...this.paused, ...this.errors.keys()]))
      result[id] ??= {files:0,bytes:0,unknown:0,paused:this.paused.has(id),error:this.errors.get(id)};
    return {available:!this.unavailable, levels:result,hits:this.hits,downloads:this.downloads};
  }
}
