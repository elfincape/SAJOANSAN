import assert from 'node:assert/strict';
import fs from 'node:fs';
const requests=[];
let response;
globalThis.__charterClient={
 from(){return {select(){return this;},eq(){return this;},async in(key,ids){
 const length=ids.reduce((n,id)=>n+encodeURIComponent(id).length+6,0);
 assert.ok(length<=4000,'Version lookup URL must remain bounded');
 requests.push(ids);return {data:ids.map(id=>({id,version:1})),error:null};
 }};},
 async rpc(name,args){return response||{data:args.p_rows.map(r=>({id:r.payload.id,version:r.expectedVersion+1})),error:null};}
};
const source=fs.readFileSync(new URL('../repo-root/js/pyeongtaek-charter-db.js',import.meta.url),'utf8').replace("import { supabase } from './supabase.js';","const supabase=globalThis.__charterClient;");
const {existingVersions,saveCharterTrips}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ids=Array.from({length:250},(_,i)=>'charter|002|2026-10-08|'+encodeURIComponent('평택 용차 거래처 고정호차 '.repeat(3))+i);
const versions=await existingVersions('002',ids);
assert.equal(versions.size,250);assert.ok(requests.length>3);assert.deepEqual(requests.flat(),ids);
assert.deepEqual(await saveCharterTrips('002',[{id:ids[0]}],versions),[{id:ids[0],version:2}]);
response={data:[],error:null};await assert.rejects(()=>saveCharterTrips('002',[{id:'trip'}],new Map()),/응답/);
response={data:null,error:{message:'저장 권한이 없습니다.'}};await assert.rejects(()=>saveCharterTrips('002',[{id:'trip'}],new Map()),/저장 권한/);
delete globalThis.__charterClient;
console.log('PASS: bounded long-ID version lookups, valid save results, empty-result rejection and DB failure propagation');
