import { supabase } from './supabase';
import { CAPTURE_TABLE } from '../domain/one-top-config';
import type { Capture } from '../domain/one-top';
interface StoredCapture { id:string;filename:string;image_data:string;analysis:{status?:Capture['status'];result?:Capture['result'];error?:string;supplementalDataUrl?:string|null}|null;updated_at:string }
export function captureCount(center:string,user:string){return supabase.from(CAPTURE_TABLE).select('id',{count:'exact',head:true}).eq('center_code',center).eq('user_id',user);}
export function saveCapture(center:string,user:string,item:Capture){const payload={id:item.dbId||item.id,center_code:center,user_id:user,filename:item.name||'receipt.jpg',image_data:item.dataUrl,analysis:{status:item.status,result:item.result,error:item.error||'',supplementalDataUrl:item.supplementalDataUrl||null},updated_at:new Date().toISOString()};return supabase.from(CAPTURE_TABLE).upsert(payload,{onConflict:'id'}).select('id,updated_at').single<{id:string;updated_at:string}>();}
export function loadCaptures(center:string,user:string){return supabase.from(CAPTURE_TABLE).select('id,filename,image_data,analysis,updated_at').eq('center_code',center).eq('user_id',user).order('created_at',{ascending:true}).returns<StoredCapture[]>();}
export function removeCaptures(center:string,user:string,ids:string[]){return supabase.from(CAPTURE_TABLE).delete().in('id',ids).eq('center_code',center).eq('user_id',user);}
export function removeCapture(center:string,user:string,id:string){return supabase.from(CAPTURE_TABLE).delete().eq('id',id).eq('center_code',center).eq('user_id',user);}
export function clearCloudCaptures(center:string,user:string){return supabase.from(CAPTURE_TABLE).delete().eq('center_code',center).eq('user_id',user);}
export function cloudErrorMessage(error:unknown){const value=String(error&&typeof error==='object'&&'message'in error?error.message:error||'');return /one_top_two_room_captures|schema cache|PGRST205/i.test(value)?'DB 임시저장 기능을 사용하려면 one-top-two-room-captures.sql을 먼저 실행하세요.':`DB 사진 처리 실패: ${value}`;}
