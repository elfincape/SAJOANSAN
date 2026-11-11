import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edge = readFileSync(new URL('../supabase/functions/operations-assistant/index.ts', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../supabase/functions/operations-assistant/tools.ts', import.meta.url), 'utf8');
const resultPlan = readFileSync(new URL('../supabase/functions/operations-assistant/result-plan.js', import.meta.url), 'utf8');

assert.match(edge, /authorization:`Bearer \$\{token\}`/);
assert.match(edge, /user_center_access/);
assert.match(edge, /center_code=eq\.\$\{center\}/);
assert.match(edge, /if\(access&&!access\.length\)return fail\('FORBIDDEN'/);
assert.doesNotMatch(edge, /SERVICE_ROLE/i);
assert.doesNotMatch(edge, /\.(?:insert|update|upsert|delete)\(|\/rpc\//i);
assert.match(edge, /buildOperationsSnapshot/);
assert.match(edge, /answerFromSnapshot/);
assert.match(edge, /safeRestVariants/);
assert.match(edge, /safeStops/);
assert.doesNotMatch(edge, /fallback:'empty'/, 'query failures must not masquerade as an empty catalog');
assert.match(edge, /현재 센터 운영 DB 스냅샷만 근거/);
assert.doesNotMatch(edge, /search_course_rows|search_delivery_points|search_drivers|search_vehicles|list_routes/);
assert.match(tools, /OPERATIONS_QUERY_SCHEMA/);
assert.doesNotMatch(tools, /Math\.min\(100,/);
assert.match(edge, /async function restAll/);
assert.match(edge, /Range:`\$\{from\}-\$\{from\+REST_PAGE_SIZE-1\}`/);
assert.doesNotMatch(edge, /rows\.slice\(0,100\)/);
assert.doesNotMatch(edge, /결과 행은 최대 100개/);
assert.match(edge, /목록이나 표를 요청하면 rows를 직접 나열하지 말고/);
assert.match(edge, /import \{expandResultPlan\} from '\.\/result-plan\.js'/);
assert.match(resultPlan, /rows:rows\.map\(row=>Object\.fromEntries/);
assert.match(edge, /truncated:false/);
assert.match(tools, /확인할 수 없는 컬럼/);

console.log('operations assistant security invariants: ok');

assert.match(edge, /loadErpOperationsInputs/, 'ERP-enabled assistant must read the authenticated catalog rather than old masters');
const {loadErpOperationsInputs}=await import('../supabase/functions/operations-assistant/erp-catalog.js');
const cfg={catalogUrl:'https://erp.example.invalid/',catalogCenterMap:JSON.stringify({'001':'all'})};
const calls=[];
const workspace={route:{id:'r',fields:{name:'route',stops:[{id:'s',delivery_point_id:'p',stop_order:1}]}},masters:{p:{fields:{name:'point',address:'shared',delivery_method:'parent'}}},effective:{s:{delivery_method:{mode:'clear',value:null},deadline:{mode:'clear',value:null},access_method:{mode:'set',value:''}}}};
const transport=async(url,options)=>{
 assert.equal(options.headers.Authorization,'Bearer caller-token');calls.push(url.toString());
 const kind=url.searchParams.get('kind');
 return Response.json({items:kind==='route'?[workspace]:kind==='delivery_point'?[{id:'p',fields:{name:'point'}}]:[],nextAfter:null});
};
const input=await loadErpOperationsInputs(cfg,'caller-token','001',transport);
assert.equal(calls.length,5);assert.equal(input.courseRowsRaw[0].delivery_method,null);assert.equal(input.courseRowsRaw[0].access_method,'');assert.equal(input.courseRowsRaw[0].effective_deadline_business_min,null);
assert.ok(calls.every(url=>!new URL(url).searchParams.has('center')));
await assert.rejects(loadErpOperationsInputs(cfg,'caller-token','001',async()=>new Response('',{status:403})),e=>e.status===403);
await assert.rejects(loadErpOperationsInputs({...cfg,catalogCenterMap:'{}'},'caller-token','001',async()=>{throw Error('must not query');}),/CATALOG_SELECTOR_NOT_CONFIGURED/);
let pages=0;
await assert.rejects(loadErpOperationsInputs(cfg,'caller-token','001',async()=>{pages++;return Response.json({items:[],nextAfter:'repeated'});}),/CATALOG_CURSOR_REPEATED/);
assert.ok(pages<=10);
console.log('ERP assistant: caller-token, clear/empty, missing selector, errors and cursor checks passed');

assert.equal(input.catalogScope,'요청자에게 허용된 전체 공통 원장');
// Exercise the frontend client without credentials, including explicit all/unclassified mappings.

const {stripTypeScriptTypes}=await import('node:module');
const clientSource=readFileSync(new URL('../app/src/lib/erp-course-catalog.ts',import.meta.url),'utf8');
async function clientFor(mapping){
 const source=clientSource.replace("import { supabase } from './supabase';", "const supabase={auth:{getSession:async()=>({data:{session:{access_token:'own-session'}}})}};")
 .replaceAll('import.meta.env',JSON.stringify({VITE_ERP_COURSE_CATALOG:'true',VITE_ERP_COURSE_CENTER_MAP:JSON.stringify(mapping)}));
 return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
}
const originalFetch=globalThis.fetch;
try{
 let urls=[];globalThis.fetch=async(url,options)=>{urls.push(String(url));assert.equal(options.headers.Authorization,'Bearer own-session');return Response.json({items:[],nextAfter:null});};
 const all=await clientFor({'001':'all'});await all.catalogList('route',{center:'001'});
 assert.ok(!urls[0].includes('center='));assert.match(all.catalogScopeLabel('001'),/접근 가능한 전체/);
 const unc=await clientFor({'001':'unclassified'});await unc.catalogList('delivery_point',{center:'001'});assert.ok(urls[1].includes('center=unclassified'));
 const missing=await clientFor({});await assert.rejects(missing.catalogList('route',{center:'001'}),/속성 대응/);
 globalThis.fetch=async()=>new Response('',{status:503});await assert.rejects(all.catalogList('route',{center:'001'}),/ERP 원본 조회 실패/);
}finally{globalThis.fetch=originalFetch;}
console.log('frontend catalog: own session, explicit all/unclassified, fail-closed passed');

// Actual REST pagination function with a small server page cap. No model or production calls.
const readStart=edge.indexOf('async function restAll('),readEnd=edge.indexOf('\nasync function safeRestVariants',readStart);
const code=stripTypeScriptTypes(edge.slice(readStart,readEnd)).replace('async function restAll','export async function restAll');
const reader=await import('data:text/javascript;base64,'+Buffer.from('const REST_PAGE_SIZE=1000;const coded=(code,status)=>Object.assign(Error(code),{code,status});'+code).toString('base64'));
const envCode=stripTypeScriptTypes(edge.slice(edge.indexOf('function envs('),edge.indexOf('\nfunction bearer('))).replace('function envs','export function envs');
const settings={SUPABASE_URL:'https://isolated.invalid',SUPABASE_ANON_KEY:'public',LEGACY_COMMON_CATALOG:'true'};
const configReader=await import('data:text/javascript;base64,'+Buffer.from('const Deno={env:{get:key=>('+JSON.stringify(settings)+')[key]}};const coded=()=>Error("missing configuration");'+envCode).toString('base64'));
assert.equal(configReader.envs(true,true).catalogEnabled,false,'old clients cannot force the ERP source after legacy activation');
assert.equal(configReader.envs(true,true).legacyCommon,true);
try {
 const ranges=[];let batch=0;
 globalThis.fetch=async(_url,options)=>{assert.equal(options.headers.authorization,'Bearer caller');ranges.push(options.headers.Range);return Response.json([[{id:1},{id:2}],[{id:3}],[]][batch++]);};
 assert.deepEqual(await reader.restAll({url:'https://isolated.invalid',anon:'public'},'caller','routes','select=id'),[{id:1},{id:2},{id:3}]);
 assert.deepEqual(ranges,['0-999','2-1001','3-1002']);
 globalThis.fetch=async(url)=>{assert.match(String(url),/deleted_at=is.null/);return Response.json([]);};
 await reader.restAll({url:'https://isolated.invalid',anon:'public',legacyCommon:true},'caller','routes','select=id');
 globalThis.fetch=async()=>new Response('',{status:403});
 await assert.rejects(reader.restAll({url:'https://isolated.invalid',anon:'public'},'caller','routes','select=id'),/QUERY_FAILED/);
} finally {globalThis.fetch=originalFetch;}
console.log('Legacy assistant REST: caller token, capped pages and explicit query errors passed');

const {default:oldCatalogBridge}=await import('../api/erp-course-catalog.mjs');
const priorMode=process.env.VITE_LEGACY_COMMON_CATALOG;
try{
 process.env.VITE_LEGACY_COMMON_CATALOG='true';
 globalThis.fetch=async()=>{throw Error('retired bridge must not call ERP');};
 for(const method of ['GET','POST']){
  const response=await oldCatalogBridge.fetch(new Request('https://isolated.invalid/api/erp-course-catalog',{method,headers:{authorization:'Bearer old-session','content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})}));
  assert.equal(response.status,409);assert.equal((await response.json()).code,'CATALOG_MOVED_REFRESH_REQUIRED');
 }
 assert.equal((await oldCatalogBridge.fetch(new Request('https://isolated.invalid/api/erp-course-catalog'))).status,401);
}finally{globalThis.fetch=originalFetch;if(priorMode===undefined)delete process.env.VITE_LEGACY_COMMON_CATALOG;else process.env.VITE_LEGACY_COMMON_CATALOG=priorMode;}
console.log('Legacy activation: old ERP bridge refuses reads/writes without upstream calls');
