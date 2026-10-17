# 소유자 전용 임시 클라우드 POP 연결 진단

URL: https://sajoansan.vercel.app/portal/?view=mail

본인 elfincape@gmail.com 계정으로 기존 웹앱에 로그인하면 메일함 행이 없어도
개인 메일함 화면에서 **클라우드 POP 연결 확인** 버튼을 사용할 수 있다.
다른 UUID에는 버튼을 표시하지 않으며 서버에서도 getUser, 확정된 소유자 UUID,
활성 프로필을 검증한다. 화면 진입 시 자동 실행하지 않는다.

클릭하면 `private-mail-diagnostic` Edge 함수가 소유자와 실행 잠금을 확인하고,
Vercel Node 함수 `/api/private-mail-diagnostic`에서 고정 대상
`mail.onnet21.com:995`의 DNS, TCP, 정상 TLS 인증서/호스트명 검증, 첫 POP +OK
인사말까지만 확인한다. USER/PASS/RETR/DELE 및 다른 POP 명령은 보내지 않는다.
호스트·포트를 입력받지 않으며 본문 입력으로 바꿀 수 없다. 인사말 원문,
주소 목록, 토큰, 비밀번호는 반환하거나 로그로 기록하지 않는다.

Gateway `verify_jwt=true`를 유지하며 기존 다른 함수의 설정은 변경하지 않는다.
기존 웹앱 로그인 세션으로만 호출하고 새 키나 사용자 토큰을 만들지 않는다.
서버의 기존 service credential은 기존 onedrive_locks에 별도 이름의 45초
임시 잠금을 원자적으로 얻고 해제하는 데만 사용한다. connection 잠금과
분리되어 기존 OneDrive 작업을 막지 않는다. RLS/권한/스키마/메일함/cron/
영구 자격 증명은 변경하지 않는다.

Node 함수는 기존 로그인 토큰과 Edge가 생성한 실행 잠금 식별자를 받아,
Edge의 소유자 검증 및 원자적 claim을 통과한 경우에만 소켓을 연다.
잠금은 한 번만 claim할 수 있고 만료·재사용·다른 사용자 요청은 거절한다.
Node에 service key나 메일 비밀번호를 배포하지 않으며 원래 Edge 요청이
완료·실패할 때 원본 또는 claim된 잠금을 해제한다. 브라우저는 기존 Edge
API만 호출하고 잠금 식별자를 받지 않는다.

2026-10-17 비교 검사에서 기본 Node TLS는 인증서·호스트명 검증을 통과한
TLS 1.2 RSA AES-GCM으로 성공했고, ECDHE TLS 1.2와 TLS 1.3은 서버가 거절했다.
Deno/rustls와 서버 암호군의 호환성 때문에 소켓 실행만 Node/OpenSSL로 이동했다.
인증서 검증 해제, TLS 1.0/1.1, RC4/3DES, 평문 POP 또는 메일 로그인은 허용하지 않는다.
RSA 키 교환은 순방향 비밀성을 제공하지 않으므로 메일 제공자의 TLS 1.3/ECDHE
지원 개선이 권장된다. 진단 결과에 TLS 버전·암호군·실행 환경을 표시한다.

단계별 제한시간은 3초, 응답은 단계별 성공/실패/미실행, 일반 오류 코드와
시각/경과시간뿐이다. 실패/시간초과에도 소켓을 닫고 잠금을 해제한다.
네트워크 지연으로 connect/startTls가 늦게 완료되어도 뒤늦은 소켓을 닫는다.
사용자 화면은 중복 클릭을 막고 서버 DB 잠금은 별도 isolate의 동시 실행도 막는다.

**실제 클라우드 DNS/TCP/TLS/POP 결과는 사용자가 버튼을 눌러 응답을 받을 때까지
미검증이다.** 자동 테스트는 가짜 transport와 인증 응답을 사용한다. 배포 성공이나
미인증 401은 메일 서버 연결 성공의 증거가 아니다.

검증:

```text
node --test tests/private-mail-diagnostic.test.mjs
node --test tests/browser/private-mail-diagnostic.test.mjs tests/browser/private-mail.test.mjs tests/browser/smoke.test.mjs
node node_modules/vite/bin/vite.js build
```

완료 후 정리: 사용자 결과 확인 뒤 함수 `private-mail-diagnostic`과
`api/private-mail-diagnostic.mjs`, `server/private-mail-probe.mjs`를 삭제하고,
진단 UI/API 모듈과 portal-screen/portal-mail의 임시 소유자 접근 예외를 제거한다.
기존 받은 메일 화면·owner RLS·OneDrive 코드는 유지한다. 종료된 진단 잠금 행이
남았다면 이름과 만료 조건으로만 제거한다. secret/권한/cron 복구는 필요 없다.
정리 배포 전에도 endpoint는 JWT+owner 보호 상태이며 자격 증명이나 메일에
접근할 기능은 없다.

## TLS failure classification

TLS uses Node's default cipher policy, certificate and hostname verification,
and a minimum TLS version of 1.2. Failures expose only
TLS_SETUP or TLS_HANDSHAKE and one fixed category: TIMEOUT, CERT_HOSTNAME,
CERT_VALIDITY, CERT_TRUST, CERT_OTHER, API_UNAVAILABLE, CONNECTION_CLOSED,
PROTOCOL, OTHER. Categories are hints from known runtime error patterns, not
proof of a root cause. Unknown messages remain OTHER. Raw errors, stacks and
credentials are neither returned nor logged. execution_region is an allowlisted
SB_REGION or supported Vercel region value, otherwise unknown. The UI says TLS 연결/검증 rather than
claiming every TLS failure is a certificate validation failure.
