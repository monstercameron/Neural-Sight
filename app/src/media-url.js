// Relative assets also work when GitHub Pages hosts the demo under /repo-name/.
let packed = null;
export function installMediaUrls(urls) { packed = urls; }
export function mediaUrl(url, base = import.meta.env?.BASE_URL ?? '/') {
  if (packed && url.startsWith('/media/')) {
    const resolved = packed.get(url.slice('/media/'.length));
    if (!resolved) throw Error(`Asset absent from production packs: ${url}`);
    return resolved;
  }
  return url.startsWith('/media/') ? `${base}${url.slice(1)}` : url;
}
