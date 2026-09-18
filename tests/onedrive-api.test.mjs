import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../repo-root/js/onedrive-api.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
let responses=[409,502,200],requests=[];
const ctx=vm.createContext({FormData,Blob,File,AbortSignal,URL,JSON,Error,Promise,setTimeout:fn=>fn(),SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public',supabase:{auth:{getSession:async()=>({data:{session:{access_token:'session'}}})}},fetch:async(url,options)=>{requests.push(options.body);const status=responses.shift();return new Response(JSON.stringify(status===200?{saved:true}:{error:'temporary'}),{status});}});
vm.runInContext(source+'\nglobalThis.api=oneDriveDocuments;',ctx);
const input={driverId:'driver',kind:'food_transport_back',file:new File(['photo'],'photo.jpg',{type:'image/jpeg'}),requestId:'request'};
assert.equal((await ctx.api.upload(input)).saved,true);
assert.equal(requests.length,3);
assert(requests.every(body=>body.get('requestId')==='request'&&body.get('kind')==='food_transport_back'));
responses=[403];requests=[];
await assert.rejects(ctx.api.upload(input),error=>error.status===403);
assert.equal(requests.length,1,'permission errors must not retry');
console.log('Automatic transient retries preserve request identity and do not retry forbidden requests');

