import { supabase } from './supabase';
export interface DraftEvidence {
  label?: string;
  text?: string;
  evidence: string;
}
export interface PortalAiDraft {
  pending?: boolean;
  message?: string;
  fresh?: boolean;
  survey_version: number;
  steps: DraftEvidence[];
  fields: DraftEvidence[];
  automation: DraftEvidence[];
  completion?: DraftEvidence;
  repeat?: DraftEvidence;
  questions: string[];
}
async function call<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw Error('다시 로그인해 주세요.');
  const response = await fetch(
      import.meta.env.VITE_SUPABASE_URL +
        '/functions/v1/operations-assistant/' +
        action,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(100000),
      },
    ),
    result = await response.json();
  if (!response.ok)
    throw Error(result.error?.message ?? 'AI 결과를 가져오지 못했습니다.');
  return result;
}
export const portalAi = {
  draft: (surveyId: string, force = false) =>
    call<PortalAiDraft>('portal-survey-draft', { surveyId, force }),
};

export interface BriefingItem {
  id: string;
  kind: string;
  title: string;
  center?: string;
  reason_label?: string;
  action?: string;
}
export interface BriefingCache {
  body?: {
    date: string;
    items: BriefingItem[];
    counts?: Record<string, number>;
    limited?: boolean;
    centers: { code: string; name: string }[];
  } | null;
  status?: string;
  last_error?: string | null;
  generated_at?: string;
  dispatch_error?: string | null;
}
export const portalBriefing = {
  generate: (force = false) =>
    call<{ pending?: boolean; message?: string; cached?: boolean }>(
      'portal-briefing',
      { force },
    ),
  async cached(): Promise<BriefingCache> {
    const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      [result, dispatch] = await Promise.all([
        supabase
          .from('operations_ai_results')
          .select('body,status,last_error,generated_at')
          .eq('cache_key', 'briefing:' + day)
          .maybeSingle(),
        supabase
          .from('operations_automation_state')
          .select('last_error')
          .eq('name', 'briefing-dispatch')
          .maybeSingle(),
      ]);
    if (result.error) throw result.error;
    if (dispatch.error) throw dispatch.error;
    return {
      ...result.data,
      dispatch_error: dispatch.data?.last_error ?? null,
    };
  },
};
