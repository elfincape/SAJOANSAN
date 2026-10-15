import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const originalFetch=globalThis.fetch,names=['GITHUB_REPOSITORY','GITHUB_RUN_ID','GH_TOKEN'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]])),calls=[];
try{
 Object.assign(process.env,{GITHUB_REPOSITORY:'example/repo',GITHUB_RUN_ID:'9',GH_TOKEN:'test-only'});
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer test-only');
  if(url.endsWith('/runs?per_page=30'))return {ok:true,json:async()=>({workflow_runs:[{id:9,head_branch:'main',status:'in_progress'},{id:8,head_branch:'main',status:'in_progress'},{id:7,head_branch:'main',status:'completed'},{id:6,head_branch:'feature',status:'queued'}]})};
  return {ok:true,status:204};
 };
 const run=async file=>import('data:text/javascript,'+encodeURIComponent(await readFile(new URL('../scripts/'+file,import.meta.url),'utf8')));
 await run('naver-browser-replace.mjs');assert.equal(calls.length,2);assert(calls[1].url.endsWith('/actions/runs/8/cancel'));assert.equal(calls[1].options.method,'POST');
 calls.length=0;await run('naver-browser-handoff.mjs');assert.equal(calls.length,1);assert(calls[0].url.endsWith('/actions/workflows/naver-browser-server.yml/dispatches'));assert.deepEqual(JSON.parse(calls[0].options.body),{ref:'main'});
}finally{globalThis.fetch=originalFetch;for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
console.log('Worker replacement excludes current/completed/other-branch runs; continuation only dispatches the same main workflow');
