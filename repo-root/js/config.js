// Supabase 환경 설정
// =============================================================================
// 이 파일은 클라이언트에 노출되므로 anon key만 사용한다.
// service_role key는 절대 여기에 넣지 말 것.
// =============================================================================

// ▼▼▼ 사용자 입력 필요 ▼▼▼
// Supabase 프로젝트 대시보드 > Project Settings > API 에서 복사
const PROD = {
  url:     'https://vvrppotrnpwrwpwqaiet.supabase.co',  // ← 본인 프로젝트 URL로 교체
  anonKey: 'sb_publishable_VHVQaxth_p_o7pKFza0GtQ_6AeeaXwj'                     // ← 본인 anon public key로 교체
};

// 로컬/개발용을 별도 프로젝트로 운영할 경우 채워넣고 ENV를 'dev'로 변경
const DEV = {
  url:     'https://vvrppotrnpwrwpwqaiet.supabase.co',
  anonKey: 'sb_publishable_VHVQaxth_p_o7pKFza0GtQ_6AeeaXwj'
};
// ▲▲▲ 사용자 입력 필요 ▲▲▲

// 사용할 환경: 'prod' | 'dev'
const ENV = 'prod';

const cfg = ENV === 'dev' ? DEV : PROD;

// 설정 누락 가드 (개발 중 빠르게 알아채기 위함)
if (!cfg.url || !cfg.anonKey || cfg.url.includes('YOUR-')) {
  // 페이지가 로드되자마자 콘솔에 명확히 표시
  // (운영 배포 전에 반드시 채울 것)
  console.error('[config] Supabase URL/anon key가 설정되지 않았습니다. js/config.js를 확인하세요.');
}

export const SUPABASE_URL      = cfg.url;
export const SUPABASE_ANON_KEY = cfg.anonKey;
