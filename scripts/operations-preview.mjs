// Local static preview only. No credentials, mutations or production proxy.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../repo-root/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
http.createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1'),name=decodeURIComponent(url.pathname);const file=path.resolve(root,'.'+(name.endsWith('/')?name+'index.html':name));if(!file.startsWith(root))throw Error('Outside preview root');
 let content=await readFile(file);if(name==='/js/config.js')content=Buffer.from(content.toString().replace("? 'dev' : 'staging'","? 'staging' : 'staging'"));
 // The source config remains unchanged. This page is served without an auth bypass.
 res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(content);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(8765,'127.0.0.1',()=>console.log('Local operations preview: http://127.0.0.1:8765/admin/operations.html'));
