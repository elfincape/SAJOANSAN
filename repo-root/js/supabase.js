// Supabase 클라이언트 싱글톤
// =============================================================================
// 모든 페이지/모듈은 이 파일에서 export 된 supabase 인스턴스를 공유한다.
// =============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,        // 로그인 상태 유지 (localStorage)
    autoRefreshToken: true,      // 토큰 자동 갱신
    detectSessionInUrl: true     // 매직링크/OAuth 콜백 처리
  }
});
