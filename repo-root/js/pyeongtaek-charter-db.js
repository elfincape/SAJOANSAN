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
 const versions=new Map();
 for(let i=0;i<ids.length;i+=100){
  const {data,error}=await supabase.from('charter_trips').select('id,version').eq('center_code',centerCode).in('id',ids.slice(i,i+100));
  if(error)throw new Error(error.message);for(const row of data)versions.set(row.id,row.version);
 }
 return versions;
}
export async function saveCharterTrips(centerCode,trips,versions) {
 if(!trips.length)throw new Error('저장할 데이터가 없습니다.');
 if(trips.length>500)throw new Error('한 번에 500운행까지 저장합니다. 일자 필터로 나누어 저장해 주세요.');
 const {data,error}=await supabase.rpc('save_charter_trips',{p_center:centerCode,p_rows:trips.map(payload=>({payload,expectedVersion:versions.get(payload.id)||0}))});
 if(error)throw new Error(error.message);return data;
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
