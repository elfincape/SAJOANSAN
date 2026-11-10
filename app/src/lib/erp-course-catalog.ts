import { supabase } from './supabase';

export const useErpCatalog = import.meta.env.VITE_ERP_COURSE_CATALOG === 'true';
type CatalogKind = 'route' | 'delivery_point';
export interface CatalogEntity<T = Record<string, unknown>> {
  id: string;
  label: string;
  fields: T;
  deletedAt: string | null;
}

function centerValue(center?: string) {
  if (!center) return undefined;
  const mapping = JSON.parse(import.meta.env.VITE_ERP_COURSE_CENTER_MAP || '{}');
  const value = Object.hasOwn(mapping, center) ? mapping[center] : undefined;
  if (typeof value !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw Error('이 화면의 ERP 센터 속성 대응을 확인해 주세요.');
  return value;
}

async function request<T>(kind: CatalogKind, params: URLSearchParams) {
  params.set('kind', kind);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Error('다시 로그인해 주세요.');
  const response = await fetch('/api/erp-course-catalog?' + params, {
    headers: { Authorization: 'Bearer ' + session.access_token },
    cache: 'no-store',
  });
  if (!response.ok)
    throw Error('ERP 원본 조회 실패 (' + response.status + ')');
  return await response.json() as T;
}

export async function catalogList<T>(
  kind: CatalogKind,
  options: { center?: string; q?: string; workspaces?: boolean; unlinked?: boolean } = {},
): Promise<T[]> {
  const params = new URLSearchParams();
  const center = centerValue(options.center);
  if (center) params.set('center', center);
  if (options.q) params.set('q', options.q);
  if (options.workspaces) params.set('workspaces', 'true');
  if (options.unlinked) params.set('unlinked', 'true');
  const items: T[] = [];
  const cursors = new Set<string>();
  for (;;) {
    const page = await request<{ items: T[]; nextAfter: string | null }>(kind, params);
    items.push(...page.items);
    if (!page.nextAfter) return items;
    if (cursors.has(page.nextAfter)) throw Error('ERP 조회 페이지가 반복되었습니다.');
    cursors.add(page.nextAfter);
    params.set('after', page.nextAfter);
  }
}

export async function catalogDetail<T = Record<string, unknown>>(kind: CatalogKind, id: string, center?: string) {
  const params = new URLSearchParams({ id });
  const value = centerValue(center);
  if (value) params.set('center', value);
  return request<CatalogEntity<T>>(kind, params);
}

export function erpCourseHref(kind: CatalogKind, id: string) {
  const origin = new URL(import.meta.env.VITE_ERP_COURSE_OPEN_URL || 'https://211.233.219.199:8443/');
  if (origin.protocol !== 'https:') throw Error('ERP 링크를 확인해 주세요.');
  return new URL((kind === 'route' ? '/routes/' : '/data/') + encodeURIComponent(id), origin).href;
}
