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
