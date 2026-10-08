import { supabase } from './supabase.js';
export async function loadCharterTrips(centerCode,{from,to}={}) {
 const rows=[];
 for(let offset=0;;offset+=1000){
  let query=supabase.from('charter_trips').select('id,payload,version,business_date').eq('center_code',centerCode).order('id').range(offset,offset+999);
  if(from||to){const parts=[];if(from)parts.push('business_date.gte.'+from);if(to)parts.push('business_date.lte.'+to);query=query.or('business_date.is.null,and('+parts.join(',')+')');}
  const {data,error}=await query;if(error)throw new Error(error.message);
  rows.push(...data);if(data.length<1000)break;
 }
 return rows;
}

export async function existingVersions(centerCode,ids) {
 const versions=new Map(),batches=[];let batch=[],length=0;
 for(const id of ids){
  const size=encodeURIComponent(String(id)).length+6;
  if(batch.length&&(length+size>4000||batch.length===100)){batches.push(batch);batch=[];length=0;}
  batch.push(id);length+=size;
 }
 if(batch.length)batches.push(batch);
 for(const chunk of batches){
  const {data,error}=await supabase.from('charter_trips').select('id,version').eq('center_code',centerCode).in('id',chunk);
  if(error)throw new Error('기존 운행 조회 실패: '+(error.message||error.code||'DB 연결을 확인해 주세요.'));
  for(const row of data||[])versions.set(row.id,row.version);
 }
 return versions;
}

export async function saveCharterTrips(centerCode,trips,versions) {
 if(!trips.length)throw new Error('저장할 데이터가 없습니다.');
 if(trips.length>500)throw new Error('한 번에 500운행까지 저장합니다. 일자 필터로 나누어 저장해 주세요.');
 const {data,error}=await supabase.rpc('save_charter_trips',{p_center:centerCode,p_rows:trips.map(payload=>({payload,expectedVersion:versions.get(payload.id)||0}))});
 if(error)throw new Error('저장 요청 실패: '+(error.message||error.code||'DB 연결을 확인해 주세요.'));
 if(!Array.isArray(data)||data.length!==trips.length||trips.some(t=>!data.some(r=>r.id===t.id&&Number.isInteger(r.version)&&r.version>0)))throw new Error('DB 저장 응답이 올바르지 않습니다. DB를 다시 조회해 확인해 주세요.');
 return data;
}
export async function listCharterArchives(centerCode){
 const {data,error}=await supabase.from('charter_archives').select('id,month,file_name,record_count,verified_at,purged_at').eq('center_code',centerCode).order('verified_at',{ascending:false});
 if(error)throw new Error(error.message);return data;
}
export async function purgeCharterMonth(archiveId){
 const {data,error}=await supabase.rpc('purge_charter_month',{p_archive:archiveId});if(error)throw new Error(error.message);return data;
}

export async function deleteCharterTrip(centerCode,id,version){
 const {data,error}=await supabase.rpc('delete_charter_trip',{p_center:centerCode,p_id:id,p_version:version});
 if(error)throw new Error(error.message);return data;
}
