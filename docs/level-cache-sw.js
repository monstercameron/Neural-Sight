import {LevelCache, publisherLevelId} from './level-cache-core.js';
const store = new LevelCache({storage:caches, scope:self.registration.scope});
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && publisherLevelId(event.request.url))
    event.respondWith(store.read(event.request, task => event.waitUntil(task)));
});
self.addEventListener('message', event => {
  const port = event.ports?.[0]; if (!port) return;
  event.waitUntil((async () => {
    try {
      const client = event.source;
      if (!client?.url?.startsWith(self.registration.scope)) throw Error('Client outside level-cache scope');
      const {action, id} = event.data ?? {};
      let result;
      if (action === 'level-cache:stats') result = await store.stats();
      else if (action === 'level-cache:purge') result = await store.purge(id);
      else if (action === 'level-cache:resume') { await store.resume(id); result = {id}; }
      else throw Error('Unsupported cache operation');
      port.postMessage({ok:true, result});
    } catch (error) { port.postMessage({ok:false, error:error.message}); }
  })());
});
