import './style.css';
import './bootstrap.css';
import {prepareMedia, cacheName} from './media-packs.js';
import {startLevelCache} from './level-cache.js';

const screen = document.getElementById('media-startup');
const status = document.getElementById('media-startup-status');
const progress = document.getElementById('media-startup-progress');
const retry = document.getElementById('media-startup-retry');
const clear = document.getElementById('media-startup-clear');
let busy = false, mediaReady = false;
async function start() {
  if (busy) return;
  busy = true; retry.hidden = true; clear.hidden = true;
  screen.setAttribute('aria-busy', 'true');
  status.textContent = 'Checking production media…';
  try {
    if (!mediaReady) {
      const summary = await prepareMedia({onProgress:p => {
        progress.value = p.loaded / p.total;
        const amount = `${(p.loaded / 1048576).toFixed(1)} / ${(p.total / 1048576).toFixed(1)} MiB`;
        status.textContent = p.phase === 'unpacking' ? `Preparing media · pack ${p.index}/${p.packs}` : `${p.cached ? 'Reading browser cache' : 'Loading media'} · ${amount}`;
      }});
      mediaReady = true;
      console.info('Production media ready', summary);
    }
    status.textContent = 'Starting the player…';
    await startLevelCache();
    await import('./main.js');
    screen.remove();
  } catch (error) {
    console.error('Startup failed', error);
    status.textContent = `${error.message} Reload this page if retry does not help.`;
    retry.hidden = false; clear.hidden = false;
  } finally { busy = false; screen.setAttribute('aria-busy', 'false'); }
}
retry.addEventListener('click', start);
clear.addEventListener('click', async () => {
  if (busy) return;
  try { await caches.delete(cacheName(new URL(import.meta.env.BASE_URL, document.baseURI).href)); } catch {}
  location.reload();
});
void start();
