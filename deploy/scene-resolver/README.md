# Public SuperSplat bootstrap resolver (not deployed)

This optional sidecar resolves publisher HTML that the browser cannot read with
CORS. GitHub Pages serves static files; it cannot run this resolver. Pages builds
must point their custom-scene loader at a separately deployed HTTPS Worker.
The built-in direct asset catalog does not require this service.

## Contract

`GET /?url=https%3A%2F%2Fsuperspl.at%2Fscene%2Ffb3b5ed5`

Also accepts `https://superspl.at/s?id=fb3b5ed5` as the parameter value.
Only these paths with an eight-hex ID are accepted; extra query parameters,
credentials, fragments, alternate hosts and schemes are rejected.

Success JSON: `{id, contentUrl, collisionUrl, posterUrl, settings}`. Missing
collision/poster URLs are `null`; `name` is optional in the consumer contract and
is deliberately omitted here. Use a fallback title and render all publisher data
as text, never HTML. Errors are `{error}` with HTTP 400/404/405/502/504; unexpected
internal errors use 500. Unconfigured Worker origin returns 503; forbidden CORS
origins/preflights return 403. Worker CORS errors are plain text.

The shared implementation is `../../app/scene-resolver-server.js`. Both the Worker
and Vite adapter call the same parser and bounded fetch:

```js
import {createSceneResolverMiddleware} from './scene-resolver-server.js';
// Inside the parent's Vite plugin configureServer hook:
server.middlewares.use(createSceneResolverMiddleware({path:'/api/scene'}));
// This is installed by app/vite.config.js during npm run dev.
```

Direct server use: `resolveScene(url, {fetcher, timeoutMs})`; dependencies are
optional, and timeout overrides may only shorten the 10-second limit. No Node
APIs are imported, so the same resolver runs in a Worker. Local development uses
`/api/scene`; static Pages has no middleware and labels URL import local-only.
Self-hosters can set public `VITE_SCENE_RESOLVER_URL` when building Pages to enable
the importer with their deployed resolver. There is no end-user resolver field.

## Boundaries and deployment preparation

- Fetches exactly one canonical `https://superspl.at/s?id=<id>` HTML document.
  No request cookies/auth forwarded, redirect following disabled, 10-second
  total deadline, maximum 1 MiB decoded response bytes (also streamed without
  Content-Length). Parses only `application/json` script `sse-bootstrap` with
  `JSON.parse`; never evaluates scripts. Format changes fail closed.
- Returned media allowlist: exact `d28zzqy0iyovbz.cloudfront.net`, or exact
  `s3-eu-west-1.amazonaws.com` within `splats.playcanvas.com/` and
  `images.playcanvas.com/` buckets. HTTPS only, no URL credentials, query tokens
  or fragments. Additional publisher hosts/formats require an explicit update.
- Does not fetch media, collision metadata, voxel binaries, nested LOD manifests
  or textures. `collisionUrl` means a published reference, **not validated usable
  collision**. The browser must check metadata, adjacent binary length/format,
  asset CORS, nested references and failures. The resolver is not an asset proxy.
- `settings` is bounded JSON data, not instructions to enable publisher effects
  or fetch arbitrary URLs. The consumer should use only supported settings fields.
- Set `ALLOWED_APP_ORIGIN` in `wrangler.toml` to the exact HTTPS origin. Empty
  configuration fails closed. No wildcard, credentials, or origin reflection.
  OPTIONS permits GET without custom headers. No-Origin CLI requests are allowed;
  CORS is not authorization. Add platform rate limits/quotas before public use;
  each request otherwise causes one publisher request. Responses are no-store.
- No deployment or account changes have been performed. From this directory a
  future operator can use Wrangler with this config after reviewing origin,
  quotas and publisher terms. No credential belongs in this repository.
- Public visibility does not grant redistribution rights. Preserve publisher
  attribution and license information in the parent UI; no geometry is bundled.

## Tests (offline)

From repository root:
`node --test deploy/scene-resolver/scene-resolver.test.js`

Tests exercise shared parsing, the fixed outbound URL, streamed size/deadline
limits, denied redirects/hosts/credentials, Worker CORS and the Vite adapter.
No tests fetch geometry or require a deployment.
