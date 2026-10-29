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
 await run('naver-browser-replace.mjs');assert.equal(calls.length,2);assert(calls[1].url.endsWith('/actions/runs/8/force-cancel'));assert.equal(calls[1].options.method,'POST');
 calls.length=0;await run('naver-browser-handoff.mjs');assert.equal(calls.length,1);assert(calls[0].url.endsWith('/actions/workflows/naver-browser-server.yml/dispatches'));assert.deepEqual(JSON.parse(calls[0].options.body),{ref:'main'});
}finally{globalThis.fetch=originalFetch;for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
console.log('Worker replacement excludes current/completed/other-branch runs; continuation only dispatches the same main workflow');

const {upgradeCaptureContract}=await import('../scripts/lib/naver-capture-contract.mjs');
const captureSql=await readFile(new URL('../repo-root/sql/naver-course-captures.sql',import.meta.url),'utf8');
const oldSaved="where e.value->>'imagePath' is not null";
const expectedDefinition=captureSql.slice(captureSql.indexOf('create or replace function'),captureSql.indexOf('revoke all'));
const checkpointRule=oldSaved+" or (e.value->'optimization'->>'version'='1' and e.value->'optimization'->>'policy' in ('naver-all-driving-options-v1','naver-all-driving-options-meters-v2'))";
const oldDefinition=expectedDefinition.replace(checkpointRule,oldSaved).replace("where saved->(value->>'id')->>'imagePath' is null","where not(saved ? (value->>'id'))");
assert.notEqual(oldDefinition,expectedDefinition,'Exercise the deployed pre-checkpoint retry contract');
const upgraded=upgradeCaptureContract(oldDefinition);
assert.equal(upgraded,expectedDefinition);
assert(upgraded.includes(checkpointRule),'Retries retain both display-distance and exact-meter checkpoints as well as completed images');
assert.equal(upgradeCaptureContract(expectedDefinition.replace(" in ('naver-all-driving-options-v1','naver-all-driving-options-meters-v2')","='naver-all-driving-options-v1'")),expectedDefinition,'Upgrade the currently deployed v1 retry policy without dropping other validation');
assert.equal(upgradeCaptureContract(upgraded),upgraded,'Queue upgrade is idempotent');
assert(upgraded.includes("where not(saved ? (value->>'id'))")===false,'A checkpoint must not count as a completed image');
