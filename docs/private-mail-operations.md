# 개인 POP 메일함 인수·운영 절차

## 현재 상태와 경계

코드 구현과 격리된 모의 검증만 수행했다. 실제 POP 로그인·메일 수신, 원격
접속, 운영 SQL, OneDrive 폴더 생성, 새 OAuth 동의, 비밀번호/토큰 저장,
운영 배포와 타이머 활성화는 수행하지 않았다. SMTP 발송은 없다.

기존 Vite/Vanilla JS, Supabase Auth, `onedrive-auth`의 암호화된 토큰과
OneDrive refresh lock / 파일 재다운로드 검증을 재사용한다. 메일 내용은
`private_mailboxes`, `private_mail_messages`의 최소 메타데이터를 제외하고
OneDrive에만 저장한다. 기존 업무 파일/업무 기록에 메일을 섞지 않으므로
통합 검색·검색 서버·AI 브리핑·Notion·운영 백업에 들어가지 않는다.
새 프로젝트/서비스 DB는 만들지 않는다.

## 배포 전에 받아야 하는 입력과 승인

1. **서버 확인 및 작업 승인**: 문서상 기존 Ubuntu 22.04 / 1GB
   `211.233.219.199` (`sajo-search`)를 우선 후보로 한다. 실제 가동 상태,
   관리자 접속 방법, 여유 메모리/디스크/CPU, outbound 995/443 허용은 미확인이다.
   이 정확한 서버에 접속해 `systemctl status sajo-search sajo-search-api nginx`,
   `free -m`, `df -h`, 부하와 기존 제한을 읽기 점검하는 승인부터 필요하다.
   기존 검색 서비스는 최대 400MB + 160MB 제한이라 192MB 수집기를 추가해도
   1GB에서 실제 여유가 충분하다고 가정할 수 없다. 여유 부족이면 별도
   서버 후보와 비용을 보고한 뒤 선택한다. 노트북에는 운영 수집기를 설치하지 않는다.
2. **소유자 확인**: 기존 Supabase Auth의 본인 `user_profiles.id` UUID를
   관리자와 본인이 확인한다. 메일 주소 비교로 UUID를 임의 추정하지 않는다.
   비활성 사용자와 관리자 포함 다른 UUID는 RLS와 다운로드 서버에서 차단한다.
3. **비공개 폴더**: 본인 OneDrive의 공유되지 않은 부모 아래에 전용 폴더를
   만들고 해당 `drive_id`, `folder_id`를 관리자가 확인한다. 공유 링크를 생성하지
   않는다. 기존 OneDrive 연결 계정과 drive ID가 일치해야 한다. 서버는 폴더
   permissions에서 링크/초대/다른 수신자를 발견하거나 확인에 실패하면 거부한다.
   상위 폴더 상속과 조직 정책도 실제 OneDrive에서 확인해야 한다.
4. **초기 범위와 주기**: 준비된 기본값은 최근 30일과 10분이다. 실제 초기
   범위(날짜 또는 일수), 계정 로그인, 최초 한 배치 가져오기, 주기 활성화를
   각각 명시적으로 승인받는다. 현재 어느 것도 활성화하지 않았다.
5. **비밀번호 입력**: `jhs96@eangroup.kr`의 POP 비밀번호는 본인이 서버의
   관리자 전용 입력 경로로 직접 입력한다. 대화·Git·명령 인수·로그에 붙이지
   않는다. 웹메일 로그인 정보를 추출하거나 재사용하지 않는다. 서버의
   `/etc/sajo-mail/pop-password` (root:root, 0600)에 직접 입력하고
   systemd `LoadCredential`로만 작업에 전달하는 구성을 제공했다. 영속 저장도
   별도 승인 대상이며 암호화된 credential을 쓰려면 서버 지원을 먼저 확인한다.
6. **수집기 인증키**: 신규 무작위 32바이트 이상 전용 `MAIL_COLLECTOR_KEY`의
   생성·저장 승인 후 서버 0600 env 파일과 Supabase 함수 secret에 같은 값으로
   주입한다. 키는 여기서 만들지 않았다. 수집기는 Supabase service-role 키,
   Graph 토큰, OneDrive refresh token을 받지 않는다. 이 전용 키도 민감 정보다.
   노출 시 교체하고 수집기를 중지한다.
7. **배포/DB 승인**: 기존 Supabase 프로젝트에 SQL을 검토 적용하고 기존
   onedrive-auth 함수와 Vercel 앱을 배포하는 승인이 필요하다. 새 OAuth 권한은
   구현에서 요구하지 않는다. 기존 연결에 필요한 Graph 기능이 안 되면 임의
   재동의하지 말고 정확한 오류와 필요한 권한을 보고한다.

## 적용 순서 (승인 후 운영자가 실행)

- 기존 DB 백업/스키마 충돌 점검 후 `repo-root/sql/private-mail.sql`을 기존
  SQL 방식으로 적용한다. 새 테이블 둘은 사용자 메일 전용이며 본문은 없다.
  임시 PostgreSQL 검증은 통과했으나 실제 프로젝트의 기존 RLS/기본 grants와
  스키마는 아직 검사하지 않았다. 운영에서 두 테스트 UUID로 읽기/거부를 확인한다.
- 검증한 owner UUID, drive ID, folder ID로 `private_mailboxes`에 한 행을
  관리자 서버 경로에서 삽입한다. `enabled=false`, `status=disabled`를 유지한다.
  초기 범위 승인 후 `initial_days`를 선택한다. `cutoff_at`은 첫 승인 실행 때
  고정된다. 이후 30일보다 오래된 미처리 메일도 그 고정 범위 안에서는 처리한다.
- 기존 `onedrive-auth`를 배포한다. 이 함수는 이미 앱 내부에서 JWT 검증을
  수행하는 구조다. 전용 수집기 키는 JWT가 아니므로 기존 함수 gateway가
  JWT 선검증을 강제하면 호출할 수 없다. 현재 배포 설정을 확인하고
  `--no-verify-jwt` 사용 여부를 명시 승인받는다. 일반 사용자 경로는 기존
  `/auth/v1/user`와 활성 프로필 검증을 계속 수행하며 수집 경로는 전용 키만 허용한다.
  이 변경을 승인하지 않으면 수집기 호출은 차단 상태로 둔다.
- Vercel 변경은 배포 승인 뒤 수행한다. 저장소 push가 자동 preview 배포를
  유발할 수 있어 이번 작업에서는 원격 push/PR을 하지 않았다.
- 서버에 전용 비로그인 `sajo-mail` 계정, `/opt/sajo-mail/collector.py`,
  `/etc/sajo-mail.env` (root:root, 0600), 제공된 service/timer를 준비한다.
  Python 3.10+ 표준 라이브러리만 필요하다. 테스트의 cryptography/PGlite는
  운영 의존성이 아니다. `/var/lib/sajo-mail`은 systemd StateDirectory가 만든다.
- env 필드: `MAIL_BRIDGE_URL=https://<기존프로젝트>.supabase.co/functions/v1/onedrive-auth/private-mail-sync`,
  `MAILBOX_ID=<확인된행UUID>`, `MAIL_COLLECTOR_KEY=<승인후안전주입>`,
  `MAIL_IMPORT_APPROVED=no`. **프론트 VITE_ 환경변수에 키를 넣지 않는다.**
- 실제 가져오기 승인 후 DB `enabled=true`와 env `MAIL_IMPORT_APPROVED=yes`를
  함께 설정하고 **타이머는 여전히 꺼 둔 채** 1회 service를 실행한다.
  소유자 포털 목록/본문/첨부, 원본 메일 보존, 중복 재실행, OneDrive 비공개,
  서비스 자원 사용량을 확인한다. 타이머 활성화는 별도 승인 후 한다.
- 중지는 timer 중지 + DB enabled=false + 승인 게이트 no로 수행한다.
  잠금은 최대 10분 뒤 만료되고 UI는 만료된 running을 중단 상태로 표시한다.
  수집 중 활성화 해제 시 새 게시 RPC는 거부된다. 이미 업로드된 파일은
  지우지 않는다. 전용 파일은 본인 OneDrive에 남으며 운영자 검토 후 처리한다.

## 동작·한계

- POP3S `mail.onnet21.com:995`, 시스템 CA 및 호스트명 검증. 허용 명령만
  발행하며 DELE 명령 자체를 차단한다. TLS 디버그나 POP debug 로그는 없다.
- 한 번에 저장 20건, 기본 작업 검사 240초, 서비스 총 9분. 한 파일/EML 10MB,
  전체 EML+추출 합계 20MB, 최대 50파트. 큰 메일·날짜 미상은 건수를 알리고
  건너뛰며 POP 원본은 남는다. 바이러스 검사·OCR·압축 해제는 하지 않는다.
  검사 위치는 UIDL 해시로 보관해 다음 배치가 이어받는다. 전체 검사가 끝나면
  최신 메일부터 다시 검사한다. 큰 초기 대기열이 있으면 새 메일 표시도 여러
  주기에 걸릴 수 있다. UIDL 위치가 사라지면 최신부터 재검사하며 중복 게시하지 않는다.
- POP는 수신일 필터 기능이 없어 Date 헤더를 사용한다. 날짜 누락/손상은
  제외하고, 늦게 도착한 오래된 Date 메일은 초기 범위 밖이면 제외될 수 있다.
  TOP 미지원 서버는 제한된 RETR로 판단한다. RETR은 POP wire dot-stuffing과
  CRLF를 정상화한 원문을 EML로 보존한다. UIDL 불변성은 공급자 전제다.
- Linux flock + DB lease + 기존 OneDrive 연결 잠금을 사용한다. DB 게시 시
  lease/활성 상태를 행 잠금 안에서 다시 검사한다. UIDL SHA-256은 메일함별 고유다.
  원본/각 파트는 UIDL+EML해시+파트순서 이름으로 보관하고 내용/부모/계정/크기를
  재검증한다. 부분 실패 시 같은 파일을 검증 재사용한다. 이미 다른 내용이 있는
  파일은 덮어쓰지 않는다. 모든 파일 성공 후에만 메타데이터를 게시한다.
- 분산 트랜잭션은 없으므로 업로드 후 DB 실패/수집 중단 시 미게시 파일이
  남을 수 있다. 자동 삭제하지 않고 다음 재시도로 복구한다. 운영자가 임의로
  기존 파일을 수정/이동한 경우 자동 덮어쓰기 대신 실패하며 검토가 필요하다.
- HTML은 허용 태그만 재구성한다. 모든 속성, 링크, 이미지, 스타일, 활성
  콘텐츠를 제거하고 빈 sandbox iframe와 CSP에서 표시한다. 원본은 EML에
  남는다. 일반적인 엔티티가 문자로 보이거나 원래 서식이 일부 달라질 수 있다.
  첨부는 실행/미리보기하지 않고 octet-stream 다운로드한다. 위험/알 수 없는
  확장자에는 `.download`를 붙인다. 다운로드 후 사용자 실행까지 통제하지 않는다.
- 서버 오류는 일반 코드만 기록한다. 제목/본문/첨부명/UIDL/비밀번호/토큰을
  로그로 출력하지 않는다. UI는 계정 상태, 마지막 성공 시각, 오류 및
  대기/제외 집계를 표시한다. 검색은 개인 제목·발신자에 한정한다.

## dot이 읽을 수 있는 최소 권한 경로

자동 연결하지 않았다. 지금 실제 가능한 최소 권한 경로는 **본인이 기존
웹앱으로 로그인해 특정 메일/첨부를 내려받아 원하는 대화에 명시적으로
첨부하는 것**이다. 서버는 선택된 메일의 소유자 JWT와 UUID/RLS를 확인하고
OneDrive 내용을 검증해 돌려준다. dot에 service-role 키나 수집기 키 또는
전역 OneDrive 토큰을 주면 안 된다. 장래 자동 읽기는 선택한 메일만 읽는
사용자 위임 OAuth/짧은 수명의 브로커를 별도 설계·권한 승인 후 연결해야 한다.
기존 OneDrive 연결이 곧 dot 연결이나 전체 메일 열람 동의는 아니다.

## 검증 재현

`node --test tests/private-mail.test.mjs` — 모의 Graph/DB, 부분 실패·중복·변조·UUID·HTML·파일명·공유 폴더 거부.

`python tests/private_mail_test.py` — 테스트용 자체 서명 CA를 사용하는 loopback
POP3S 서버, 원본 보존/DELE 차단/재시도/UIDL 중복/MIME 크기 제한. 테스트에만
cryptography가 필요하며 운영 수집기는 표준 라이브러리만 쓴다.

`PGLITE_MODULE=file:///.../@electric-sql/pglite/dist/index.js node --test tests/private-mail-rls.test.mjs`
— 임시 PostgreSQL(PGlite 0.5.10)에서 SQL을 실제 실행하고 소유자·타인·비활성·anon,
쓰기/RPC 거부, lease 만료·중복을 검증. 애플리케이션 의존성에 추가하지 않았다.

`node --test tests/browser/private-mail.test.mjs` — 기존 포털에서 모의 인증/API로
메일 목록/본문/검색/빈 상태/비소유자 메뉴 숨김, sandbox·외부 요청 차단,
1440px/390px 화면. 스크린샷은 `test-results/private-mail-*.png`.

`node node_modules/vite/bin/vite.js build` — 전체 UI 빌드.
