import {notionClient} from '../notion-health/notion-api.js';
import {CENTERS,FIELDS,SOURCE,UUID,fail,plain,webValues,notionValues,merge,properties,rich,webPatch} from './model.js';
import {hashPhotos,downloadPhotos,uploadPhotos} from './photos.js';
export function pointsNotionClient(env,fetcher=fetch,wait) {
  const request=notionClient(env,fetcher,wait);
  return async(...args)=>{try{return await request(...args);}catch(error){
    if(error.code==='notion_404')error.message='노션 납품처 DB에 웹 연동 연결의 접근 권한을 추가해 주세요.';
    throw error;
  }};
}
export function dbClient(env,key,fetcher=fetch) {
  return async(path,method='GET',body)=>{
    const r=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{method,
      headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),
        'Content-Type':'application/json',Prefer:'return=representation,resolution=merge-duplicates'},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw fail('웹 납품처 저장 또는 조회에 실패했습니다.',503,'database_error');
    return r.status===204?null:r.json();
  };
}
export async function check(env,request) {
  if(!env.NOTION_API_TOKEN?.trim())throw fail('서버의 Notion 연결 토큰을 확인해 주세요.',503,'missing_token');
  const source=await request('data_sources/'+SOURCE);
  const required={...Object.fromEntries(Object.values(FIELDS)),사진:'files',센터:'select','웹 납품처 ID':'rich_text','동기화 상태':'select','최근 동기화일':'date','웹 바로가기':'url'};
  const issues=Object.entries(required).filter(([name,type])=>source.properties?.[name]?.type!==type);
  if(issues.length)throw fail('노션 납품처 열 형식을 확인해 주세요: '+issues.map(([name])=>name).join(', '),422,'schema_mismatch');
  return {connected:true,source:SOURCE};
}
function metadata(center,id,status='정상') {
  return {'센터':{select:{name:CENTERS[center]}},'웹 납품처 ID':{rich_text:rich(id)},
    '동기화 상태':{select:{name:status}},'최근 동기화일':{date:{start:new Date().toISOString()}},
    '웹 바로가기':{url:'https://sajoansan.vercel.app/admin/delivery-points.html?center='+(center==='001'?'ansan':'pyeongtaek')+'&id='+id}};
}
export function validate(body) {
  if(!body||!Object.hasOwn(CENTERS,body.center))throw fail('안산 또는 평택 센터를 선택해 주세요.');
  if(body.id!==undefined&&!UUID.test(body.id))throw fail('납품처 ID를 확인해 주세요.');
  if(body.phase!==undefined&&!['web','notion'].includes(body.phase))throw fail('동기화 단계가 올바르지 않습니다.');
  if(body.cursor!==undefined&&body.cursor!==null&&(typeof body.cursor!=='string'||body.cursor.length>500||!body.cursor||
    ((body.phase||'web')==='web'&&!UUID.test(body.cursor))))throw fail('조회 위치를 확인해 주세요.');
}
export async function batch(env,key,body,fetcher=fetch,options={}) {
  validate(body);const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,fetcher,options.wait);
  await check(env,request);
  const token=crypto.randomUUID();
  if(await db('rpc/notion_points_acquire','POST',{p_token:token})!==true)throw fail('다른 납품처 동기화가 진행 중입니다. 잠시 후 다시 실행해 주세요.',409,'sync_busy');
  const result={center:body.center,processed:0,created:0,updated:0,imported:0,conflicts:0,hasMore:false,phase:body.phase||'web',nextCursor:null};
  let hold=false;
  async function stateFor(id){return (await db('notion_points_state?select=*&center_code=eq.'+body.center+'&web_id=eq.'+id))[0];}
  async function saveState(id,values){await db('notion_points_state?on_conflict=center_code,web_id','POST',{center_code:body.center,web_id:id,...values});}
  async function markConflict(row,page) {
    if(page)await request('pages/'+page.id,'PATCH',{properties:{'동기화 상태':{select:{name:'충돌 확인'}}}});
    if(row)await saveState(row.id,{...(page?{notion_id:page.id}:{}),status:'충돌 확인'});
    result.conflicts++;
  }
  async function syncRow(row) {
    if(!UUID.test(row.id)||row.center_code!==body.center)throw fail('납품처 센터 또는 식별 정보를 확인해 주세요.',422);
    const state=await stateFor(row.id);
    const found=await request('data_sources/'+SOURCE+'/query','POST',{
      filter:{property:'웹 납품처 ID',rich_text:{equals:row.id}},page_size:2});
    if(!Array.isArray(found.results))throw fail('노션 조회 결과를 확인해 주세요.',502);
    if(found.results.length>1||found.has_more){await markConflict(row,null);return;}
    let page=found.results[0];
    if(!page&&state?.notion_id){await markConflict(row,null);return;} // Never recreate deleted/archived linked records.
    const web=webValues(row),webPhotos=row.photos||[],webHash=await hashPhotos(webPhotos);
    if(!page) {
      const files=await uploadPhotos(webPhotos,request,env,fetcher);
      page=await request('pages','POST',{parent:{type:'data_source_id',data_source_id:SOURCE},
        properties:{...properties(web),...metadata(body.center,row.id),'사진':{files}}});
      if(!UUID.test(page.id))throw fail('노션 저장 결과를 확인할 수 없습니다.',502,'uncertain_write');
      await saveState(row.id,{notion_id:page.id,baseline:web,photo_hash:webHash,status:'정상',synced_at:new Date().toISOString()});
      result.created++;return;
    }
    if(page.archived||page.in_trash||page.properties?.['센터']?.select?.name!==CENTERS[body.center]||
      (state?.notion_id&&state.notion_id!==page.id)) {await markConflict(row,page);return;}
    const remote=notionValues(page),merged=merge(state?.baseline,web,remote);
    const remotePhotos=await downloadPhotos(page,fetcher),remoteHash=await hashPhotos(remotePhotos);
    let photos=webPhotos,photoHash=webHash;
    if(webHash!==remoteHash) {
      if(state && webHash===state.photo_hash){photos=remotePhotos;photoHash=remoteHash;}
      else if(!state || remoteHash!==state.photo_hash)merged.conflicts.push('photos');
    }
    if(merged.conflicts.length){await markConflict(row,page);return;}
    const desired=merged.values;
    if(!desired.name){await markConflict(row,page);return;}
    // Recheck Notion before writes; patch only changed properties, preserving other users' fields.
    const fresh=await request('pages/'+page.id);
    if(fresh.last_edited_time!==page.last_edited_time){await markConflict(row,page);return;}
    const patch=webPatch(desired);
    if(photoHash!==webHash)patch.photos=photos;
    const expected=Object.fromEntries(Object.keys(FIELDS).map(k=>[k,row[k]??null]));expected.photos=row.photos||[];expected.contact_mobile=row.contact_mobile??null;
    if(Object.keys(FIELDS).some(k=>web[k]!==desired[k])||photoHash!==webHash) {
      const saved=await db('rpc/notion_points_apply','POST',{p_id:row.id,p_center:body.center,p_expected:expected,p_values:patch});
      if(!saved){await markConflict(row,page);return;}
    }
    const target=properties(desired),changed={};
    for(const [k,[name]] of Object.entries(FIELDS))if(remote[k]!==desired[k])changed[name]=target[name];
    if(photoHash!==remoteHash)changed['사진']={files:await uploadPhotos(photos,request,env,fetcher)};
    await request('pages/'+page.id,'PATCH',{properties:{...changed,...metadata(body.center,row.id)}});
    // A concurrent browser edit after the SQL write must not become the next baseline.
    const verify=(await db('delivery_points?select=*&center_code=eq.'+body.center+'&id=eq.'+row.id))[0];
    if(!verify || JSON.stringify(webValues(verify))!==JSON.stringify(desired) || await hashPhotos(verify.photos||[])!==photoHash){await markConflict(row,page);return;}
    await saveState(row.id,{notion_id:page.id,baseline:desired,photo_hash:photoHash,status:'정상',synced_at:new Date().toISOString()});
    result.updated++;
  }
  async function importPage(page) {
    if(!UUID.test(page.id)||page.properties?.['센터']?.select?.name!==CENTERS[body.center])throw fail('노션 납품처 센터를 확인해 주세요.',422);
    if(plain(page.properties?.['웹 납품처 ID']))return;
    const values=notionValues(page),photos=await downloadPhotos(page,fetcher);
    if(!values.name){await markConflict(null,page);return;}
    // Match a supplied business code, otherwise reserve an immutable UUID before creating a row.
    let rows=values.code?await db('delivery_points?select=*&center_code=eq.'+body.center+'&code=eq.'+encodeURIComponent(values.code)+'&limit=2'):[];
    if(rows.length>1){await markConflict(null,page);return;}
    if(rows[0]) {
      const linked=await stateFor(rows[0].id);
      if(linked?.notion_id&&linked.notion_id!==page.id){await markConflict(null,page);return;}
      await request('pages/'+page.id,'PATCH',{properties:metadata(body.center,rows[0].id,'연결 대기')});
      await syncRow(rows[0]);return;
    }
    const states=await db('notion_points_state?select=*&notion_id=eq.'+page.id);
    if(states[0]&&states[0].center_code!==body.center){await markConflict(null,page);return;}
    const id=states[0]?.web_id||crypto.randomUUID();
    await saveState(id,{notion_id:page.id,status:'연결 대기'});
    rows=await db('delivery_points?select=*&center_code=eq.'+body.center+'&id=eq.'+id);
    if(!rows.length)await db('delivery_points','POST',{id,center_code:body.center,...webPatch(values),photos});
    await request('pages/'+page.id,'PATCH',{properties:metadata(body.center,id,'연결 대기')});
    await syncRow((await db('delivery_points?select=*&center_code=eq.'+body.center+'&id=eq.'+id))[0]);
    result.imported++;
  }
  try {
    if(result.phase==='web') {
      const rows=await db('delivery_points?select=*&center_code=eq.'+body.center+'&order=id.asc&limit=3'+
        (body.id?'&id=eq.'+body.id:body.cursor?'&id=gt.'+body.cursor:''));
      for(const row of rows.slice(0,2)){
        try {await syncRow(row);}catch(error){
          if(error.status!==422)throw error;
          const state=await stateFor(row.id);await markConflict(row,state?.notion_id?{id:state.notion_id}:null);
        }
        result.processed++;result.nextCursor=row.id;
      }
      if(body.id){result.hasMore=false;result.nextCursor=null;}
      else if(rows.length>2)result.hasMore=true;
      else {result.hasMore=true;result.phase='notion';result.nextCursor=null;}
    } else {
      const found=await request('data_sources/'+SOURCE+'/query','POST',{filter:{and:[{property:'센터',select:{equals:CENTERS[body.center]}},
        {property:'웹 납품처 ID',rich_text:{is_empty:true}}]},page_size:2,...(body.cursor?{start_cursor:body.cursor}:{})});
      for(const page of found.results){
        try {await importPage(page);}catch(error){if(error.status!==422)throw error;await markConflict(null,page);}
        result.processed++;
      }
      // Continue with Notion's opaque cursor, including conflict rows without repeatedly stopping on them.
      result.hasMore=!!found.has_more;result.nextCursor=found.next_cursor;
    }
    return result;
  } catch(error) {hold=!!error.extra?.uncertainWrite||error.code==='uncertain_write';error.summary=result;throw error;}
  finally {if(!hold)await db('rpc/notion_points_release','POST',{p_token:token});}
}
