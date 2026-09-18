# 기사 서류 OneDrive 연동

DB에 `repo-root/sql/driver-documents.sql`, `repo-root/sql/onedrive-integration.sql`, `repo-root/sql/onedrive-document-sides.sql` 순으로 적용합니다. 서버 전용 `onedrive_settings` 행에 6종류의 폴더 공유 주소와 소유자 drive ID를 등록합니다. 공유 주소는 저장소에 커밋하지 않습니다.

Supabase secrets: `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`. 앱은 개인 Microsoft 계정을 지원하고 Web redirect URI는 `https://vvrppotrnpwrwpwqaiet.supabase.co/functions/v1/onedrive-auth/callback`이어야 합니다. 관리자만 기사관리에서 연결할 수 있습니다. delegated `Files.ReadWrite offline_access` 동의를 사용합니다. 이 Microsoft 권한은 계정 파일 전체를 허용하므로 서버는 등록된 6개 폴더에만 업로드하도록 제한합니다.

DB 종류 확장 마이그레이션은 Management API로 배포 전에 적용합니다(https://supabase.com/docs/reference/api/v1-run-a-query). GitHub Actions에는 `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`가 필요합니다. 공개 callback 때문에 gateway JWT 검증을 끄지만 callback 외 모든 작업은 함수에서 Supabase 사용자 인증, 활성 상태, 역할, 기사 RLS 접근을 검증합니다. refresh token은 서비스 키에서 파생한 AES-GCM 키로 암호화하고 서버 전용 테이블에 저장합니다. Supabase 서비스 키를 교체하면 관리자 OneDrive 재연결이 필요합니다.

사진은 JPG/PNG/WEBP, 최대 10MB입니다. 사진 선택 즉시 자동 저장하고, 완료된 경우에만 `DB저장됨`을 표시합니다. 처리 중 `저장중`, 오류 시 `저장실패`를 표시합니다. 보건증은 만료일을 입력한 뒤 사진을 선택하면 날짜와 서류 메타데이터를 함께 저장합니다. 식품운반업과 축산물운반업은 앞/뒤 각 한 장이며, 기존 단일 사진은 앞면으로 표시합니다. 파일명은 `센터_차량번호_기사명_운수사_분류명.확장자`입니다. 센터 이름과 기사 소속 운수사를 DB에서 조회하며, 같은 센터의 활성 코스에서 해당 기사와 연결된 차량번호를 중복 제거·정렬하여 사용합니다. 복수 차량은 `+`로 연결하고 차량/운수사 정보가 없으면 `차량미지정`/`운수사미지정`으로 표시합니다. OneDrive에서 금지한 파일명 문자는 `-`로 바꿉니다. 여섯 지정 폴더 아래 업로드별 UUID 하위 폴더를 만들어 같은 파일명도 이전 사진과 충돌 없이 보존합니다. 과거 사진은 재업로드 시 새 이름 규칙이 적용됩니다. 중단된 업로드는 `onedrive_uploads`에 기록하고 동일 요청 재시도로 복구합니다. DB 저장까지 성공한 경우에만 화면에 저장 완료를 표시합니다.

검증: `node tests/onedrive-server.test.mjs`, `node tests/driver-documents.test.mjs`, `node tests/driver-health.test.mjs`. 운영 적용 후 관리자로 연결하고 동의를 완료해야 실제 업로드를 사용할 수 있습니다.
