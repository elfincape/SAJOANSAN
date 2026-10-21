# 기사 서류 / OneDrive 연결 인계

## 현재 구현
- 기사관리: 6종 사진 선택과 임시 미리보기 (JPG/PNG/WEBP, 최대 10MB, 종류당 1장).
- 보건증 만료일을 drivers.health_certificate_expires_on에 저장.
- 한국 날짜 기준 만료일 < 오늘: 만료, 오늘 <= 만료일 < 다음 달 같은 날짜: 임박.
  월말은 다음 달 마지막 날로 보정. 만료 당일은 '오늘 만료'.
- 만료 → 임박 → 그 외 순으로 정렬하며, 같은 경고 등급은 만료일이 빠른 순.
  대시보드는 주/보조기사 중 더 긴급한 상태를 적용. 사용자가 지정한 필터는 유지.
  코스에 배정되지 않은 기사 자체는 대시보드의 코스 행을 만들지 않으며 기사관리에서 확인.
- 한국 날짜가 바뀌면 열린 화면의 정렬/강조 갱신.
- 기존 DB는 SQL 적용 전에도 기본 기사 편집 가능. 보건증 입력은 비활성화하고 안내.
- OneDrive 연결 전 사진 업로드 비활성화. 파일은 브라우저 메모리에서만 미리보기,
  기사 전환/새로고침 시 폐기. 저장 완료로 표시하지 않음.
- 운영 DB SQL 적용 및 실제 OneDrive 업로드/다운로드는 아직 수행하지 않음.

## 먼저 실행할 SQL
repo-root/sql/driver-documents.sql 전체 실행.
운영 drivers RLS와 user_profiles RLS는 변경하지 않음.
driver_documents는 활성 editor/admin + drivers에서 볼 수 있는 기사만 메타데이터 조회.
브라우저 직접 쓰기는 금지. 파일 내용, 공개 URL, Microsoft 토큰은 저장하지 않음.
서류가 등록된 기사 삭제는 FK가 차단함: 향후 문서 정리 절차를 먼저 제공해야 함.

## 연결에 필요한 정보 (비밀값을 채팅/저장소에 넣지 말 것)
1. OneDrive 개인 계정 여부 및 소유자가 직접 로그인/동의할 수 있는지.
2. 사용할 폴더의 경로와 소유자용 웹 주소. 공개 '누구나' 공유 링크는 불필요.
   서버에서 drive ID / folder item ID로 고정하고 하위 폴더만 사용.
3. Microsoft 앱 등록 유무와 Application (client) ID (공개 식별자).
4. 실제 서비스 도메인과 Supabase 프로젝트 주소: OAuth callback URL 확정용.
5. 관리자가 공유 OneDrive 한 계정에 저장할지 확인.
   현재 설계는 기존 기사관리 권한(editor/admin)을 가진 사용자가 서버를 통해 저장.
   다른 권한 정책이 필요하면 연결 단계에 명시.

## 후속 서버 구현 계약
- Microsoft Graph delegated authorization-code + PKCE/state 검증으로 소유자 동의.
  개인 계정을 지원하는 앱 등록. 앱 전용 폴더를 허용하면 Files.ReadWrite.AppFolder;
  사용자가 지정한 기존 폴더를 사용하면 필요한 delegated Files.ReadWrite 권한을 검토.
  자동 재사용에는 offline_access. 토큰은 서버 보안 저장소에만 보관하며 갱신 토큰 회전 저장.
  client secret은 서버 환경변수/Secret에 직접 입력.
- 시작/콜백 URL과 실제 앱 ID가 정해진 뒤 OAuth UI와 함수 구현/배포.
- mountDriverDocuments(host, { getExpiry, adapter })의 adapter.upload 인자:
  { driverId, kind, file, expiresOn }. 실제 서버 파일 저장 + DB 메타데이터 저장 모두
  성공한 경우에만 resolve. 실패 시 throw. 현재 adapter=null이며 네트워크 전송 없음.
- 서버는 Supabase JWT 검증 → 활성 editor/admin 확인 → caller JWT로 기사/센터 접근 확인.
  요청의 driverId, kind, 만료일, 파일 크기/MIME 및 실제 파일 시그니처를 검증.
  임의 drive/folder ID나 경로를 클라이언트에서 받지 않음.
- 고정 폴더 아래 센터코드/기사UUID/서류종류 구조. 기사명/신분증 번호를 경로에 넣지 않음.
  추측하기 어려운 새 파일명을 사용하고, 중복 업로드는 기존 item을 실수로 덮어쓰지 않음.
- 업로드 성공 후 server-role로 driver_documents의 현재 항목을 갱신.
  보건증 만료일 갱신과 메타데이터 갱신은 DB 트랜잭션/RPC로 원자 처리.
  DB 실패 시 새 파일 정리 또는 재조정 큐. 이전 파일은 성공 후 정리. 동시 업로드 충돌 처리.
- 조회/미리보기/교체/삭제도 동일 권한 검증 후 서버에서 처리.
  다운로드 URL은 영구 저장/공개하지 않음. 로그에 사진, 토큰, 민감 문서 URL을 남기지 않음.
- 401 재동의, 429 Retry-After, 시간초과, 파일/DB 부분 실패 처리와 통합 테스트 후 활성화.

## 확인
node tests/driver-health.test.mjs
node tests/driver-documents.test.mjs

공식 문서:
https://learn.microsoft.com/en-us/graph/auth-v2-user
https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder
https://learn.microsoft.com/en-us/graph/api/driveitem-put-content
