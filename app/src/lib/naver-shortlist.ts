import { supabase } from './supabase';
import { relationCall } from './naver-relations';
export interface ShortlistJob {
  id: string; status: string; validationJob: string; error?: string;
  totalCourses: number; plannedCourses: number; completedCourses: number;
  totalEdges: number; processed: number; cached: number; failed: number;
  totalWebCandidates: number; directionsAttempts: number; directionsBudget: number;
  busy?: boolean;
  issues?: {courseId?: string; code: string}[];
  shortlists: Record<string,{completeMatrix: boolean}>;
}
export const shortlistCall = (center: string, action: 'shortlist-create'|'shortlist-batch'|'shortlist-status', args: Record<string,unknown>) => relationCall<ShortlistJob>(action,args,center);
export async function latestShortlist(center: string, owner: string, validationJob: string) {
  const {data,error} = await supabase.from('naver_api_jobs').select('id')
    .eq('owner_id',owner).eq('center_code',center).eq('state->>kind','capture-shortlist')
    .eq('state->>validationJob',validationJob).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw Error('저장된 API 후보 작업을 불러오지 못했습니다.');
  return data ? shortlistCall(center,'shortlist-status',{jobId:data.id}) : null;
}
