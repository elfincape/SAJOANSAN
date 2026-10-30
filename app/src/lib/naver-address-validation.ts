import { supabase } from './supabase';
import type { NaverCourse } from '../domain/naver-courses';
import type { AddressCheck } from '../domain/naver-address-validation';
export interface AddressValidationJob {
  id: string;
  center_code: string;
  status: string;
  courses: NaverCourse[];
  addresses: string[];
  cursor: number;
  results: Record<string, AddressCheck>;
}
export async function getAddressValidation(center: string, id?: string) {
  let request = supabase.from('naver_browser_jobs')
    .select('id,center_code,status,courses,addresses,cursor,results')
    .eq('kind', 'validation').eq('center_code', center);
  if (id) request = request.eq('id', id);
  const { data, error } = await request.order('created_at', { ascending: false }).limit(1).maybeSingle<AddressValidationJob>();
  if (error) throw Error('주소 검증 작업을 불러오지 못했습니다.');
  return data;
}
export async function enqueueAddressValidation(center: string, courses: NaverCourse[], previous?: string, addresses?: string[]) {
  const { data, error } = await supabase.rpc('naver_address_validate_enqueue', {
    p_center: center, p_courses: courses, p_previous_job: previous ?? null,
    p_addresses: addresses ?? null,
  });
  if (error) throw Error(error.message);
  return data as string;
}
