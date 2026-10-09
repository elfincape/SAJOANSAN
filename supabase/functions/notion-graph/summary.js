import {dbClient,pointsNotionClient} from '../notion-points/sync.js';
import {CENTERS,FIELDS,UUID,fail,rich} from './model.js';
import {allRows,loadMaps} from './sync.js';
const LABEL='연결 정보 · 자동 갱신';
const cleanID=id=>String(id||'').replaceAll('-','').toLowerCase();
const text=s=>rich(String(s??''));
function mention(kind,id,context){
  const page=context.maps[kind].forward.get(id);
  if(!page)return text(context.rows[kind].get(id)?.name||'미배정');
  return [{type:'mention',mention:{type:'page',page:{id:page}}}];
}
const bullet=(rt,children=[])=>({object:'block',type:'bulleted_list_item',bulleted_list_item:{rich_text:rt,...(children.length?{children}:{})}});
function driverLine(id,role,route,c){
  if(!id)return bullet(text(role+' 미배정'));
  const d=c.rows.drivers.get(id),vehicle=c.rows.vehicles.get(role==='주기사'?route.primary_vehicle_id:route.secondary_vehicle_id);
  return bullet([...text(role+' '),...mention('drivers',id,c),...text((d?.phone?' · '+d.phone:'')+
    (vehicle?.plate_number?' · '+vehicle.plate_number:'')+(vehicle?.tonnage?' · '+vehicle.tonnage+'톤':''))]);
}
function companyBranch(route,c){return bullet([...text('운수사 '),...mention('companies',route.company_id,c)],
  [driverLine(route.primary_driver_id,'주기사',route,c),...(route.secondary_driver_id?[driverLine(route.secondary_driver_id,'보조기사',route,c)]:[])]);}
export function summaryTree(kind,row,c){
  let rt=[...text(LABEL+'\n'+row.name+' · '+CENTERS[row.center_code]+'\n')],children=[];
  if(kind==='points'){
    rt.push(...text([row.address,row.region,row.deadline_text?'납품마감 '+row.deadline_text:null,
      row.contact_mobile||row.contact?'연락처 '+(row.contact_mobile||row.contact):null,row.memo?.slice(0,500)].filter(Boolean).join('\n')));
    const routes=[...c.rows.routes.values()].filter(r=>c.stops.some(s=>s.route_id===r.id&&s.delivery_point_id===row.id)).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
    children=routes.map(r=>bullet([...text('코스 '),...mention('routes',r.id,c)],[companyBranch(r,c)]));
  }else if(kind==='routes'){
    rt.push(...text((row.car_number?row.car_number+' · ':'')+(row.active?'운행중':'운행 중지')+'\n운수사 '),...mention('companies',row.company_id,c));
    rt.push(...text('\n주기사 '),...mention('drivers',row.primary_driver_id,c));
    const d=c.rows.drivers.get(row.primary_driver_id),v=c.rows.vehicles.get(row.primary_vehicle_id);
    rt.push(...text((d?.phone?' · '+d.phone:'')+(v?.plate_number?' · '+v.plate_number:'')+(v?.tonnage?' · '+v.tonnage+'톤':'')));
    children=c.stops.filter(s=>s.route_id===row.id).sort((a,b)=>(a.stop_order??0)-(b.stop_order??0)).map(s=>bullet([
      ...text((s.stop_order??'')+'. 납품처 '),...mention('points',s.delivery_point_id,c),...text(s.arrival_text?' · 도착 '+s.arrival_text:'')],[companyBranch(row,c)]));
  }else if(kind==='drivers'){
    rt.push(...text((row.phone?'연락처 '+row.phone+'\n':'')+'운수사 '),...mention('companies',row.company_id,c),...text(row.memo?'\n'+row.memo.slice(0,500):''));
    children=[...c.rows.routes.values()].filter(r=>r.primary_driver_id===row.id||r.secondary_driver_id===row.id).map(r=>bullet([
      ...text((r.primary_driver_id===row.id?'주기사 코스 ':'보조기사 코스 ')),...mention('routes',r.id,c)]));
  }else{
    rt.push(...text(row.memo?.slice(0,500)||''));
    children=[...c.rows.drivers.values()].filter(d=>d.company_id===row.id).map(d=>bullet([
      ...text('기사 '),...mention('drivers',d.id,c),...text(d.phone?' · '+d.phone:'')]));
  }
  return {object:'block',type:'callout',callout:{icon:{type:'emoji',emoji:'🔗'},rich_text:rt,...(children.length?{children}:{})}};
}
function normalizeRT(list){return (list||[]).map(r=>({value:r.type==='mention'?['page',cleanID(r.mention?.page?.id)]:['text',r.text?.content||'',r.text?.link?.url||''],
  annotations:{bold:false,italic:false,strikethrough:false,underline:false,code:false,color:'default',...r.annotations}}));}
export function normalizedTree(block){const p=block[block.type]||{};return {type:block.type,icon:p.icon?.emoji||'',rt:normalizeRT(p.rich_text),children:(p.children||[]).map(normalizedTree)};}
export async function treeHash(block){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(normalizedTree(block))));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function children(request,id){const list=[];let cursor=null;do{
  const r=await request('blocks/'+id+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));list.push(...r.results);cursor=r.has_more?r.next_cursor:null;
}while(cursor);return list;}
async function readTree(request,block,depth=0){
  if(depth>4)throw fail('자동 정보 영역에 추가된 내용을 확인해 주세요.',422,'summary_manual');
  if(block.has_children){const list=await children(request,block.id);block[block.type]={...block[block.type],children:[]};
    for(const b of list)block[block.type].children.push(await readTree(request,b,depth+1));
  }
  return block;
}
function onlyBot(block,id){return block.created_by?.id===id&&block.last_edited_by?.id===id&&(block[block.type]?.children||[]).every(b=>onlyBot(b,id));}
async function loadContext(db,center,maps){
  const rows={};
  const selects={companies:'id,center_code,name,memo',drivers:'id,center_code,name,phone,memo,company_id',
    routes:'id,center_code,name,car_number,active,company_id,primary_driver_id,secondary_driver_id,primary_vehicle_id,secondary_vehicle_id',
    points:'id,center_code,name,address,region,contact,contact_mobile,deadline_text,memo',vehicles:'id,center_code,plate_number,tonnage'};
  const [entries,stops]=await Promise.all([
    Promise.all(Object.keys(selects).map(async kind=>[kind,new Map((await allRows(db,(kind==='points'?'delivery_points':kind)+'?select='+selects[kind]+'&center_code=eq.'+center)).map(r=>[r.id,r]))])),
    allRows(db,'course_view?select=stop_id,route_id,delivery_point_id,stop_order,arrival_text&center_code=eq.'+center,'stop_id')
  ]);
  for(const [kind,map] of entries)rows[kind]=map;
  return {rows,stops,maps};
}
export async function summaryBatch(env,key,body,fetcher=fetch,options={}){
  if(!body||!Object.hasOwn(CENTERS,body.center)||!['companies','drivers','routes','points'].includes(body.kind)||
    (body.id!==undefined&&!UUID.test(body.id))||(body.cursor!=null&&!UUID.test(body.cursor)))throw fail('센터·종류·조회 위치를 확인해 주세요.');
  const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,fetcher,options.wait),token=options.lockToken||crypto.randomUUID();
  if(!options.lockToken&&await db('rpc/notion_points_acquire','POST',{p_token:token})!==true)throw fail('다른 동기화가 진행 중입니다.',409,'sync_busy');
  const result={processed:0,updated:0,unchanged:0,conflicts:0,hasMore:false,nextCursor:null};let hold=false;
  const kind=body.kind,table=kind==='points'?'notion_points_state':'notion_graph_state';
  const stateFor=async id=>(await db(table+'?select=notion_id,summary_block_id,summary_hash,summary_status&center_code=eq.'+body.center+'&web_id=eq.'+id+(kind==='points'?'':'&kind=eq.'+kind)))[0];
  const save=async(id,values)=>db(table+'?on_conflict='+(kind==='points'?'center_code,web_id':'kind,center_code,web_id'),'POST',{
    ...(kind==='points'?{}:{kind}),center_code:body.center,web_id:id,...values});
  try{
    const maps=await loadMaps(db,body.center),c=await loadContext(db,body.center,maps);
    const ids=[...c.rows[kind].keys()].sort().filter(id=>body.id?id===body.id:!body.cursor||id>body.cursor).slice(0,13),started=Date.now();
    for(const id of ids.slice(0,12)){
      if(result.processed&&Date.now()-started>25000)break;
      try{
      const state=await stateFor(id),pageID=state?.notion_id;
      if(!pageID){result.conflicts++;result.processed++;result.nextCursor=id;continue;}
      const desired=summaryTree(kind,c.rows[kind].get(id),c),hash=await treeHash(desired);
      if(state.summary_hash===hash&&state.summary_status==='정상'){result.unchanged++;result.processed++;result.nextCursor=id;continue;}
      const page=await request('pages/'+pageID),identity=kind==='points'?'웹 납품처 ID':'웹 ID';
      const idText=(page.properties?.[identity]?.rich_text||[]).map(x=>x.plain_text??x.text?.content??'').join('');
      if(page.in_trash||page.is_archived||page.properties?.['센터']?.select?.name!==CENTERS[body.center]||idText!==id){result.conflicts++;result.processed++;result.nextCursor=id;continue;}
      let blockID=state.summary_block_id,current=null;
      if(!blockID&&state.summary_status==='생성 중'){
        const list=await children(request,pageID),bot=await request('users/me');
        const found=list.filter(b=>b.type==='callout'&&b.created_by?.id===bot.id&&b.callout?.rich_text?.[0]?.text?.content?.startsWith(LABEL+'\n'));
        if(found.length>1)throw fail('자동 정보 영역을 확인해 주세요.',422,'summary_manual');blockID=found[0]?.id;
      }
      if(blockID){
        current=await readTree(request,await request('blocks/'+blockID));
        if(current.in_trash||current.archived||current.is_archived||cleanID(current.parent?.page_id)!==cleanID(pageID)||current.type!=='callout')throw fail('자동 정보 영역의 이동·삭제 상태를 확인해 주세요.',422,'summary_manual');
        const actual=await treeHash(current);
        if(actual===hash){await save(id,{summary_block_id:blockID,summary_hash:hash,summary_status:'정상'});result.unchanged++;result.processed++;result.nextCursor=id;continue;}
        const recovering=['생성 중','갱신 중'].includes(state.summary_status);
        if(actual!==state.summary_hash&&!(recovering&&onlyBot(current,current.created_by.id))){
          await save(id,{summary_status:'수동 확인'});
          await request('pages/'+pageID,'PATCH',{properties:{'동기화 상태':{select:{name:'충돌 확인'}}}});
          result.conflicts++;result.processed++;result.nextCursor=id;continue;
        }
        await save(id,{summary_block_id:blockID,summary_status:'갱신 중'});
        for(const b of current.callout.children||[])await request('blocks/'+b.id,'DELETE');
        await request('blocks/'+blockID,'PATCH',{callout:{icon:desired.callout.icon,rich_text:desired.callout.rich_text}});
      }else{
        await save(id,{summary_status:'생성 중'});
        const r=await request('blocks/'+pageID+'/children','PATCH',{children:[{...desired,callout:{icon:desired.callout.icon,rich_text:desired.callout.rich_text}}]});
        blockID=r.results?.[0]?.id;if(!UUID.test(blockID||''))throw fail('미리보기 저장 결과를 확인하지 못했습니다.',502,'uncertain_write');
        await save(id,{summary_block_id:blockID,summary_status:'생성 중'});
      }
      for(let offset=0;offset<(desired.callout.children?.length||0);offset+=100)
        await request('blocks/'+blockID+'/children','PATCH',{children:desired.callout.children.slice(offset,offset+100)});
      await save(id,{summary_block_id:blockID,summary_hash:hash,summary_status:'정상'});result.updated++;result.processed++;result.nextCursor=id;
      }catch(error){
        if(error.code!=='summary_manual')throw error;
        await save(id,{summary_status:'수동 확인'});result.conflicts++;result.processed++;result.nextCursor=id;
      }
    }
    result.hasMore=!body.id&&ids.length>result.processed;if(!result.hasMore)result.nextCursor=null;return result;
  }catch(error){hold=!!error.extra?.uncertainWrite||error.code==='uncertain_write';error.summary=result;throw error;}
  finally{if(!hold&&!options.lockToken)await db('rpc/notion_points_release','POST',{p_token:token});}
}

