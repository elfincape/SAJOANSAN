import { koreaToday, validDate } from '../../../repo-root/js/driver-health.js';
import { notionClient, notionError } from './notion-api.js';
import { database, validateSyncInput } from './sync.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const names={'001':'안산','002':'평택'};
const value=property=>(property?.rich_text || []).map(part=>part.plain_text ?? part.text?.content ?? '').join('');
export function validateCompletionInput(body) {
  validateSyncInput({...body,cursor:null});
  if(body.cursor!=null && (typeof body.cursor!=='string'||!body.cursor||body.cursor.length>256))
    throw notionError('완료 확인 조회 위치를 확인해 주세요.',400,'invalid_cursor');
  if(body.dryRun!==undefined && typeof body.dryRun!=='boolean')
    throw notionError('완료 확인 요청을 확인해 주세요.',400,'invalid_body');
}
export function completionCandidate(page,driver,center,today) {
  const props=page?.properties;
  if(page?.object!=='page'||!UUID.test(page.id)||page.archived||page.is_archived||page.in_trash||
    props?.['처리 상태']?.select?.name==='갱신 완료')return false;
  if(!driver || driver.center_code!==center || !UUID.test(driver.id) ||
    props?.['센터']?.select?.name!==names[center] || value(props?.['웹 기사 ID'])!==driver.id)return false;
  const old=props?.['보건증 만료일']?.date?.start ?? null;
  const suffix=old===null?'missing':old;
  if(old!==null && !validDate(old))return false;
  if(value(props?.['갱신 건 ID'])!==['health',center,driver.id,suffix].join(':'))return false;
  const expiry=driver.health_certificate_expires_on;
  return validDate(expiry) && expiry>today && (old===null || expiry>old);
}
export async function completionStatus(env,service,fetcher,body) {
  validateSyncInput({...body,cursor:null});
  const rows=await database(env,service,fetcher)('notion_health_completion_status?select=last_completed_at&center_code=eq.'+body.center+'&limit=1');
  if(!Array.isArray(rows))throw notionError('마지막 업데이트 시간을 조회할 수 없습니다.',503,'database_error');
  return {center:body.center,lastUpdatedAt:rows[0]?.last_completed_at || null};
}
export async function completionBatch(env,service,fetcher,body,options={}) {
  validateCompletionInput(body);
  if(!env.NOTION_API_TOKEN?.trim() || !UUID.test(env.NOTION_DATA_SOURCE_ID?.trim() || ''))
    throw notionError('Notion 연결 비밀값을 확인해 주세요.',503,'missing_secrets');
  const db=database(env,service,fetcher),now=options.now || new Date(),today=koreaToday(now);
  const owner=crypto.randomUUID(),acquired=await db('rpc/notion_health_acquire',{p_token:owner});
  if(acquired!==true)throw notionError('다른 동기화가 진행 중입니다. 잠시 후 다시 실행해 주세요.',409,'sync_busy');
  const result={center:body.center,today,scanned:0,completed:0,eligible:0,unchanged:0,dryRun:body.dryRun===true,nextCursor:null,hasMore:false};
  let hold=false;
  try {
    const request=notionClient(env,fetcher,options.wait);
    // Keep query membership and ordering stable while page status changes.
    const found=await request('data_sources/'+env.NOTION_DATA_SOURCE_ID.trim()+'/query','POST',{
      filter:{and:[{property:'센터',select:{equals:names[body.center]}},{property:'웹 기사 ID',rich_text:{is_not_empty:true}}]},
      sorts:[{timestamp:'created_time',direction:'ascending'}],page_size:2,...(body.cursor?{start_cursor:body.cursor}:{})
    });
    if(found.object!=='list'||!Array.isArray(found.results)||
      (found.has_more && (typeof found.next_cursor!=='string'||!found.next_cursor||found.next_cursor===body.cursor))||
      found.request_status?.incomplete_reason==='query_result_limit_reached')
      throw notionError('Notion 완료 확인 목록을 끝까지 조회할 수 없습니다.',502,'notion_invalid_response');
    for(const initial of found.results) {
      if(initial.object!=='page'||!UUID.test(initial.id))
        throw notionError('Notion 기사 기록을 확인해 주세요.',502,'notion_invalid_response');
      const driverId=value(initial.properties?.['웹 기사 ID']);
      if(!UUID.test(driverId)||initial.properties?.['처리 상태']?.select?.name==='갱신 완료'||
        initial.archived||initial.is_archived||initial.in_trash) {result.scanned++;result.unchanged++;continue;}
      // Read the latest page and website expiry immediately before the update.
      const page=await request('pages/'+initial.id);
      if(page.id!==initial.id)throw notionError('Notion 기사 기록을 확인해 주세요.',502,'notion_invalid_response');
      const rows=await db('drivers?select=id,center_code,health_certificate_expires_on&id=eq.'+driverId+'&center_code=eq.'+body.center+'&limit=1');
      if(!Array.isArray(rows))throw notionError('기사 조회 응답을 확인해 주세요.',503,'database_error');
      const driver=rows[0];
      if(completionCandidate(page,driver,body.center,today)) {
        result.eligible++;
        if(!body.dryRun) {
          const saved=await request('pages/'+page.id,'PATCH',{properties:{
            '처리 상태':{select:{name:'갱신 완료'}},
            '갱신 완료일':{date:{start:today}},
            '갱신 후 만료일':{date:{start:driver.health_certificate_expires_on}},
            '최근 동기화일':{date:{start:now.toISOString()}}
          }});
          if(saved.object!=='page'||saved.id!==page.id)
            throw notionError('완료 저장 결과를 확인하지 못했습니다.',502,'notion_invalid_response',{uncertainWrite:true});
          result.completed++;
        }
      } else result.unchanged++;
      result.scanned++;
    }
    result.hasMore=Boolean(found.has_more);result.nextCursor=result.hasMore?found.next_cursor:null;
    if(!result.hasMore && !body.dryRun) {
      result.lastUpdatedAt=await db('rpc/notion_health_record_completion',{p_center:body.center});
      if(typeof result.lastUpdatedAt!=='string'||!Number.isFinite(Date.parse(result.lastUpdatedAt)))
        throw notionError('마지막 업데이트 시간을 저장하지 못했습니다.',503,'database_error');
    }
    return result;
  } catch(error) {
    hold=Boolean(error.extra?.uncertainWrite);
    const reason=error.status?error:notionError('갱신 완료 반영 중 오류가 발생했습니다. 다시 시도해 주세요.',503,'completion_error');
    reason.extra={...reason.extra,summary:result,...(hold?{retryAfterSeconds:180}:{})};
    throw reason;
  } finally {if(!hold)await db('rpc/notion_health_release',{p_token:owner});}
}
