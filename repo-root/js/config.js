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

// 별도 프로젝트가 연결되기 전에는 운영 환경으로 대체하지 않는다.
const DEV = {
  url: '',
  anonKey: ''
};
const STAGING = { url: '', anonKey: '' };
// ▲▲▲ 사용자 입력 필요 ▲▲▲

function resolveConfig(hostname, environments) {
  const host = String(hostname || '').toLowerCase();
  const environment = host === 'sajoansan.vercel.app' ? 'prod'
    : ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) ? 'dev' : 'staging';
  const config = environments[environment];
  if (!config?.url || !config?.anonKey) {
    throw new Error(`${environment} 환경의 별도 Supabase 연결 설정이 필요합니다.`);
  }
  const url = new URL(config.url);
  if (environment !== 'prod' && url.origin === new URL(environments.prod.url).origin) {
    throw new Error('개발·시험 환경에서는 운영 Supabase를 사용할 수 없습니다.');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Supabase 연결은 HTTPS를 사용해야 합니다.');
  }
  return { ...config, environment };
}

const cfg = resolveConfig(globalThis.location?.hostname, { prod: PROD, dev: DEV, staging: STAGING });
export const ENV = cfg.environment;
export const SUPABASE_URL      = cfg.url;
export const SUPABASE_ANON_KEY = cfg.anonKey;
