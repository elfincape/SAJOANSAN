// 인증 / 권한 가드
// =============================================================================
// 모든 페이지는 진입 시 requireAuth() 또는 requireRole(minRole)을 호출해야 한다.
// =============================================================================

import { supabase } from './supabase.js';
import { toast, confirmDialog } from './ui.js';

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

let _profileCache = null;     // user_profiles 행 캐시
let _profilePromise = null;   // 동시 호출 시 단일 fetch 보장

// 현재 로그인 세션 확보. 없으면 로그인 페이지로 강제 이동
async function getSessionOrRedirect() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    redirectTo('/login.html');
    return null;
  }
  return session;
}

// 활성 사용자 프로필을 가져온다 (한 번만 fetch, 이후 캐시 반환)
export async function getCurrentProfile() {
  if (_profileCache) return _profileCache;
  if (_profilePromise) return _profilePromise;

  _profilePromise = (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, display_name, role, active')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[auth] 프로필 조회 실패:', error);
      return null;
    }
    _profileCache = data || null;
    return _profileCache;
  })();

  return _profilePromise;
}

// 인증만 강제 (역할 무관). 미인증 또는 비활성 사용자면 로그인 페이지로
export async function requireAuth() {
  const session = await getSessionOrRedirect();
  if (!session) return null;

  const profile = await getCurrentProfile();

  // 프로필이 없거나 비활성화 상태면 차단
  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    _profileCache = null;
    _profilePromise = null;
    redirectTo('/login.html?reason=inactive');
    return null;
  }
  return profile;
}

// 최소 역할 강제. 부족하면 안내 후 대시보드로 이동
export async function requireRole(minRole) {
  const profile = await requireAuth();
  if (!profile) return null;

  const need = ROLE_RANK[minRole] || 0;
  const have = ROLE_RANK[profile.role] || 0;

  if (have < need) {
    // 모달 형태로 안내 후 대시보드로
    await confirmDialog(
      `이 페이지에 접근할 권한이 없습니다.\n필요 권한: ${minRole}\n현재 권한: ${profile.role}`,
      { okOnly: true, okText: '확인' }
    );
    redirectTo('/');
    return null;
  }
  return profile;
}

// 로그아웃
export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error('[auth] 로그아웃 실패:', e);
    toast('로그아웃 중 오류가 발생했습니다.', 'error');
  } finally {
    _profileCache = null;
    _profilePromise = null;
    redirectTo('/login.html');
  }
}

// 캐시를 외부에서 비우고 싶을 때 (예: 사용자 정보 수정 후)
export function clearProfileCache() {
  _profileCache = null;
  _profilePromise = null;
}

function redirectTo(path) {
  // 이미 같은 페이지면 무한 루프 방지
  if (location.pathname === path.split('?')[0]) return;
  location.replace(path);
}
