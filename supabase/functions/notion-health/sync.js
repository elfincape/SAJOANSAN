import { healthStatus, koreaToday, nextMonth, validDate } from '../../../repo-root/js/driver-health.js';
import { notionClient, notionError } from './notion-api.js';
const CENTER_NAMES={'001':'안산','002':'평택'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH_SIZE=6;
export function validateSyncInput(body) {
  if(!body || !Object.hasOwn(CENTER_NAMES,body.center)) throw notionError('안산 또는 평택 센터를 선택해 주세요.',400,'invalid_center');
  if(body.cursor!==undefined && body.cursor!==null && !UUID.test(body.cursor))
    throw notionError('조회 위치가 올바르지 않습니다. 처음부터 다시 실행해 주세요.',400,'invalid_cursor');
}
export function renewalKey(driver) {
  return ['health',driver.center_code,driver.id,validDate(driver.health_certificate_expires_on)?driver.health_certificate_expires_on:'missing'].join(':');
}
export function expiryLabel(expiry,today) {
  return healthStatus(expiry,today).label.replace(/^보건증 /,'');
}
const text=value=>[{type:'text',text:{content:String(value || '').slice(0,2000)}}];
export function webProperties(driver,today,now) {
  return {
    '기사명':{title:text(driver.name || '기사명 미등록')},
    '센터':{select:{name:CENTER_NAMES[driver.center_code]}},
    '웹 기사 ID':{rich_text:text(driver.id)},
    '갱신 건 ID':{rich_text:text(renewalKey(driver))},
    '보건증 만료일':{date:validDate(driver.health_certificate_expires_on)?{start:driver.health_certificate_expires_on}:null},
    '만료 상태':{select:{name:expiryLabel(driver.health_certificate_expires_on,today)}},
    '최근 동기화일':{date:{start:now}}
  };
}
function database(env,service,fetcher) {
  return async(path,body) => {
    const response=await fetcher(env.SUPABASE_URL+'/rest/v1/'+path,{
      method:body?'POST':'GET',headers:{apikey:service,...(service.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+service}),
        'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw notionError('웹 보건증 데이터 조회 또는 동기화 준비에 실패했습니다.',503,'database_error');
    if(response.status===204)return null;
    return response.json();
  };
}
const driversQuery=(center,today,cursor,limit)=>'drivers?select=id,name,center_code,health_certificate_expires_on&center_code=eq.'+center+
  '&or=(health_certificate_expires_on.is.null,health_certificate_expires_on.lt.'+nextMonth(today)+')&order=id.asc&limit='+limit+
  (cursor?'&id=gt.'+cursor:'');
export async function previewTargets(env,service,fetcher,body,now=new Date()) {
  validateSyncInput(body);
  const db=database(env,service,fetcher),today=koreaToday(now);
  const counts={'미등록':0,'만료':0,'오늘 만료':0,'만료 임박':0};
  let cursor=null,total=0;
  for(let page=0;page<200;page++) {
    const rows=await db(driversQuery(body.center,today,cursor,1000));
    if(!Array.isArray(rows)) throw notionError('기사 조회 응답이 올바르지 않습니다.',503,'database_error');
    for(const row of rows) {const label=expiryLabel(row.health_certificate_expires_on,today);if(Object.hasOwn(counts,label)){counts[label]++;total++;}}
    if(rows.length<1000) return {center:body.center,centerName:CENTER_NAMES[body.center],today,total,counts};
    cursor=rows.at(-1).id;
  }
  throw notionError('기사 데이터가 많아 조회 범위를 확인해야 합니다.',503,'too_many_drivers');
}
export async function syncBatch(env,service,fetcher,body,options={}) {
  validateSyncInput(body);
  const db=database(env,service,fetcher),now=options.now || new Date(),today=koreaToday(now);
  const owner=crypto.randomUUID();
  const acquired=await db('rpc/notion_health_acquire',{p_token:owner});
  if(acquired!==true) throw notionError('다른 동기화가 진행 중입니다. 잠시 후 다시 실행해 주세요.',409,'sync_busy');
  const result={center:body.center,today,processed:0,created:0,updated:0,closed:0,conflicts:0,nextCursor:body.cursor || null,hasMore:false};
  const started=Date.now();
  let hold=false;
  try {
    const rows=await db(driversQuery(body.center,today,body.cursor,BATCH_SIZE+1));
    if(!Array.isArray(rows)) throw notionError('기사 조회 응답이 올바르지 않습니다.',503,'database_error');
    const request=notionClient(env,fetcher,options.wait);
    for(const row of rows.slice(0,BATCH_SIZE)) {
      if(Date.now()-started>30000){result.hasMore=true;break;}
      if(!UUID.test(row.id) || row.center_code!==body.center) throw notionError('기사 식별 정보를 확인해 주세요.',503,'invalid_driver');
      const found=await request('data_sources/'+env.NOTION_DATA_SOURCE_ID.trim()+'/query','POST',{
        filter:{property:'갱신 건 ID',rich_text:{equals:renewalKey(row)}},page_size:2
      });
      if(!Array.isArray(found.results)) throw notionError('Notion 조회 응답이 올바르지 않습니다.',502,'notion_invalid_response');
      const pages=found.results.filter(page=>!page.archived&&!page.is_archived&&!page.in_trash);
      if(pages.length>1 || found.has_more) {result.conflicts++;}
      else if(pages[0]?.properties?.['처리 상태']?.select?.name==='갱신 완료') {result.closed++;}
      else if(healthStatus(row.health_certificate_expires_on,today).urgent) {
        const properties=webProperties(row,today,now.toISOString());
        let saved;
        if(pages.length) {
          if(!UUID.test(pages[0].id)) throw notionError('Notion 기사 기록의 ID를 확인해 주세요.',502,'notion_invalid_response');
          saved=await request('pages/'+pages[0].id,'PATCH',{properties});
        } else {
          properties['처리 상태']={select:{name:'확인 필요'}};
          saved=await request('pages','POST',{parent:{type:'data_source_id',data_source_id:env.NOTION_DATA_SOURCE_ID.trim()},properties});
        }
        if(saved.object!=='page' || !UUID.test(saved.id)) {
          throw notionError('저장 결과가 불확실합니다. 잠시 후 다시 확인해 주세요.',502,'notion_invalid_response',{uncertainWrite:true});
        }
        result[pages.length?'updated':'created']++;
      }
      result.processed++;
      result.nextCursor=row.id;
    }
    result.hasMore=result.hasMore || rows.length>BATCH_SIZE;
    return result;
  } catch(error) {
    hold=Boolean(error.extra?.uncertainWrite);
    const reason=error.status ? error : notionError('동기화 중 오류가 발생했습니다. 다시 시도해 주세요.',503,'sync_error');
    reason.extra={...reason.extra,summary:result,...(hold?{retryAfterSeconds:180}:{})};
    throw reason;
  } finally {
    // An uncertain write keeps its lease until expiry so an immediate retry cannot duplicate a pending creation.
    if(!hold) await db('rpc/notion_health_release',{p_token:owner});
  }
}
