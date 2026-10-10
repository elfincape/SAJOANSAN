import {dbClient,pointsNotionClient} from '../notion-points/sync.js';
import {SOURCE,webValues as pointWeb,notionValues as pointRemote} from '../notion-points/model.js';
import {notionPhotoFingerprint} from '../notion-points/photos.js';
import {CENTERS,SOURCES,FIELDS,UUID,fail,plain,equal,webValues,remoteValues} from './model.js';
import {allRows,loadMaps,expandRelations} from './sync.js';

// Verification uses its own isolated fixture while retaining the common lease.
export async function verifyCandidate(env,key,center,kind,phase,id,fetcher=fetch){
  let cursor=null;
  for(let i=0;i<10000;i++){
    const result=await scan(env,key,{center,kind,phase,cursor},fetcher);
    if(result.ids.includes(id))return;
    if(!result.hasMore)break;cursor=result.nextCursor;
  }
  throw fail('변경 항목 감지를 확인하지 못했습니다.',502,'candidate_detection_failed');
}

// Read snapshots in bulk; the existing guarded merge remains the only writer.
export async function scan(env,key,body,fetcher=fetch,options={}){
  const {center,kind,phase='web',cursor=null}=body||{};
  if(!Object.hasOwn(CENTERS,center)||!['points',...Object.keys(SOURCES)].includes(kind)||
    !['web','notion'].includes(phase)||(cursor!=null&&(typeof cursor!=='string'||!cursor||cursor.length>500||(phase==='web'&&!UUID.test(cursor)))))throw fail('조회 범위를 확인해 주세요.');
  const db=dbClient(env,key,fetcher),request=pointsNotionClient(env,fetcher,options.wait);
  const table=kind==='points'?'notion_points_state':'notion_graph_state';
  const states=await allRows(db,table+'?select=web_id,notion_id,baseline,status'+(kind==='points'?',photo_hash,web_photo_signature,notion_photo_fingerprint':'')+
    '&center_code=eq.'+center+(kind==='points'?'':'&kind=eq.'+kind),'web_id');
  const byID=new Map(states.map(s=>[s.web_id,s])),byPage=new Map(states.filter(s=>s.notion_id).map(s=>[s.notion_id.replaceAll('-','').toLowerCase(),s]));
  const out={ids:[],linked:[],seen:[],scanned:0,hasMore:false,nextCursor:null};
  if(phase==='web'){
    let rows;
    if(kind==='points')rows=await db('rpc/notion_points_scan_web','POST',{p_center:center,p_cursor:cursor});
    else rows=await db(kind+'?select='+['id','center_code',...Object.keys(FIELDS[kind]).filter(k=>k!=='stops')].join(',')+'&center_code=eq.'+center+'&order=id.asc&limit=101'+(cursor?'&id=gt.'+cursor:''));
    const stops=kind==='routes'?await allRows(db,'course_view?select=stop_id,route_id,delivery_point_id&center_code=eq.'+center,'stop_id'):[];
    for(const row of rows.slice(0,100)){
      if(row.center_code!==center||!UUID.test(row.id))throw fail('센터 식별 정보를 확인해 주세요.',422);
      const state=byID.get(row.id);if(state?.notion_id)out.linked.push({id:row.id,page:state.notion_id.replaceAll('-','').toLowerCase()});
      let changed=!state?.notion_id||state.status!=='정상'||!state.baseline;
      try{
        changed||= !equal(kind==='points'?pointWeb(row):webValues(kind,row,stops.filter(s=>s.route_id===row.id&&s.delivery_point_id)),state?.baseline);
        if(kind==='points')changed||=state?.web_photo_signature?state.web_photo_signature!==row._photo_sig:row._has_photos||state?.photo_hash!=='';
      }catch(error){if(error.status!==422)throw error;changed=true;}
      if(changed)out.ids.push(row.id);out.scanned++;out.nextCursor=row.id;
    }
    out.hasMore=rows.length>100;
  }else{
    // Query the entire source, so moving a linked page to another center is detected too.
    const result=await request('data_sources/'+(kind==='points'?SOURCE:SOURCES[kind])+'/query','POST',{page_size:100,...(cursor?{start_cursor:cursor}:{})});
    const maps=kind==='points'?null:await loadMaps(db,center);
    for(let page of result.results){
      const pageID=page.id.replaceAll('-','').toLowerCase();out.seen.push(pageID);out.scanned++;
      const identity=plain(page.properties?.[kind==='points'?'웹 납품처 ID':'웹 ID']);
      const matches=[byPage.get(pageID),byID.get(identity)].filter(Boolean);
      for(const state of new Set(matches)){
        let changed=state.status!=='정상'||!state.baseline||state.notion_id.replaceAll('-','').toLowerCase()!==pageID||identity!==state.web_id||page.properties?.['센터']?.select?.name!==CENTERS[center];
        if(!changed)try{
          if(kind!=='points')page=await expandRelations(request,kind,page);
          changed=!equal(kind==='points'?pointRemote(page):remoteValues(kind,page,maps),state.baseline);
          if(kind==='points'){
            const fp=await notionPhotoFingerprint(page);
            changed||=state.notion_photo_fingerprint?state.notion_photo_fingerprint!==fp:
              (page.properties?.['사진']?.files||[]).length>0||state.photo_hash!=='';
          }
        }catch(error){if(error.status!==422)throw error;changed=true;}
        if(changed)out.ids.push(state.web_id);
      }
    }
    out.hasMore=!!result.has_more;out.nextCursor=result.next_cursor;
  }
  if(!out.hasMore)out.nextCursor=null;out.ids=[...new Set(out.ids)];return out;
}
