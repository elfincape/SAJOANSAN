import {batch,dbClient,pointsNotionClient} from './sync.js';
import {CENTERS,UUID,fail,plain} from './model.js';
const PROBES=['sync-probe','notion-to-web-probe','web-to-notion-probe'];
async function removeProbe(db,request,center,row) {
  if(!UUID.test(row.id)||row.code!=='SYNC-'+row.id||row.name!=='[연동 검증] '+row.id||!PROBES.includes(row.memo))return false;
  const state=(await db('notion_points_state?select=notion_id&center_code=eq.'+center+'&web_id=eq.'+row.id))[0];
  if(state?.notion_id){
    const page=await request('pages/'+state.notion_id);
    if(plain(page.properties?.['납품처명'])!==row.name||plain(page.properties?.['웹 납품처 ID'])!==row.id||
      page.properties?.['센터']?.select?.name!==CENTERS[center])throw fail('검증 데이터 식별 확인에 실패했습니다.',502,'probe_identity_failed');
    await request('pages/'+state.notion_id,'PATCH',{in_trash:true});
  }
  const removed=await db('delivery_points?center_code=eq.'+center+'&id=eq.'+row.id+'&code=eq.'+encodeURIComponent(row.code)+
    '&name=eq.'+encodeURIComponent(row.name)+'&memo=in.('+PROBES.join(',')+')','DELETE');
  if(removed?.length)await db('notion_points_state?center_code=eq.'+center+'&web_id=eq.'+row.id,'DELETE');
  return !!removed?.length;
}
// Server-only smoke test using a newly generated, isolated row. Always removes its own fixture.
export async function verifyRoundTrip(env,key,center,fetcher=fetch) {
  const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,fetcher);
  // Recover only our exact isolated fixture signatures after an interrupted smoke test.
  const old=await db('delivery_points?select=id,code,name,memo&center_code=eq.'+center+'&code=like.SYNC-*');
  for(const row of old)await removeProbe(db,request,center,row);
  const id=crypto.randomUUID(),code='SYNC-'+id;
  let notionId=null;
  try {
    await db('delivery_points','POST',{id,center_code:center,code,name:'[연동 검증] '+id,photos:[],memo:'sync-probe'});
    const first=await batch(env,key,{center,id},fetcher);
    if(first.created!==1)throw fail('검증용 납품처 연결에 실패했습니다.',502,'round_trip_failed');
    const state=(await db('notion_points_state?select=notion_id&center_code=eq.'+center+'&web_id=eq.'+id))[0];
    notionId=state?.notion_id;if(!notionId)throw fail('검증용 노션 연결을 확인하지 못했습니다.',502,'round_trip_failed');
    await request('pages/'+notionId,'PATCH',{properties:{'비고':{rich_text:[{type:'text',text:{content:'notion-to-web-probe'}}]}}});
    const pulled=await batch(env,key,{center,id},fetcher);
    const row=(await db('delivery_points?select=memo&center_code=eq.'+center+'&id=eq.'+id))[0];
    if(pulled.conflicts||row?.memo!=='notion-to-web-probe')throw fail('노션에서 웹으로 수정 반영을 확인하지 못했습니다.',502,'round_trip_failed');
    await db('delivery_points?center_code=eq.'+center+'&id=eq.'+id,'PATCH',{memo:'web-to-notion-probe'});
    const pushed=await batch(env,key,{center,id},fetcher);
    const page=await request('pages/'+notionId);
    if(pushed.conflicts||plain(page.properties?.['비고'])!=='web-to-notion-probe')throw fail('웹에서 노션으로 수정 반영을 확인하지 못했습니다.',502,'round_trip_failed');
    return {verified:true,center,centerName:CENTERS[center],webToNotion:true,notionToWeb:true};
  } finally {
    if(!notionId)notionId=(await db('notion_points_state?select=notion_id&center_code=eq.'+center+'&web_id=eq.'+id))[0]?.notion_id;
    if(notionId)await request('pages/'+notionId,'PATCH',{in_trash:true});
    await db('delivery_points?center_code=eq.'+center+'&id=eq.'+id+'&code=eq.'+encodeURIComponent(code),'DELETE');
    await db('notion_points_state?center_code=eq.'+center+'&web_id=eq.'+id,'DELETE');
  }
}
