let boot;
let unavailable;
export function startLevelCache() {
  return boot ??= (async () => {
    try {
      if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) throw Error('This browser cannot cache levels here; use HTTPS or localhost.');
      const base = new URL(import.meta.env?.BASE_URL ?? './', document.baseURI);
      const registration = await navigator.serviceWorker.register(new URL('level-cache-sw.js', base), {type:'module', scope:base.pathname, updateViaCache:'none'});
      await new Promise((resolve,reject) => {
        const check = () => { if (navigator.serviceWorker.controller?.scriptURL === new URL('level-cache-sw.js', base).href) { cleanup(); resolve(); } };
        const timer = setTimeout(() => { cleanup(); reject(Error('Level cache startup timed out; streaming still works.')); }, 10000);
        const cleanup = () => {clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',check);};
        navigator.serviceWorker.addEventListener('controllerchange', check); check();
      });
      return registration;
    } catch (error) { unavailable = error.message; return null; }
  })();
}
export async function levelCacheCommand(action, id) {
  if (!await startLevelCache()) throw Error(unavailable || 'Level caching unavailable');
  return new Promise((resolve,reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(Error('Level cache did not respond. Reload and retry.')); }, 15000);
    channel.port1.onmessage = ({data}) => {clearTimeout(timer);channel.port1.close();data.ok ? resolve(data.result) : reject(Error(data.error));};
    navigator.serviceWorker.controller.postMessage({action:`level-cache:${action}`,id},[channel.port2]);
  });
}
export async function resumeLevelCache(id) {
  try { await levelCacheCommand('resume',id); }
  catch (error) { console.warn('Level caching unavailable:',error.message); }
}
