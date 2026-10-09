import {dbClient,pointsNotionClient} from '../notion-points/sync.js';
import {fail} from './model.js';
const PARENT='3f4b98bf-5f20-81c2-992e-fecda52668d7';
const SOURCE='73aa532a-bc84-4338-8001-897b4e77a1d9';
const OLD='7f28822a-7e92-4e20-9035-01d5edeef2e7';
const MARK='SAJOANSAN original delivery source relocation 73aa532a';
const text=x=>(x||[]).map(x=>x.plain_text??x.text?.content??'').join('');
const same=(a,b)=>a?.replaceAll('-','')===b?.replaceAll('-','');
const rich=content=>[{type:'text',text:{content}}];
// Fixed, explicitly approved relocation; never restores the deleted ancestor.
export async function repairPointHome(env,key,fetcher=fetch){
  let stage='parent',reason=null;
  const diagnosticFetch=async(url,options)=>{
    const response=await fetcher(url,options);
    if(url==='https://api.notion.com/v1/data_sources/'+SOURCE&&response.status===400){
      const error=await response.clone().json().catch(()=>({}));
      // This fixed metadata-only request contains no business row values or credentials.
      reason=typeof error.message==='string'?error.message.substring(0,1500):null;
    }
    return response;
  };
  const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,diagnosticFetch),token=crypto.randomUUID();
  if(await db('rpc/notion_points_acquire','POST',{p_token:token})!==true)throw fail('동기화가 진행 중입니다.',409,'sync_busy');
  let hold=false;
  try{
    const parent=await request('pages/'+PARENT);
    if(parent.in_trash||parent.archived||text(parent.properties?.title?.title)!=='관리허브 연동 원본')throw fail('승인한 원본 페이지를 확인해 주세요.',422,'repair_scope');
    stage='source';const source=await request('data_sources/'+SOURCE);
    let destination=null,cursor=null;
    do{
      const children=await request('blocks/'+PARENT+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
      for(const child of children.results)if(child.type==='child_database'&&!child.in_trash){
        const candidate=await request('databases/'+child.id);
        if(text(candidate.description)===MARK&&same(candidate.parent?.page_id,PARENT)&&!candidate.in_trash){
          if(destination)throw fail('중복 이동 대상이 있습니다.',422,'repair_scope');destination=candidate;
        }
      }
      cursor=children.has_more?children.next_cursor:null;
    }while(cursor);
    if(!same(source.parent?.database_id,OLD)&&!same(source.parent?.database_id,destination?.id))throw fail('납품처 원본 위치가 변경되었습니다.',422,'repair_scope');
    if(!destination)destination=await request('databases','POST',{parent:{type:'page_id',page_id:PARENT},title:rich('납품처 정보 확인'),description:rich(MARK),initial_data_source:{properties:{'이동 준비':{title:{}}}}});
    if(!same(destination.parent?.page_id,PARENT)||text(destination.description)!==MARK)throw fail('이동 대상을 확인하지 못했습니다.',502,'uncertain_write');
    if(!same(source.parent?.database_id,destination.id)||source.in_trash){
      stage='move';const moved=await request('data_sources/'+SOURCE,'PATCH',{parent:{type:'database_id',database_id:destination.id},in_trash:false});
      if(!same(moved.parent?.database_id,destination.id)||moved.in_trash)throw fail('이동 결과를 확인하지 못했습니다.',502,'uncertain_write');
    }
    stage='empty_source_cleanup';const current=await request('databases/'+destination.id);
    for(const item of current.data_sources||[])if(!same(item.id,SOURCE)){
      const temporary=await request('data_sources/'+item.id);
      if(Object.keys(temporary.properties||{}).length!==1||temporary.properties?.['이동 준비']?.type!=='title')throw fail('예상하지 못한 추가 자료가 있습니다.',422,'repair_scope');
      const rows=await request('data_sources/'+item.id+'/query','POST',{page_size:1});
      if(rows.results.length||rows.has_more)throw fail('이동 준비 자료가 비어 있지 않습니다.',422,'repair_scope');
      if(!temporary.in_trash)await request('data_sources/'+item.id,'PATCH',{in_trash:true});
    }
    return {restored:true,databaseID:destination.id,sourceID:SOURCE};
  }catch(error){hold=!error.status||error.status>=500;error.summary={stage,...(reason?{reason}:{})};throw error;}
  finally{if(!hold)await db('rpc/notion_points_release','POST',{p_token:token});}
}

