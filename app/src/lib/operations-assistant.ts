import { supabase } from './supabase';
import { normalizeAssistantResponse } from '../domain/operations-assistant';
export interface AssistantMessage {
  role: string;
  content: string;
}
export async function askOperationsAssistant(
  question: string,
  center: string,
  conversation: AssistantMessage[],
  signal: AbortSignal,
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw Error('로그인이 필요합니다.');
  const response = await fetch(
    import.meta.env.VITE_SUPABASE_URL + '/functions/v1/operations-assistant',
    {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ question, center, conversation }),
    },
  );
  const value = await response.json().catch(() => null);
  if (!response.ok || value?.error)
    throw Error(value?.error?.message || '조회에 실패했습니다.');
  return normalizeAssistantResponse(value);
}
