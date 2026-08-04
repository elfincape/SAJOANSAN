# 운영 질의도우미

## 설계/위협 모델

브라우저는 로그인 JWT, 현재 센터 slug, 질문만 `operations-assistant` Edge Function에 보냅니다. 함수는 JWT로 사용자를 확인하고 활성 `viewer` 이상 프로필 및 `user_center_access`를 검증합니다. 데이터 조회는 사용자 JWT/RLS 컨텍스트와 서버가 강제한 `center_code`를 사용합니다. Service role은 사용하지 않습니다.

LLM은 고정된 다섯 intent와 제한된 JSON 인자만 고릅니다. SQL·테이블명·PostgREST 식을 만들거나 실행하지 못합니다. 실제 쿼리는 서버의 고정 query builder만 수행하며 쓰기 메서드/RPC/SQL 실행 경로가 없습니다. `security_password`와 열쇠 위치는 select/모델 payload/응답에서 제외하고 전화번호는 마스킹합니다. 표 rows는 모델이 아닌 서버 조회 결과로 결정됩니다.

현재 앱에는 센터별 사용자 권한 모델이 없었으므로 `operations-assistant.sql`은 현행 동작과 같이 기존 활성 사용자에게 001/002를 초기 배정합니다. 마이그레이션 전에는 활성 사용자에게 기존 앱과 동일하게 두 센터를 허용하되, 모든 운영 조회에 사용자 JWT/RLS와 서버의 `center_code`를 계속 강제합니다. 이후 센터 제한이 필요하면 이 매핑만 관리하십시오.

## 제한

- 질문 1~1000자, 대화 최근 8개(클라이언트 메모리 전용)
- 도구 결과 화면/복사 최대 100행
- Edge isolate 기준 사용자당 분당 10회/일 100회. 인메모리 제한은 isolate 재시작/다중 인스턴스에서 완전하지 않으므로 운영 규모가 커지면 DB/Redis 기반 제한으로 교체해야 합니다.
- 모델: 서버 고정 `claude-haiku-4-5-20251001`
- audit summary는 before/after 개인정보 노출 위험과 현재 RLS 불확실성 때문에 1차에서 제외했습니다.
- 질문 원문, 도구 전체 결과, 전화번호, 주소 전체, 공급자 원문은 서버 로그에 기록하지 않습니다.

## 배포

1. Supabase SQL Editor에서 `repo-root/sql/operations-assistant.sql` 실행
2. GitHub Secrets 설정: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `AIAPIFLOW_API_KEY`
3. main push 시 Actions가 배포하거나 직접 실행:

```bash
supabase secrets set AIAPIFLOW_API_KEY="$AIAPIFLOW_API_KEY" --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy operations-assistant --project-ref "$SUPABASE_PROJECT_REF"
```

JWT 검증을 끄는 `--no-verify-jwt`를 사용하지 않습니다.
