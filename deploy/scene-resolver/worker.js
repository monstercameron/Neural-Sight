import {handleResolverRequest} from '../../app/scene-resolver-server.js';

// One exact app origin (scheme + hostname + optional port), never '*' or 'null'.
export function allowedOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export async function workerFetch(request, env = {}, options = {}) {
  const allowed = allowedOrigin(env.ALLOWED_APP_ORIGIN);
  const origin = request.headers.get('Origin');
  const headers = new Headers({'Cache-Control':'no-store', 'Vary':'Origin', 'X-Content-Type-Options':'nosniff'});
  if (!allowed) return new Response('Resolver origin is not configured.', {status:503, headers});
  // No-Origin requests support CLI diagnostics. CORS is not authentication or
  // rate limiting; a non-browser client can spoof Origin.
  if (origin !== null && origin !== allowed) return new Response('Origin is not allowed.', {status:403, headers});
  if (origin === allowed) headers.set('Access-Control-Allow-Origin', allowed);
  if (request.method === 'OPTIONS') {
    if (request.headers.get('Access-Control-Request-Method') !== 'GET' || request.headers.get('Access-Control-Request-Headers'))
      return new Response('Unsupported preflight.', {status:403, headers});
    headers.set('Access-Control-Allow-Methods', 'GET');
    return new Response(null, {status:204, headers});
  }
  const response = await handleResolverRequest(request, options);
  response.headers.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {status:response.status, headers});
}

export default {fetch: (request, env) => workerFetch(request, env)};
