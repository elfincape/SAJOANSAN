import { supabase } from './supabase';
import { operationsRpc } from './operations';
import type { SearchResult, SearchRow } from '../domain/portal-search';
export function portalSearch(term: string, center: string, page: number) {
  return operationsRpc<SearchResult>('operations_search', {
    p_query: term,
    p_center: center || null,
    p_page: page,
  });
}
export async function portalSearchMaster(kind: string, id: string) {
  const { data, error } = await supabase
    .from(kind)
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Record<string, unknown>;
}
export interface DocumentSearchResult {
  total: number;
  pending: boolean;
  items: SearchRow[];
}
export async function portalDocumentSearch(
  term: string,
  center: string,
  page: number,
) {
  const endpoint =
    import.meta.env.VITE_DOCUMENT_SEARCH_URL ||
    'https://211.233.219.199/search';
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (url.protocol !== 'https:')
    throw Error('문서 검색 연결 설정을 확인해 주세요.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw Error('로그인이 필요합니다.');
  const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ query: term, center: center || null, page }),
      signal: AbortSignal.timeout(90000),
    }),
    result = await response.json();
  if (!response.ok)
    throw Error(result.error || '문서 본문을 조회하지 못했습니다.');
  return result as DocumentSearchResult;
}
