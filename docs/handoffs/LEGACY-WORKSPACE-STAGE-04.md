# 기존 웹 구조 개선 4/7 — 원본의 센터 속성

- 저장소: https://github.com/elfincape/SAJOANSAN
- 작업: `/workspace/legacy-workspace-upgrade`, `codex/legacy-workspace-stage4`
- 시작 커밋: `75616e483ce4230de799e0b461a7cadd65f9740b`
- [7단계 실행안](../plans/LEGACY-WORKSPACE-UPGRADE.md)의 4단계. 구현·격리 검증·운영 반영 확인 완료. 5~7단계는 시작하지 않았다.

## 결과와 범위
기존 공통 코스·납품처의 `center_code`를 원본의 명시적 센터 속성으로 편집하고 표에 표시한다. `센터 속성 필터`는 조회 조건이며 `원본 센터 속성`은 저장 대상 값이다. 필터나 연결된 기사·차량·납품처의 속성을 원본으로 자동 복사하지 않는다. 신규 공통 원본은 미분류에서 시작하며 사용자가 직접 선택한다. 기존 비공통 모드의 생성 기본값은 유지한다.

실제 첫 사용처인 코스·납품처 두 종류에 기존 센터 정의·값·대상·할당을 연결했다. 임의 속성 생성기, 다중 태그, 별도 분류 DB, 직원/기사/차량 전체의 속성 편집은 이번 결과가 아니다. 기존 센터 값과 미분류, OP·일반 직원의 접근 계약을 그대로 사용한다. 센터 속성을 새로운 고정 소속이나 관계의 권한 전파 수단으로 만들지 않는다.

현재 원본의 수정 권한과 저장할 속성의 수정 권한을 각각 확인한다. 일반 직원에게 허용되지 않은 선택지는 비활성화하고 저장 함수에서도 확인한다. 이 UI 검사를 서버 권한 검사로 대신하지 않는다. 서버의 기존 RLS `USING`/`WITH CHECK`, 원본 ID+updated_at 비교, 변경 이력은 유지한다. OP 권한은 기존 서버 응답을 사용하며 이메일·화면 필터로 권한을 새로 부여하지 않는다.

분류만 수정하면 `center_code`만 부분 저장한다. 관계 ID·코스별 순서·inherit/set/clear 조건을 함께 변경하지 않는다. 명시적 미분류는 NULL, 기존 빈 문자열은 원래 값으로 보존한다. 목록과 폼에 알려지지 않은 기존 코드도 표시하며, 기존 권한 응답에서 수정 범위를 확인할 수 없으면 편집을 허용하지 않는다. 알 수 없는 코드를 이름 유사성으로 매핑하거나 일괄 정리하지 않았다.

## 변경 파일과 재사용
- `app/src/domain/catalog-attributes.ts`: 기존 CENTERS의 정의/값, 대상 두 종류, 표시와 접근 조회용 키. 저장 원문과 접근 조회 키를 분리한다.
- `app/src/components/CenterAttribute.tsx`: 공통 속성 필터와 명시적 할당 입력. 기존 select·라벨·권한 함수를 재사용한다.
- `app/src/components/RouteForm.tsx`: 속성 변경의 부분 패치, 출발/도착 범위 확인, 기존 CAS·충돌 재검토·초안 연결.
- `app/src/pages/Routes.tsx`: 기존 AG Grid에 속성 표시, 기존 필터 재사용. 기존 개인 열 상태를 유지한다.
- `app/src/domain/delivery-points.ts`: 초안에 분류 원문을 추가하고, 부분 패치 비교는 새 분류가 아닌 원본의 분류를 기준으로 한다.
- `app/src/pages/DeliveryPoints.tsx`: 같은 납품처 편집기/오른쪽 원본 상세에 분류 입력과 표 표시 연결. 저장 전 변경 비교·최신값 재검토·초안 재개 재사용.
- 새 패키지·DB migration·RLS·서버 API·범용 속성 플랫폼 없음.

## 재현된 문제와 수정
기존 화면에는 원본의 센터 속성을 명시적으로 편집하는 입력이 없어 최초 브라우저 검사가 실패했다. 납품처의 기존 `pointPayload`는 전달받은 새 센터를 비교 기준에도 사용하므로 센터 변경만 있는 패치가 사라지는 구조였다. 원본의 실제 `center_code`로 비교하도록 수정했고 분류만 변경한 저장이 `{center_code: ...}`만 전송하는 것을 확인했다.

초안에 필드를 추가하면서 이전 형식을 버리지 않도록 저장된 원본의 분류를 보충하고 기존 입력을 병합한다. 최신 서버 값을 이전 초안의 기준으로 조용히 교체하지 않는다. 명시적 재검토 전에는 오래된 updated_at 저장이 거절되고 입력이 남는다.

## 확인 결과
내부 Linux Chromium에서 실제 React 컴포넌트와 합성 세션/메모리 API를 사용해 13사례를 확인했다. 실제 운영 직원의 쓰기 검증은 아니다.

1. 코스 분류만 변경하고 기사/차량 ID와 다른 원본 분류 유지.
2. 명시적 미분류 저장은 NULL.
3. 목록 필터 변경 시 원본 쓰기 없음.
4. 새 코스의 기본 미분류 및 기사 선택 후 분류 불변.
5. 납품처 분류만 수정한 부분 패치.
6. 분류 초안의 새로고침 복원, 타 변경 이후 충돌·입력 보존.
7. 제한된 직원이 허용된 대상 분류를 골라야 신규 저장 가능.
8. DOM에서 선택지 제한을 제거해도 저장 가드 유지.
9. 이전 코스 초안의 입력/원본 분류 보존.
10. 이전 납품처 초안의 입력/원본 분류 보존.
11. 새 납품처가 현재 목록 필터에서 분류를 상속하지 않음.
12. 기존 빈 문자열 분류가 다른 필드 수정으로 NULL로 바뀌지 않음.
13. 확인되지 않은 기존 분류 표시·보존, 확인된 수정 권한 없이는 저장 불가.

격리 PGlite SQL 6사례: OP 합성 역할의 분류 변경/미분류, 연결·공유 원본·조건 불변, 오래된 revision 거절, 대상 WITH CHECK 거절, 원본 USING 거절과 전체 조회의 접근 범위, 읽기 전용 수정 거절. 이 검사는 실제 정책의 형태를 사용한 작은 SQL 재현이며 권한 함수와 자료는 합성이다. 운영 OP/일반 직원 RLS 종단 실행으로 보고하지 않는다.

운영 Supabase의 메타데이터를 읽기 전용으로 조회해 코스·납품처 `menu_update`가 RESTRICTIVE이고 기존 `operations_resource_allowed(..., COALESCE(center_code,''))`를 USING/WITH CHECK 양쪽에 쓰는 것을 확인했다. 기존 수정 시각·감사·참조 보존 트리거도 조회했다. 실제 행·개인정보 조회나 분류 시험 쓰기, 정책 변경은 하지 않았다.

실행: `node /tmp/legacy-stage4/browser.cjs`, `node /tmp/legacy-stage4/rls.cjs`, `npm --prefix app run build`, `git diff --check`, 변경 TSX의 Impeccable detect. 브라우저 13/13, 격리 SQL 6/6, 디자인 진단 `[]`. 실제 화면 캡처에서 기존 밀도·표·편집기 유지 확인. 임시 검사는 `/tmp/legacy-stage4`에 두며 제품/테스트 파일로 커밋하지 않는다. TypeScript/Vite 빌드와 공백 검사도 통과했다. 기존 큰 JS 청크 경고는 유지된다. 배포 결과는 아래에 별도 기록한다.

## 남은 범위
- 실제 직원 로그인 후 운영 분류 저장, Windows 실기는 미검증. 운영 자료를 시험 목적으로 변경하지 않았다.
- 기존 권한 컨텍스트에 없는 비활성/미등록 센터 값은 원문 보존·접근 확인 필요 상태다. 이번 단계에서 정책을 넓히거나 미등록 코드를 자동 등록하지 않는다.
- 속성 추가/관리의 전체 일반화나 모든 도구 확장은 하지 않았다. 첫 두 원본의 실제 사용처부터 연결한다는 계획 범위다.
- 기존 1~3단계의 초안·충돌·원본 상세 경로와 접근 제한을 재사용한다. 다음은 5/7단계 파일·결과 버전이며 별도 요청 전 시작하지 않는다.

## 운영 반영 확인
- PR https://github.com/elfincape/SAJOANSAN/pull/160 — MERGED. 구현 `e623b8099872b8c7e465680e71f74300fb6f020d`의 Vercel Preview 검사 SUCCESS.
- main 병합/실제 배포 코드: `e0841515de6cbd7f104c22ff57223f6882a9a92f`.
- Vercel `sajoansan` / `prj_6K1FG1lemrMTwQB8T0tRnpMZfzM7`, production `dpl_FZkhHvgZN1jW2X2q1ope7eu2wkBY`: READY. 위 SHA 및 `sajoansan.vercel.app` alias 확인.
- 공개 공유 자산 `CatalogSaveReview-zAvcUDhp.js`에 센터 속성 필터·원본 할당·기존 값 표시 포함. `Routes-DN2O2t_3.js`, `DeliveryPoints-DFlWt2zr.js`에 대상 분류 저장 가드 포함 확인. 최초 자산 검사에서는 페이지 청크만 검색해 공유 청크를 놓쳤으며, 실제 import 의존성을 조회한 검사로 수정해 통과했다. 제품 코드 추가 수정은 없었다.
- 내부 Chromium으로 `/admin/routes.html`, `/admin/delivery-points.html`, 납품처 linked_detail 주소 모두 비로그인 상태에서 `/login.html` 이동, HTTP 200, 로그인 입력 표시, pageerror 0 확인. 실제 직원 로그인 후 운영 분류 저장은 미실시이며 실제 자료를 임의 수정하지 않았다.
- 실행: `python3 /tmp/legacy-stage4/assets.py`, `node /tmp/legacy-stage4/live.cjs`. 후속 기록은 문서만 변경한다.
- 총 7단계 중 4단계 완료. 다음 5단계는 사용자 요청 후 진행한다.
