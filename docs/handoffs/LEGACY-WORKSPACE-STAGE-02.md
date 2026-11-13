# 기존 웹 구조 개선 2/7 — 작업 문맥과 초안 보존

- 날짜: 2026-11-13
- 저장소: https://github.com/elfincape/SAJOANSAN
- 작업: `/workspace/legacy-workspace-upgrade`, `codex/legacy-workspace-stage2`
- 시작 커밋: `d1f11207dae329689b1f46750c74ad0e3f90f2ec`
- 전체 진행: [7단계 실행안](../plans/LEGACY-WORKSPACE-UPGRADE.md). 총 7단계 중 2단계 구현·격리 검증·운영 반영 확인 완료. 3~7단계 미착수.

## 구현 결과
기존 공통 셸·내부 이동·코스 표·납품처 상세를 유지하면서 메모리에만 있던 작업 문맥을 같은 탭의 sessionStorage에 연결했다. 코스/납품처 목록의 검색·필터·선택·스크롤과 코스 표의 열/정렬 상태를 보관한다. 코스 편집과 코스별 납품처 편집 창도 새로고침 후 해당 ID가 현재 조회 결과에 있을 때 다시 연다. 납품처 선택 상세는 저장된 초안이 없으면 최신 서버 자료를 다시 읽는다.

초안은 사용자 ID와 작업 대상별로 구분하고 목록 문맥은 사용자·센터별로 구분한다. 사용자/센터 변경 시 화면 상태를 새로 마운트한다. 이 구분은 화면 문맥의 분리이며 원본에 센터 권한을 새로 부여하는 규칙이 아니다.

입력뿐 아니라 수정 전 원본·수정시각·코스 연결 expected 스냅샷·신규 생성 ID를 보존한다. 새로고침을 오래된 초안을 최신 버전으로 자동 승인하는 수단으로 사용하지 않는다. 1단계의 조건부 저장·충돌 비교를 재사용한다. 시간 원문과 inherit/set/clear 조건도 그대로 보관한다.

저장 성공은 초안을 지운다. 모달의 닫기/바깥 닫기는 초안을 보존하고 명시적인 취소는 해당 초안을 버린다. 납품처의 기존 취소 동작도 현재 초안을 버린 뒤 서버값으로 돌아간다. 보관 안내는 서버 저장 완료와 구분한다. 브라우저 저장 실패 시 현재 입력은 유지하고 새로고침 전 저장 필요를 표시한다. 오래된 보관값을 최신 입력처럼 복원하지 않도록 삭제를 시도하며 실패는 경고한다. 깨진 보관값은 무시하고 복원 실패를 알린다.

## 변경 파일
- `app/src/lib/workspace-session.ts`: 버전이 있는 동일 탭 저장·복원·검증·오류 알림. 새 의존성 없음.
- `app/src/components/WorkspaceDraftStatus.tsx`: 초안/보관 실패 표시, 사용자·센터 화면 상태 분리.
- `RouteForm.tsx`, `StopForm.tsx`: 원본 버전과 생성 ID를 포함한 초안 보존·저장/취소 정리.
- `app/src/pages/Routes.tsx`: AG Grid의 기존 상태를 복원하고 편집 창 재연결.
- `DeliveryPoints.tsx`: 목록 문맥과 편집 초안을 분리해 저장, 선택 원본 미확인 시 신규 저장으로 바뀌지 않도록 제한.
- `RouteEdit.tsx`: 코스별 편집 창·스크롤 문맥 보존.
- `app/src/components/Workbench.tsx`: 기존 선택 hook에 초기 선택/목록 로딩 대기 인수 추가. 다른 호출자는 기본 동작 유지.

## 확인한 내용
내부 Linux Chromium에서 실제 React 컴포넌트와 합성 세션/API를 사용했다. 운영 DB 쓰기나 실제 직원 권한 검증은 아니다.

수정 전: 코스 폼 새로고침 시 입력이 원래 값으로 돌아가는 실패를 재현했다.
수정 후 15사례 통과:
1. 코스 초안 새로고침 복원.
2. 사용자 A/B 초안 분리.
3. 복원한 오래된 원본 버전의 저장 거절·입력 유지·최신값 비교 진입.
4. 납품처 검색·선택·스크롤·초안 복원.
5. 다른 페이지 이동 후 원래 초안 복원.
6. 저장 성공 후 초안 제거와 서버값 재조회.
7. 코스별 납품처 초안의 25:30 원문·clear 조건·기존 expected 유지.
8. AG Grid 필터·선택·스크롤 복원.
9. 코스 편집 창과 입력 재개.
10. 취소 후 초안 폐기·닫힌 창 유지.
11. 코스별 납품처 편집 창 재개.
12. 새 원본의 생성 ID가 새로고침 전후 동일하고 저장 결과 한 건 유지.
13. 센터별 목록 작업 문맥 분리.
14. 저장 용량 오류 시 현재 입력 유지·보관 실패 경고·오래된 초안 제거.
15. 깨진 저장 JSON의 안전한 무시와 복원 실패 표시.

명령: `FULL=1 node /tmp/legacy-stage2/browser.cjs`, `npm --prefix app run build`, `git diff --check`, 변경 TSX 대상 Impeccable detect. 브라우저 15사례·빌드·공백 검사 통과, 디자인 진단 `[]`. 실제 화면 스크린샷과 변경된 React 효과/비동기 흐름을 직접 검토했다. 별도 에이전트와 새 패키지는 사용하지 않았다. 기존 번들 경고는 유지한다. 임시 합성 페이지/검사는 `/tmp/legacy-stage2`로 옮기고 커밋하지 않는다.

## 범위와 한계
- 이번 연결 대상은 코스·납품처 관리와 코스별 납품처 편집이다. 대시보드의 기존 URL 필터·셀 sessionStorage, 다른 도구의 별도 저장 흐름은 변경하지 않았다. 모든 도구에 자동 적용됐다는 의미가 아니다.
- 동일 탭 새로고침/이동 복원이다. 서버 초안, PC 간 동기화, 브라우저 종료 후 지속 보관을 보장하지 않는다. 업로드 전 파일 바이트는 이 기능으로 보관하지 않는다.
- AG Grid/납품처 목록 스크롤은 실제 브라우저 검증했다. 코스 연결 상세의 스크롤 보존 코드는 연결했지만 긴 실제 코스의 스크롤과 중첩 iframe 복원은 운영 로그인 후 별도 확인이 남는다.
- DB·RLS·권한·저장 RPC·업무 값 변경 없음. 기존 일반 직원 접근 계약을 유지한다. 실제 운영 계정의 저장 및 Windows 실기 검증은 하지 않았다.
- 1단계의 SQL 기반 저장 검증 근거를 재사용하고 무관한 전체 검사를 반복하지 않았다.
- 다음은 3/7단계의 연결 오른쪽 상세다. 원본 수정과 연결 교체를 구분하고 닫은 뒤 원래 작업 위치로 복귀하도록 이번 문맥 저장을 재사용한다.

## 운영 반영
- PR https://github.com/elfincape/SAJOANSAN/pull/158 — MERGED. Preview 검사 SUCCESS.
- 구현 커밋 `f3ce0244bfd8e667e45b7fc28d109f85e53958fe`, main 병합 `f7e6d655094ab88787ce97885fa341c7da7ba688`.
- Vercel `sajoansan` / `prj_6K1FG1lemrMTwQB8T0tRnpMZfzM7`, production `dpl_3zadgn9UbgGVcwGxMheV7FDAjoG7`: READY, 위 main SHA 및 `sajoansan.vercel.app` alias 확인.
- 공개 자산 `WorkspaceDraftStatus-ieQkRr8d.js`의 저장 prefix·초안 안내·저장 실패 안내 확인. `Routes-B8tW96_z.js`, `RouteEdit-edLuRbd5.js`, `DeliveryPoints-CHjLDF_R.js` 정상 조회.
- 배포 READY 이후 내부 Chromium에서 `/admin/routes.html` → `/login.html`, HTTP 200, 비밀번호 입력 화면 1개, pageerror 0. 실제 직원 로그인/업무 저장은 미실시이며 운영 자료 시험 변경 없음.
- 실행: `python3 /tmp/legacy-stage2/assets.py`, `node /tmp/legacy-stage2/live.cjs`. 이 후속 기록은 문서만 변경한다.
