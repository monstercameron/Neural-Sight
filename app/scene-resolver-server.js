// Server/Worker only. No scene code is evaluated and no geometry is fetched.
export const MAX_HTML_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 10000;

export class ResolverError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ResolverError'; this.status = status; }
}

export function sceneId(input) {
  if (typeof input !== 'string' || input.length > 2048 ||
      !/^https:\/\/superspl\.at\//i.test(input) || /[\s\\\x00-\x1f\x7f]/.test(input))
    throw new ResolverError('Use a public HTTPS superspl.at scene URL.');
  let u;
  try { u = new URL(input); } catch { throw new ResolverError('Invalid scene URL.'); }
  if (u.origin !== 'https://superspl.at' || u.username || u.password || u.hash)
    throw new ResolverError('Unsupported scene URL.');
  let id = u.pathname.match(/^\/scene\/([a-f0-9]{8})\/?$/i)?.[1];
  if (id && u.search) throw new ResolverError('Scene URLs must not contain extra parameters.');
  if (!id && u.pathname === '/s' && [...u.searchParams.keys()].length === 1 && u.searchParams.has('id'))
    id = u.searchParams.get('id');
  if (!/^[a-f0-9]{8}$/i.test(id ?? '')) throw new ResolverError('Invalid scene ID.');
  return id.toLowerCase();
}

export function publicMediaUrl(input) {
  if (typeof input !== 'string' || input.length > 4096 || /[\s\\\x00-\x1f\x7f]/.test(input) || /%(?:2e|2f|5c)/i.test(input))
    throw new ResolverError('Unsupported publisher media URL.', 502);
  let u;
  try { u = new URL(input); } catch { throw new ResolverError('Invalid publisher media URL.', 502); }
  const allowed = u.hostname === 'd28zzqy0iyovbz.cloudfront.net' ||
    (u.hostname === 's3-eu-west-1.amazonaws.com' && /^\/(?:splats|images)\.playcanvas\.com\/.+/.test(u.pathname));
  // Public, unsigned assets only; never return credentials or signed query tokens.
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || !allowed)
    throw new ResolverError('Unsupported publisher media URL.', 502);
  return u.href;
}

function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new ResolverError('Publisher settings are missing.', 502);
  const pending = [[settings, 0]];
  let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++nodes > 20000 || depth > 32) throw new ResolverError('Publisher settings are too complex.', 502);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new ResolverError('Invalid settings number.', 502);
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new ResolverError('Unsafe settings key.', 502);
        pending.push([value[key], depth + 1]);
      }
    }
  }
  return settings;
}

export function parseBootstrap(html, id) {
  if (!/^[a-f0-9]{8}$/.test(id) || typeof html !== 'string' || new TextEncoder().encode(html).length > MAX_HTML_BYTES)
    throw new ResolverError('Invalid or oversized publisher HTML.', 502);
  let payload;
  // Only a JSON script with the exact publisher ID. Comments and executable JS
  // are not bootstrap sources. Unknown publisher formats deliberately fail closed.
  for (const tag of html.matchAll(/<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (tag[1] === undefined) continue;
    const attrs = new Map();
    for (const attr of tag[1].matchAll(/(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      const key = attr[1].toLowerCase();
      if (attrs.has(key)) throw new ResolverError('Ambiguous publisher script attributes.', 502);
      attrs.set(key, attr[2] ?? attr[3] ?? attr[4]);
    }
    if (attrs.get('id') !== 'sse-bootstrap') continue;
    if (payload !== undefined || attrs.get('type')?.toLowerCase() !== 'application/json')
      throw new ResolverError('Ambiguous or unsupported publisher bootstrap.', 502);
    payload = tag[2];
  }
  let b;
  try { b = JSON.parse(payload); } catch { throw new ResolverError('Publisher JSON bootstrap was not found or is invalid.', 502); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ResolverError('Invalid publisher bootstrap.', 502);
  // Do not spread untrusted bootstrap keys into the response. Name is optional;
  // deliberately omit it rather than interpreting arbitrary HTML/title markup.
  return { id, contentUrl: publicMediaUrl(b.contentUrl),
    collisionUrl: b.collisionUrl == null ? null : publicMediaUrl(b.collisionUrl),
    posterUrl: b.posterUrl == null ? null : publicMediaUrl(b.posterUrl),
    settings: validateSettings(b.settings) };
}

export async function resolveScene(input, { fetcher = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const id = sceneId(input);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS)
    throw new ResolverError('Invalid resolver timeout.', 500);
  const controller = new AbortController();
  let reader, timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ResolverError('Publisher request timed out.', 504));
    }, timeoutMs);
  });
  const request = async () => {
    // Never fetch the supplied URL, forward client headers, or follow redirects.
    const response = await fetcher(`https://superspl.at/s?id=${id}`, {
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: { Accept: 'text/html' }, signal: controller.signal
    });
    if (response.redirected || response.status >= 300 && response.status < 400)
      throw new ResolverError('Publisher redirects are not supported.', 502);
    if (!response.ok) throw new ResolverError('Publisher scene is unavailable.', response.status === 404 ? 404 : 502);
    if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? ''))
      throw new ResolverError('Publisher did not return HTML.', 502);
    if (Number(response.headers.get('content-length')) > MAX_HTML_BYTES)
      throw new ResolverError('Publisher HTML exceeds 1 MiB.', 502);
    if (!response.body) throw new ResolverError('Publisher HTML is empty.', 502);
    reader = response.body.getReader();
    let total = 0, html = '';
    const decoder = new TextDecoder('utf-8', {fatal: true});
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) throw new ResolverError('Publisher HTML exceeds 1 MiB.', 502);
      html += decoder.decode(value, {stream: true});
    }
    html += decoder.decode();
    return parseBootstrap(html, id);
  };
  try { return await Promise.race([request(), deadline]); }
  catch (error) {
    if (error instanceof ResolverError) throw error;
    throw new ResolverError('Publisher request or bootstrap failed.', 502);
  } finally {
    clearTimeout(timer);
    controller.abort();
    // Do not allow a stalled stream cancellation to defeat the deadline.
    if (reader) void reader.cancel().catch(() => {});
  }
}

function requestInput(url) {
  const params = new URL(url).searchParams;
  if ([...params.keys()].length !== 1 || !params.has('url')) throw new ResolverError('Supply exactly one url parameter.');
  return params.get('url');
}

export async function handleResolverRequest(request, options = {}) {
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  try {
    if (request.method !== 'GET') return new Response(JSON.stringify({error:'Only GET is supported.'}), {status:405, headers:{...headers, Allow:'GET'}});
    const result = await resolveScene(requestInput(request.url), options);
    return new Response(JSON.stringify(result), {headers});
  } catch (error) {
    const safe = error instanceof ResolverError ? error : new ResolverError('Resolver failed.', 500);
    return new Response(JSON.stringify({error:safe.message}), {status:safe.status, headers});
  }
}

// Parent may mount this with server.middlewares.use(createSceneResolverMiddleware()).
// Same-origin dev only; production CORS belongs to the Worker below.
export function createSceneResolverMiddleware({path = '/api/scene-resolver', ...options} = {}) {
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://resolver.local');
    if (url.pathname !== path) return next();
    const response = await handleResolverRequest({method:req.method, url:url.href}, options);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
}
