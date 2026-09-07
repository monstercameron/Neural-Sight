import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

export function reviewCaptureMiddleware(directory){
  return async(req,res,next)=>{
    if(req.url!=='/__review/capture')return next();
    const host=req.headers.host,origin=req.headers.origin;
    if(req.method!=='POST'||req.headers['x-neural-sight-review']!=='1'||origin!==`http://${host}`||!/^127\.0\.0\.1:\d+$/.test(host??'')||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.writeHead(403).end();
    if(req.headers['content-type']!=='video/webm')return res.writeHead(415).end();
    const limit=64*1024*1024,parts=[];let size=0;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>limit){res.writeHead(413).end();return;}parts.push(chunk);}
      const bytes=Buffer.concat(parts);
      if(bytes.length<4||bytes.readUInt32BE(0)!==0x1a45dfa3)return res.writeHead(415).end();
      let metadata={};try{metadata=JSON.parse(req.headers['x-review-metadata']??'{}');}catch{return res.writeHead(400).end();}
      if(!metadata||Array.isArray(metadata)||typeof metadata!=='object')return res.writeHead(400).end();
      const name=`encounter-${Date.now()}-${randomUUID()}`;
      await mkdir(directory,{recursive:true});
      await writeFile(path.join(directory,name+'.webm'),bytes,{flag:'wx'});
      await writeFile(path.join(directory,name+'.json'),JSON.stringify({recordedAt:new Date().toISOString(),bytes:size,metadata},null,2),{flag:'wx'});
      res.writeHead(201,{'Content-Type':'application/json'}).end(JSON.stringify({video:`/media/review/${name}.webm`,metadata:`/media/review/${name}.json`,name}));
    }catch(error){if(!res.headersSent)res.writeHead(500).end('Capture could not be saved');else res.end();}
  };
}
