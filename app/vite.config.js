import { defineConfig } from "vite";
import { createReadStream } from "node:fs";
import { stat, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {reviewCaptureMiddleware} from './review-capture-server.js';
import {createSceneResolverMiddleware} from './scene-resolver-server.js';

const root = fileURLToPath(new URL("../", import.meta.url));
const cacheWorkerFiles=['level-cache-sw.js','level-cache-core.js'];
function cacheWorker(req,res,next){
  const name=req.url.split('?')[0].slice(1);
  if(!cacheWorkerFiles.includes(name))return next();
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  readFile(path.join(root,'app/src',name)).then(bytes=>{res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);}).catch(()=>res.writeHead(404).end());
}
const mounts = {
  characters: path.join(root, "docs/media/characters"),
  poses: path.join(root, "docs/media/poses"),
  clips: path.join(root, "docs/media/clips"),
  playback: path.join(root, "docs/media/playback"),
  audio: path.join(root, "docs/media/audio"),
  review: path.join(root, "work/recordings"),
  packs: path.join(root, 'docs/packs'),
};
const types = {
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".bin": "application/octet-stream",
  ".glb": "model/gltf-binary",
  '.zip': 'application/zip',
};
function media(req, res, next) {
  try {
    const parts = decodeURIComponent(req.url.split('?')[0]).split('/');
    if (parts.some(part => part === '.env' || part.startsWith('.env.'))) {
      res.writeHead(403).end(); return;
    }
  } catch { res.writeHead(400).end(); return; }
  if (!req.url.startsWith('/media/') && !req.url.startsWith('/packs/')) return next();
  (async () => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    const parts = decodeURIComponent(req.url.split("?")[0].replace(/^\/packs\//, '/media/packs/')).split("/");
    const base = mounts[parts[2]];
    if (!base || parts.slice(3).some((p) => p === ".." || p.startsWith("."))) {
      res.writeHead(403).end();
      return;
    }
    const file = await realpath(path.resolve(base, ...parts.slice(3)));
    const type = types[path.extname(file)];
    if (!file.startsWith(base + path.sep) || !type) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) {
      res.writeHead(404).end();
      return;
    }
    let start = 0,
      end = info.size - 1,
      status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= info.size) {
        res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
        return;
      }
      status = 206;
    }
    const headers = {
      "Content-Type": type,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    };
    if (status === 206)
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    res.writeHead(status, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  })().catch(() => {
    if (!res.headersSent) res.writeHead(404).end();
    else res.destroy();
  });
}
export default defineConfig(({mode})=>({
  base: './',
  plugins: [
    {
      name:'pages-notices',
      async generateBundle(){
        for(const name of cacheWorkerFiles)this.emitFile({type:'asset',fileName:name,source:await readFile(path.join(root,'app/src',name),'utf8')});
        this.emitFile({type:'asset',fileName:'.nojekyll',source:''});
        this.emitFile({type:'asset',fileName:'PLAYCANVAS-LICENSE.txt',source:await readFile(path.join(root,'app/node_modules/playcanvas/LICENSE'),'utf8')});
        this.emitFile({type:'asset',fileName:'FFLATE-LICENSE.txt',source:await readFile(path.join(root,'app/node_modules/fflate/LICENSE'),'utf8')});
        this.emitFile({type:'asset',fileName:'ASSET-NOTICES.md',source:await readFile(path.join(root,'project-notes/ASSET-NOTICES.md'),'utf8')});
      },
    },
    {
      name: "local-media-only",
      configureServer(s) {
        s.middlewares.use(cacheWorker);
        s.middlewares.use(createSceneResolverMiddleware({path:'/api/scene'}));
        s.middlewares.use(reviewCaptureMiddleware(mounts.review));
        s.middlewares.use(media);
      },
      configurePreviewServer(s) {
        s.middlewares.use(cacheWorker);
        s.middlewares.use(media);
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    fs: { strict: true },
  },
  // Build into ignored dist first. The publisher never empties docs/media.
  build: { target: "esnext", rolldownOptions:{input:{demo:path.join(root,'app/index.html'),experiment:path.join(root,'app/experiment.html')}}, outDir:'dist',emptyOutDir:true },
}));
