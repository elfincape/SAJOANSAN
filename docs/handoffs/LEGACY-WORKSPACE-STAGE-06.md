# 기존 웹 구조 개선 6/7 — 실패 후 재개

- 저장소: https://github.com/elfincape/SAJOANSAN
- 작업: `/workspace/legacy-workspace-upgrade`, `codex/legacy-workspace-stage6`
- 시작 커밋: `fbb6088619907a3ea590a11fda554afd78535c9a`
- [실행안](../plans/LEGACY-WORKSPACE-UPGRADE.md)의 6단계. 5단계에서 남긴 포털 쿠팡 생성 파일 보관→업무 연결 실패 경로를 연결했다. 7단계는 시작하지 않았다.

## 재현과 구현
기존 코드에서는 파일 보관 후 업무 연결이 실패하면 현재 화면에서만 재시도할 수 있고, 새로고침 뒤에는 대기 실행이 사라졌다. 실제 컴포넌트와 합성 API로 이 실패를 먼저 재현했다.

- 기존 `workspace-session` 저장소로 사용자 ID+업무 ID별 실행 메타데이터를 같은 탭의 sessionStorage에 보관한다. 실행 ID·당시 원본/입력/설정·기존 결과 식별·파일 요청 ID·이름·크기·MIME·SHA256을 유지한다. File 바이트는 저장하지 않는다.
- 재개 시 `operationsFiles.list`의 실제 요청자/요청 ID·파일 상태를 대조하고 `portalRecord`로 최신 업무를 읽는다. 이미 보관된 파일은 다시 업로드하지 않는다. 같은 run_id와 파일 목록이 업무에 저장됐다면 응답 유실로 판단하고 다시 저장하지 않는다.
- 미보관 파일의 바이트가 없으면 해당 파일만 재선택한다. 이름·크기·SHA256이 모두 같아야 같은 요청 ID를 사용한다. 새 내용으로 기존 요청을 덮어쓰지 않는다. OS가 반환한 MIME이 달라도 일치하는 바이트에는 당시 MIME을 복원한다.
- 원본 또는 결과가 바뀌었거나 업무 수정이 허용되지 않으면 저장을 중단한다. 파일 업로드 동안 새 업무/결과가 화면에 도착한 경우도 저장 직전에 재검사한다. 이 검사를 제거한 비교 재현에서 새 결과가 이전 실행으로 덮이는 것을 확인했고, 수정 후 차단했다. 기존 업무 저장의 expectedVersion·멱등·권한 검사는 그대로 사용한다.
- 보관 확인 실패/메타데이터 불일치 시 기존 파일을 재생성하지 않는다. 로컬 저장소 오류는 기존 공통 경고로 표시한다.
- 명시적 확인 후 이 탭의 대기 실행만 해제할 수 있다. 서버 파일·기존 결과·이력을 삭제하지 않는다. 기존 `PortalFiles`를 업로드 불가 보관함으로 재사용해 연결 전 저장된 파일도 확인할 수 있다.

## 변경 파일과 영향 범위
- `app/src/lib/coupang-recovery.ts`: 실행 메타데이터 복원/보관, 저장된 파일 대조, 재선택 파일 지문 확인.
- `app/src/domain/portal-coupang.ts`: 대기 실행의 기존 결과 기준값과 파일 메타데이터 타입.
- `app/src/components/portal/PortalCoupang.tsx`: 재개·확정 결과 재조회·충돌 차단·명시적 대기 해제·첨부 보관함. 사용자/업무 변경 시 별도 컴포넌트 범위로 연결.
- 호출자는 기존 `PortalTaskDetail` 한 곳이다. 공통 업로드 서버, 권한, 업무 날짜·분석·매칭·완료 기준과 다른 도구 로직은 변경하지 않았다.
- 새 DB/SQL/RLS/Edge/스케줄러/서버 초안/백그라운드 worker 없음. 5단계의 파일 최종 저장 영수증과 서버 내용 지문·불변 파일 계약을 재사용한다.

## 확인 결과
내부 Linux Chromium에서 실제 React 컴포넌트와 합성 세션·파일 API·생성 iframe·업무 저장을 연결한 15개 확인이 통과했다.
1. 업무 연결 실패 후 같은 탭 새로고침으로 대기 실행 복원.
2. 보관 완료 파일 재업로드/재분석 없이 업무 연결만 재시도.
3. 업무 저장 응답 유실 후 동일 실행 조회로 중복 저장 없이 수렴.
4. 일부 파일만 저장된 경우 성공 파일 유지, 빠진 바이트만 요구.
5. 동일 이름·크기의 다른 SHA 파일 거절.
6. 정확한 바이트 재선택 후 기존 요청 ID·MIME으로 저장.
7. 더 최신 결과가 있는 업무 덮어쓰기 거절.
8. 대기 해제 후 서버 파일/결과 유지 및 첨부 보관함 접근.
9. 원본 교체 후 오래된 실행 연결 거절.
10. 다른 사용자가 이전 사용자의 대기 실행을 복원하지 않음.
11. 손상된 체크포인트 경고, 가짜 복원 없음.
12. sessionStorage 실패 경고와 현재 메모리의 대기 실행 유지.
13. 이전 저장 파일이 목록에서 확인되지 않으면 재생성 거절.
14. 보관 메타데이터가 달라진 경우 재사용 거절.
15. 파일 업로드 중 도착한 최신 결과 보존, 오래된 연결 저장 차단.

실행:
- `node /tmp/legacy-stage6/browser.cjs`: 수정 전 새로고침 후 재시도 버튼 소실 재현, 수정 후 복원 통과.
- `node /tmp/legacy-stage6/full.cjs`: 위 15개 확인 통과. 임시 합성 검사는 커밋하지 않았다.
- `node /tmp/legacy-stage6/race-before.cjs`: 저장 직전 검사 제거 비교에서 최신 결과 덮어쓰기 재현. 제품 최종 코드는 해당 검사 포함.
- `node tests/operations-files.test.mjs`: 서버 핸들러의 형식·권한·내용 지문·DB 실패 복구·멱등·다운로드·덮어쓰기 거절 통과. DB/Graph는 대역이다.
- `node tests/portal-workflow-settings.test.mjs`: 기존 날짜·요일·캡처 조건 통과.
- `npm --prefix app run build`, `git diff --check`, 변경 TSX의 Impeccable detect 통과(진단 `[]`). 기존 청크 크기/Node 모듈 형식 경고 유지.
- 변경 검토: 호출자 1곳과 저장/조회 경로를 확인했다. 클라이언트 보관값을 권한으로 사용하지 않으며 서버 요청은 기존 로그인·권한·파일 검증·업무 version을 사용한다. 새 권한 부여/외부 전송 경로 없음.

## 한계
- 같은 사용자·같은 탭의 재개다. 브라우저 종료/다른 PC에서의 복원을 보장하지 않는다. 미저장 파일 바이트를 내려받지 않았고 새로고침으로 잃었다면 원래 파일을 재선택할 수 없으므로 대기 해제 후 새 실행이 필요하다. 기존 성공 파일은 유지한다.
- 분석 진행 중 종료된 요청을 서버에서 계속 계산하지 않는다. 체크포인트는 생성 결과를 받은 이후의 파일/업무 저장 단계다. 원본 사진 업로드 자체의 새로고침 재개나 모든 도구의 범용 재개까지 구현한 것은 아니다.
- 실제 OneDrive·AI 호출, 실제 직원 로그인 후 저장, 실제 DB의 동시 세션 시험은 이번에 수행하지 않았다. 위 브라우저 결과는 합성이며 실제 외부 종단 완료라고 보고하지 않는다.
- 서버 목록에서 저장 파일을 찾지 못하거나 접근이 막히면 재개를 차단한다. 기존 파일을 지우거나 접근을 넓혀 해결하지 않는다.
- 다른 도구·Windows·외부 제공자 미확인, Notion 폐기와 이전 단계의 제한은 유지한다.

## 운영 반영
- PR https://github.com/elfincape/SAJOANSAN/pull/162 — MERGED. 구현 `c7523278e5ea2f59fe9b062b03f8d30be9ae29f1`의 Vercel Preview SUCCESS 확인 후 병합.
- main 병합/실제 배포 코드: `9efacc2a078be442bc33c69e116a6734bbaf965f`.
- Vercel `sajoansan` / `prj_6K1FG1lemrMTwQB8T0tRnpMZfzM7`, production `dpl_ChBjUsQeW3Q4sWFTXaYmXy9HUSqo`: READY. 위 SHA와 `sajoansan.vercel.app` alias 확인.
- 공개 `assets/Portal-Dd8DboGE.js`에 같은 탭 재개·coupang-run 체크포인트·SHA256 재선택·저장 중 변경 차단·대기 해제 포함 확인.
- 내부 Chromium에서 `/portal/`, `/admin/routes.html` 모두 비로그인 상태로 `/login.html` 이동, HTTP 200, 로그인 입력 표시, pageerror 0 확인. 실제 직원 로그인/업무 쓰기/외부 파일 호출은 실행하지 않았다.
- 실행: `python3 /tmp/legacy-stage6/assets.py`, `node /tmp/legacy-stage5/live.cjs`. 후속 결과 기록은 문서만 변경한다.
- 총 7단계 중 6단계 완료. 다음은 7단계 업무·일정·보고이며 이번에 시작하지 않는다.
