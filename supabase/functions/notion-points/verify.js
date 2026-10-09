import {batch,dbClient,pointsNotionClient} from './sync.js';
import {CENTERS,fail,plain} from './model.js';
// Server-only smoke test using a newly generated, isolated row. Always removes its own fixture.
export async function verifyRoundTrip(env,key,center,fetcher=fetch) {
  const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,fetcher);
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
    if(notionId)await request('pages/'+notionId,'PATCH',{archived:true});
    await db('delivery_points?center_code=eq.'+center+'&id=eq.'+id+'&code=eq.'+encodeURIComponent(code),'DELETE');
    await db('notion_points_state?center_code=eq.'+center+'&web_id=eq.'+id,'DELETE');
  }
}
