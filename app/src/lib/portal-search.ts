import { supabase } from './supabase';
import { operationsRpc } from './operations';
import type { SearchResult, SearchRow } from '../domain/portal-search';
import { activeCatalogKinds, catalogDetail, catalogList, erpCourseHref, useErpCatalog, type CatalogEntity } from './erp-course-catalog';
export async function portalSearch(term: string, center: string, page: number) {
  const original = operationsRpc<SearchResult>('operations_search', {
    p_query: term,
    p_center: center || null,
    p_page: page,
  });
  if (!useErpCatalog) return original;
  const catalogKinds = activeCatalogKinds();
  const [legacy, ...erp] = await Promise.all([
    original,
    ...Object.entries(catalogKinds).map(async ([kind, type]) => {
      const items = await catalogList<CatalogEntity>(type, { center, q: term.trim() });
      items.sort((a, b) => a.label.localeCompare(b.label, 'ko') || a.id.localeCompare(b.id));
      return { kind, total: items.length, items: items.slice(page * 20, (page + 1) * 20)
        .map(({ id, label }) => ({ id, title: label, erpHref: erpCourseHref(type, id) })) };
    }),
  ] as const);
  return { groups: [...legacy.groups.filter(({ kind }) => !Object.hasOwn(catalogKinds, kind)),
    ...erp.filter(({ total }) => total > 0)] };
}
export async function portalSearchMaster(kind: string, id: string) {
  const catalogKinds = activeCatalogKinds();
  if (Object.hasOwn(catalogKinds, kind)) {
    const item = await catalogDetail(catalogKinds[kind], id);
    return { ...item.fields, id: item.id, ...(kind === 'vehicles' ? { plate_number: item.fields.plate } : {}) };
  }
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
