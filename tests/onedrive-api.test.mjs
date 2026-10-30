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
{
 const client=fs.readFileSync(new URL('../app/src/lib/onedrive.ts',import.meta.url),'utf8');
 const finish='async function finishOneDrive()'+client.split('export async function finishOneDrive()')[1];
 const calls=[],navigation=[],storage=new Map();let rejectFinish=false;
 const browser=vm.createContext({URLSearchParams,JSON,Error,String,location:{search:'?onedrive_state=state',replace:path=>navigation.push(['navigate',path])},history:{replaceState:(_state,_title,path)=>navigation.push(['history',path])},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},oneDriveCall:async(action,body)=>{calls.push({action,body});if(rejectFinish)throw Error('temporary');}});
 vm.runInContext(finish+';globalThis.finish=finishOneDrive;',browser);
 const save=(purpose,returnPath)=>storage.set('onedrive-proof',JSON.stringify({state:'state',proof:'proof',purpose,returnPath}));
 save('mail-briefing','/admin/mail-daily-briefing.html?day=2026-10-30');
 assert.equal(await browser.finish(),true);
 assert.equal(calls[0].action,'notes-finish');assert.equal(storage.has('onedrive-proof'),false);
 assert.deepEqual(navigation.pop(),['navigate','/admin/mail-daily-briefing.html?day=2026-10-30'],'Notes callback reloads the daily page instead of leaving Portal mounted under a driver URL');
 save('mail-briefing','https://outside.example/');await browser.finish();assert.deepEqual(navigation.pop(),['history','/portal/?view=mail']);
 save(undefined,'/admin/drivers.html');await browser.finish();assert.equal(calls.at(-1).action,'finish');assert.deepEqual(navigation.pop(),['history','/admin/drivers.html']);
 save('mail-briefing','/admin/mail-daily-briefing.html');rejectFinish=true;await assert.rejects(browser.finish(),/temporary/);assert.equal(storage.has('onedrive-proof'),true);assert.equal(navigation.length,0);
 console.log('PASS Notes callback returns to daily page, keeps file callback behavior, rejects external destinations and retains failed proof');
}

