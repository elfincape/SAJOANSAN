import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface LoginProfile {
  id: string;
  role?: 'viewer' | 'editor' | 'admin';
  active: boolean;
}

export function normalizeUsername(value: string) {
  return String(value ?? '').trim().toLowerCase();
}

export function validUsername(value: string) {
  return /^[a-z0-9가-힣][a-z0-9가-힣_.-]{2,31}$/.test(normalizeUsername(value));
}

export async function accountRequest(client: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke('username-auth', { body });
  if (error) {
    let message: string | undefined;
    try { message = (await error.context.json()).error; } catch { /* Preserve the original fallback. */ }
    throw new Error(message || '계정 처리에 실패했습니다. 잠시 후 다시 시도하세요.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function signInWithUsername(client: SupabaseClient, identifier: string, password: string): Promise<{
  data?: { user: User | null };
  error?: unknown;
}> {
  if (identifier.includes('@')) return client.auth.signInWithPassword({ email: identifier, password });
  if (!validUsername(identifier)) return { error: { message: '아이디는 3~32자의 영문, 숫자, 한글, _, ., -를 사용하세요.' } };
  try {
    const data = await accountRequest(client, { action: 'login', username: normalizeUsername(identifier), password });
    if (!data?.session?.access_token || !data?.session?.refresh_token) throw new Error('로그인 응답을 확인하지 못했습니다.');
    return await client.auth.setSession(data.session);
  } catch (error) { return { error }; }
}

export function loginProfile(client: SupabaseClient, id: string) {
  return client.from('user_profiles').select('id, role, active').eq('id', id).maybeSingle<LoginProfile>();
}

export function loginDestination(search: string, origin: string) {
  const next = new URLSearchParams(search).get('next');
  if (next && next.startsWith('/portal/') && !next.includes('\\')) {
    const target = new URL(next, origin);
    if (target.origin === origin) return target.pathname + target.search;
  }
  return '/?selectCenter=1';
}

export function mapAuthError(error: unknown) {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message || '') : '';
  const msg = message.toLowerCase();
  if (msg.includes('invalid login') || msg.includes('invalid credentials')) return '아이디 또는 비밀번호가 올바르지 않습니다.';
  if (msg.includes('email not confirmed')) return '이메일 인증이 완료되지 않았습니다. 관리자에게 문의하세요.';
  if (msg.includes('too many requests') || msg.includes('rate')) return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
  if (msg.includes('network') || msg.includes('failed to fetch')) return '네트워크 오류입니다. 연결을 확인해주세요.';
  return message || '로그인에 실패했습니다. 입력 정보를 확인해주세요.';
}
