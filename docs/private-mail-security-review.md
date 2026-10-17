# 개인 메일함 독립 보안 리뷰

독립 검토자는 원본 미삭제, RLS/다운로드 UUID 격리, 공유 권한, 수집기 키,
로그, 부분 실패/중복, HTML/첨부 경계를 정적으로 검토했다. 실제 계정이나
운영 자격 증명은 사용하지 않았다.

- P1: 폴더 비공개여도 개별 파일에 직접 공유가 있으면 이전 검증을 통과했다.
  각 신규/재사용 파일과 다운로드 파일의 `/permissions`를 추가 검사했다.
  폴더 비공개·파일 공개인 다운로드와 재사용을 거부하는 회귀 검증을 추가했다.
- 자체 검토: 수집기 인증키가 메일함 하나에 묶이지 않았다.
  `MAIL_COLLECTOR_MAILBOX_ID`를 필수 서버 설정으로 추가했다. 미설정은 503,
  다른 메일함 요청은 DB 조회 전에 403이다. 키 생성·저장은 아직 미승인이다.
- 자체 검토: MIME 파트 수/디코딩 후 크기 제한을 넘는 메일이 배치를 매번
  중단할 수 있었다. 제한 초과를 집계하고 다음 메일로 진행한다. 원본은 남는다.
- 사용자가 선택한 최근 60일을 SQL 기본값, 문서, 테스트에 반영했다.

독립 검토자가 수정 diff를 다시 확인했으며 검토 범위에서 남은 확정 보안
문제를 발견하지 못했다. 실제 Graph/POP/배포 환경 검증을 대신하는 결과는 아니다.

검증 명령:

```powershell
$env:PGLITE_MODULE='file:///C:/Users/a/Documents/Codex/2026-10-17/task-3/verification/package/dist/index.js'
node --test tests/private-mail-rls.test.mjs tests/private-mail.test.mjs tests/onedrive-server.test.mjs tests/operations-files.test.mjs tests/operations-backups.test.mjs tests/onedrive-api.test.mjs
& 'C:\Users\a\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tests/private_mail_test.py
node --test tests/browser/private-mail.test.mjs tests/browser/smoke.test.mjs
node node_modules/vite/bin/vite.js build
```

DB/서버 테스트 6개, Python 테스트 5개, 브라우저 테스트 6개가 통과했다.
변경 JS lint 및 diff 공백 검사도 통과했다. 빌드에는 기존 대형 번들 경고가 있다.

배포 범위: `repo-root/sql/private-mail.sql`의 신규 테이블 2개/RLS 2개/인덱스
1개/서비스 전용 RPC 2개; 기존 `onedrive-auth` 함수에 모듈 추가; 기존 Vite 앱.
서버에는 `collector.py`, `sajo-mail.service`, `sajo-mail.timer`를 준비했으나
계정·비공개 폴더·자격 증명 승인 전 설치/활성화하지 않는다. CI는 메일 함수
변경만으로 기존 기사 서류 SQL을 재적용하지 않도록 범위를 제한했다.

미검증: 실제 POP 계정 인증과 UIDL 안정성, 실제 OneDrive 상속/파일 권한 응답,
운영 호스트의 SSH/자원 여유, 운영 사용자의 실제 세션 열람. Graph 공유 권한은
검사 직후 외부에서 바뀔 수 있으므로 사용자의 수동 공유를 원자적으로 방지하지 못한다.
형식이 손상된 MIME 전체를 무조건 복구하지는 않으며, 알려지지 않은 파싱 오류는
안전하게 수집 실패로 남긴다. 첨부 바이러스 검사는 제공하지 않는다.
