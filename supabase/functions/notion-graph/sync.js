import {dbClient,pointsNotionClient} from '../notion-points/sync.js';
import {CENTERS,FIELDS,SOURCES,UUID,fail,plain,equal,webValues,remoteValues,merge,properties,webPatch,metadata,validate} from './model.js';
export async function allRows(db,path,order='id') {
  const result=[];
  for(let offset=0;;offset+=1000){const rows=await db(path+'&order='+order+'.asc&limit=1000&offset='+offset);result.push(...rows);if(rows.length<1000)return result;}
}
export async function loadMaps(db,center) {
  const maps={};
  for(const kind of ['companies','drivers','routes','points']){
    const table=kind==='points'?'notion_points_state':'notion_graph_state';
    const rows=await allRows(db,table+'?select=web_id,notion_id&center_code=eq.'+center+(kind==='points'?'':'&kind=eq.'+kind),'web_id');
    maps[kind]={forward:new Map(),reverse:new Map()};
    for(const r of rows)if(r.notion_id){maps[kind].forward.set(r.web_id,r.notion_id);maps[kind].reverse.set(r.notion_id.replaceAll('-','').toLowerCase(),r.web_id);}
  }
  return maps;
}
export async function check(request,kind) {
  const source=await request('data_sources/'+SOURCES[kind]);
  for(const [name,type,target] of Object.values(FIELDS[kind])){
    const p=source.properties?.[name];
    if(p?.type!==type)throw fail('노션 '+name+' 열 형식을 확인해 주세요.',422,'schema_mismatch');
    if(target&&p.relation?.data_source_id!==(target==='points'?'73aa532a-bc84-4338-8001-897b4e77a1d9':SOURCES[target]))throw fail('노션 관계 대상 DB를 확인해 주세요.',422,'schema_mismatch');
  }
  return {connected:true,kind};
}
export async function batch(env,key,body,fetcher=fetch,options={}) {
  validate(body);const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,fetcher,options.wait);
  await check(request,body.kind);
  const token=options.lockToken||crypto.randomUUID();
  if(!options.lockToken&&await db('rpc/notion_points_acquire','POST',{p_token:token})!==true)throw fail('다른 동기화가 진행 중입니다.',409,'sync_busy');
  const maps=await loadMaps(db,body.center),kind=body.kind;
  const result={kind,center:body.center,processed:0,created:0,updated:0,unchanged:0,imported:0,conflicts:0,hasMore:false,phase:body.phase||'web',nextCursor:null};
  let hold=false;
  const stateFor=async id=>(await db('notion_graph_state?select=*&kind=eq.'+kind+'&center_code=eq.'+body.center+'&web_id=eq.'+id))[0];
  const saveState=async(id,values)=>db('notion_graph_state?on_conflict=kind,center_code,web_id','POST',{kind,center_code:body.center,web_id:id,...values});
  const stopsFor=async id=>kind==='routes'?allRows(db,'route_stops?select=*&route_id=eq.'+id):[];
  const expected=(row,stops)=>({...Object.fromEntries(Object.keys(FIELDS[kind]).filter(k=>k!=='stops').map(k=>[k,row[k]??null])),...(kind==='routes'?{_stops:stops}:{})});
  async function conflict(row,page){
    if(page&&!page.in_trash&&!page.is_archived)await request('pages/'+page.id,'PATCH',{properties:{'동기화 상태':{select:{name:'충돌 확인'}}}});
    if(row)await saveState(row.id,{...(page?{notion_id:page.id}:{}),status:'충돌 확인'});
    result.conflicts++;
  }
  async function syncRow(row){
    if(!UUID.test(row.id)||row.center_code!==body.center)throw fail('센터 식별 정보를 확인해 주세요.',422,'relation_scope');
    const state=await stateFor(row.id),stops=await stopsFor(row.id),web=webValues(kind,row,stops);
    // Validate all relation mappings before creating or updating any entity.
    properties(kind,web,maps);
    const found=await request('data_sources/'+SOURCES[kind]+'/query','POST',{filter:{property:'웹 ID',rich_text:{equals:row.id}},page_size:2});
    if(found.has_more||found.results.length>1){await conflict(row,null);return;}
    let page=found.results[0];
    if(!page&&state?.notion_id){await conflict(row,null);return;}
    if(!page){
      page=await request('pages','POST',{parent:{type:'data_source_id',data_source_id:SOURCES[kind]},properties:{...properties(kind,web,maps),...metadata(kind,body.center,row.id)}});
      if(!UUID.test(page.id))throw fail('저장 결과를 확인하지 못했습니다.',502,'uncertain_write');
      await saveState(row.id,{notion_id:page.id,baseline:web,status:'정상',synced_at:new Date().toISOString()});result.created++;return;
    }
    if(page.in_trash||page.is_archived||page.archived||page.properties?.['센터']?.select?.name!==CENTERS[body.center]||
      (state?.notion_id&&state.notion_id!==page.id)){await conflict(row,page);return;}
    // Retrieve every relation item; page responses truncate larger relation values.
    for(const [name,type] of Object.values(FIELDS[kind]))if(type==='relation'&&page.properties?.[name]?.has_more){
      const p=page.properties[name],relation=[];let cursor=null;
      do{const r=await request('pages/'+page.id+'/properties/'+encodeURIComponent(p.id)+'?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
        relation.push(...r.results.map(x=>x.relation));cursor=r.has_more?r.next_cursor:null;
      }while(cursor);
      page.properties[name]={...p,relation,has_more:false};
    }
    const remote=remoteValues(kind,page,maps),merged=merge(state?.baseline,web,remote);
    if(merged.conflicts.length||!merged.values.name){await conflict(row,page);return;}
    const desired=merged.values;
    if(state?.status==='정상'&&equal(web,desired)&&equal(remote,desired)&&equal(state.baseline,desired)){result.unchanged++;return;}
    const fresh=await request('pages/'+page.id);
    if(fresh.last_edited_time!==page.last_edited_time){await conflict(row,page);return;}
    if(!equal(web,desired)){
      const values=webPatch(kind,desired);if(kind==='routes'&&equal(web.stops,desired.stops))delete values.stops;
      const saved=await db('rpc/notion_graph_apply','POST',{p_kind:kind,p_center:body.center,p_id:row.id,p_expected:expected(row,stops),p_values:values});
      if(!saved){await conflict(row,page);return;}
    }
    const target=properties(kind,desired,maps),changed={};
    for(const [k,[name]] of Object.entries(FIELDS[kind]))if(!equal(remote[k],desired[k]))changed[name]=target[name];
    await request('pages/'+page.id,'PATCH',{properties:{...changed,...metadata(kind,body.center,row.id)}});
    const verify=(await db(kind+'?select=*&center_code=eq.'+body.center+'&id=eq.'+row.id))[0];
    if(!verify||!equal(webValues(kind,verify,await stopsFor(row.id)),desired)){await conflict(row,page);return;}
    await saveState(row.id,{notion_id:page.id,baseline:desired,status:'정상',synced_at:new Date().toISOString()});result.updated++;
  }
  async function importPage(page){
    if(page.in_trash||page.is_archived||page.properties?.['센터']?.select?.name!==CENTERS[body.center])throw fail('센터를 확인해 주세요.',422,'relation_scope');
    if(plain(page.properties?.['웹 ID']))return;
    const desired=remoteValues(kind,page,maps);if(!desired.name){await conflict(null,page);return;}
    const reserved=(await db('notion_graph_state?select=*&notion_id=eq.'+page.id))[0];
    if(reserved&&(reserved.kind!==kind||reserved.center_code!==body.center)){await conflict(null,page);return;}
    let id=reserved?.web_id;
    // Company names are unique per center in the existing web form.
    if(!id&&kind==='companies'){
      const existing=await db('companies?select=id&center_code=eq.'+body.center+'&name=eq.'+encodeURIComponent(desired.name)+'&limit=2');
      if(existing.length>1){await conflict(null,page);return;}
      if(existing[0]){const linked=await stateFor(existing[0].id);if(linked?.notion_id&&linked.notion_id!==page.id){await conflict(null,page);return;}id=existing[0].id;}
    }
    id=id||crypto.randomUUID();await saveState(id,{notion_id:page.id,status:'연결 대기'});
    let row=(await db(kind+'?select=*&center_code=eq.'+body.center+'&id=eq.'+id))[0];
    if(row){
      const actual=webValues(kind,row,await stopsFor(id));
      if(!Object.keys(desired).filter(k=>k!=='stops').every(k=>equal(actual[k],desired[k]))){await conflict(row,page);return;}
    }else{
      const values=webPatch(kind,desired);delete values.stops;
      row=(await db(kind,'POST',{id,center_code:body.center,...values}))[0];
    }
    if(kind==='routes'){
      const stops=await stopsFor(id),actual=webValues(kind,row,stops);
      if(!equal(actual.stops,desired.stops)){
        if(stops.length){await conflict(row,page);return;}
        if(!await db('rpc/notion_graph_apply','POST',{p_kind:kind,p_center:body.center,p_id:id,p_expected:expected(row,stops),p_values:{stops:desired.stops}})){await conflict(row,page);return;}
      }
    }
    await request('pages/'+page.id,'PATCH',{properties:metadata(kind,body.center,id)});
    await saveState(id,{notion_id:page.id,baseline:desired,status:'정상',synced_at:new Date().toISOString()});result.imported++;
  }
  try{
    if(result.phase==='web'){
      const rows=await db(kind+'?select=*&center_code=eq.'+body.center+'&order=id.asc&limit=3'+(body.id?'&id=eq.'+body.id:body.cursor?'&id=gt.'+body.cursor:''));
      for(const row of rows.slice(0,2)){
        try{await syncRow(row);}catch(error){if(error.status!==422)throw error;const state=await stateFor(row.id);await conflict(row,state?.notion_id?{id:state.notion_id}:null);}
        result.processed++;result.nextCursor=row.id;
      }
      if(body.id){result.hasMore=false;result.nextCursor=null;}
      else if(rows.length>2)result.hasMore=true;
      else{result.hasMore=true;result.phase='notion';result.nextCursor=null;}
    }else{
      const found=await request('data_sources/'+SOURCES[kind]+'/query','POST',{filter:{and:[{property:'센터',select:{equals:CENTERS[body.center]}},{property:'웹 ID',rich_text:{is_empty:true}}]},page_size:2,...(body.cursor?{start_cursor:body.cursor}:{})});
      for(const page of found.results){try{await importPage(page);}catch(error){if(error.status!==422)throw error;await conflict(null,page);}result.processed++;}
      result.hasMore=!!found.has_more;result.nextCursor=found.next_cursor;
    }
    return result;
  }catch(error){hold=!!error.extra?.uncertainWrite||error.code==='uncertain_write';error.summary=result;throw error;}
  finally{if(!hold&&!options.lockToken)await db('rpc/notion_points_release','POST',{p_token:token});}
}
