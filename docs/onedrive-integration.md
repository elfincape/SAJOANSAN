# 기사 서류 OneDrive 연동

DB에 `repo-root/sql/driver-documents.sql`, `repo-root/sql/onedrive-integration.sql` 순으로 적용합니다. 서버 전용 `onedrive_settings` 행에 6종류의 폴더 공유 주소와 소유자 drive ID를 등록합니다. 공유 주소는 저장소에 커밋하지 않습니다.

Supabase secrets: `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`. 앱은 개인 Microsoft 계정을 지원하고 Web redirect URI는 `https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/onedrive-auth/callback`이어야 합니다. 관리자만 기사관리에서 연결할 수 있습니다. delegated `Files.ReadWrite offline_access` 동의를 사용합니다. 이 Microsoft 권한은 계정 파일 전체를 허용하므로 서버는 등록된 6개 폴더에만 업로드하도록 제한합니다.

GitHub Actions에는 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`가 필요합니다. 공개 callback 때문에 gateway JWT 검증을 끄지만 callback 외 모든 작업은 함수에서 Supabase 사용자 인증, 활성 상태, 역할, 기사 RLS 접근을 검증합니다. refresh token은 서비스 키에서 파생한 AES-GCM 키로 암호화하고 서버 전용 테이블에 저장합니다. Supabase 서비스 키를 교체하면 관리자 OneDrive 재연결이 필요합니다.

사진은 JPG/PNG/WEBP, 최대 10MB입니다. 보건증 만료일을 기사 기본 정보에 먼저 저장합니다. 기존 사진 교체 시 이전 파일은 OneDrive에 보존합니다. 중단된 업로드는 `onedrive_uploads`에 기록하고 동일 요청 재시도로 복구합니다. DB 저장까지 성공한 경우에만 화면에 저장 완료를 표시합니다.

검증: `node tests/onedrive-server.test.mjs`, `node tests/driver-documents.test.mjs`, `node tests/driver-health.test.mjs`. 운영 적용 후 관리자로 연결하고 동의를 완료해야 실제 업로드를 사용할 수 있습니다.
