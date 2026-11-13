# 기존 웹 구조 개선 1/7 — 공통 저장 계약

- 날짜: 2026-11-13
- 저장소: https://github.com/elfincape/SAJOANSAN
- 작업: `/workspace/legacy-workspace-upgrade`, `codex/legacy-workspace-stages`
- 시작: `fb75f7ff4df977c7b85691fabdac08dab4bc03f6`
- 전체 구상/진척: [7단계 실행안](../plans/LEGACY-WORKSPACE-UPGRADE.md)
- 구현·격리 검증 완료. 운영 배포 확인은 아래 후속 기록으로 구분한다.

## 변경
코스·납품처 상세와 대시보드 셀 수정이 기존 `catalog-scope.ts`의 동일한 ID/updated_at 조건부 저장을 사용한다. 삭제된 원본은 수정 대상에서 제외한다. 최신 수정시각으로 자동 재시도하지 않는다. 같은 변경의 재시도는 조회 가능한 현재 필드가 모두 일치할 때 수렴한 결과를 반환한다. 이는 과거 실행을 증명하는 영속 영수증이 아니며 권한을 우회하지 않는다.

코스 폼은 실제 변경 필드만 보낸다. 코스·납품처 폼의 실패 입력은 유지하고 `최신값 확인` 후 현재값과 내 입력을 비교할 수 있다. `내 입력을 유지하고 최신값 기준으로 재검토`는 저장하지 않는다. 변경하지 않은 필드는 최신값으로 맞추고 내가 바꾼 필드만 유지한 뒤 기존 저장 버튼으로 확정한다. 저장 후 목록 갱신 실패는 저장 자체의 실패와 구분한다.

새 원본 등록은 기존 생성 ID를 재사용한다. 같은 ID의 다른 내용 또는 삭제된 원본을 신규 생성 성공으로 처리하지 않는다. 값 비교는 NULL/빈 문자열/0/false·배열 순서를 구분하고 JSON 객체 키 순서는 무시한다.

## 파일
- `app/src/lib/catalog-scope.ts`: 공통 조건부 수정·읽기·값 비교, 기존 생성 재시도 보강.
- `app/src/lib/routes.ts`, `delivery-points.ts`, `dashboard-edit.ts`: 공통 처리 사용. 코스 연결/순서 RPC는 기존 구현 유지.
- `app/src/components/CatalogSaveReview.tsx`: 두 상세 폼의 최신값 조회·비교·명시적 재검토. 조회 중 대상 변경/해제 시 응답 무시.
- `RouteForm.tsx`, `app/src/pages/DeliveryPoints.tsx`: 수정 필드·초안·읽은 버전 유지, 저장/목록 갱신 결과 구분.
- `EditorStatus.tsx`: 기존 상태 표시에 저장 미완료/입력 보존 추가. 다른 폼의 기존 호출 유지.

## 실제 확인
- 임시 PGlite 합성 검증: 실제 서비스 함수를 로드하고 SQL 어댑터로 조건부 저장/재조회 실행. 수정 전 6사례 중 5실패, 수정 후 9사례 모두 통과. 응답 유실 후 동일 변경 재시도, 다른 변경 거절, 삭제 원본 거절, 값 구분, 동일 생성 ID 재시도/다른 내용/삭제 거절, 수정시각 없음 거절. 실제 운영 RLS 검사가 아니다.
- 내부 Chromium + Playwright, 실제 React 폼과 합성 세션/API: 수정 전 최신값 확인 경로 부재 재현. 수정 후 코스/납품처 충돌 입력 유지, 최신값 조회 자체는 쓰기 0회, 명시적 재검토 후 무관한 최신값 유지, 변경 필드만 저장 확인. 납품처 저장 성공 후 목록 장애에서도 저장된 값과 입력 유지 확인.
- 실행: `node --experimental-vm-modules /tmp/legacy-stage1/check.cjs`, `FULL=1 node /tmp/legacy-stage1/browser.cjs`, `npm --prefix app run build`, `git diff --check`.
- 임시 검증은 `/tmp/legacy-stage1`에 두고 저장소에 별도 테스트 파일/합성 페이지를 추가하지 않음.
- 빌드는 처음 루트 의존성이 없는 분리 작업공간에서 postal-mime/imagescript 해석 실패. 기존 lockfile로 루트/앱 의존성을 설치한 뒤 통과. 패키지/lockfile 변경 없음. 기존 번들 경고는 유지.
- 디자인 검사: Impeccable detect 결과 `[]`; 기존 PRODUCT/DESIGN, 폼 상태/접근성, React 지침에 따라 직접 검토. 별도 에이전트 없음.

## 범위와 한계
DB 스키마·RLS·권한·기존 이력/관계 저장 RPC 변경 없음. 새 outbox/저장 엔진/범용 워크플로를 만들지 않았다. 실제 업무 값은 시험 목적으로 수정하지 않았다. 운영 직원 로그인 후 실제 저장·운영 동시 편집은 미실시. 합성 세션 확인을 실제 권한 확인으로 보고하지 않는다.

2단계는 사용자별 작업 공간·초안 지속성이다. 현재 코스·납품처 상세의 메모리 초안은 동일 문서 이동용이며 새로고침 보존은 아직 아니다. 대시보드 셀의 기존 sessionStorage는 유지. 3~7단계와 다른 도구는 이번 배포에 포함하지 않는다.

## 직접 변경 검토
변경 호출자는 RouteForm, DeliveryPoints, DashboardCellEditor 및 dashboard의 납품처 저장 어댑터다. 기존 요청자 Supabase 세션/RLS를 그대로 사용한다. 최신값 조회는 쓰기가 아니며 재검토 후에도 다음 저장에 revision 검사를 수행한다. 일반 직원 권한을 새로 부여하지 않는다. 원본 수정과 코스 연결 교체를 합치지 않는다.
