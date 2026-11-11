# 기존 업무 웹 구조 개선 결과

기록일: 2026-11-11 KST. 상태: **코드 수정·격리 검증 완료, 운영 미적용**.

이번 작업은 SAJOANSAN 기존 웹 개선이다. Rust 개발, ERP DB 이관, 쓰기 주체 전환, main 병합, 운영 SQL 적용, Edge/Vercel 배포를 수행하지 않았다. 기존 ERP 코드·자료·배포와 운영 쓰기 차단을 보존했다.

## 1. 저장소와 기준

- 저장소: `elfincape/SAJOANSAN`
- 작업 브랜치: `codex/legacy-web-structure-fix`
- 시작 및 재확인한 원격 main: `de768b8527f4fdfc3a4a3582c83b739c3d821f38`
- 구현 커밋: `ba21567625d5ebdbcae786049e9a0c2dfcf0ecc7`
- 보고서 커밋은 이 구현 커밋 다음에 별도로 기록한다. 최종 전달 SHA는 이 보고서가 포함된 브랜치 HEAD다.
- 확인한 실제 운영 Vercel 배포: `dpl_QTDhoH4iZqhX28yYPoA679sYzno9`, main의 위 시작 커밋. 운영 주소: https://sajoansan.vercel.app
- `codex/op-common-catalog`와 `d89d7e4`의 이력·차이를 확인했다. 해당 커밋은 인계 문서 변경이며 ERP 읽기 어댑터는 선행 변경이다. 통째로 병합하지 않았다.
- 작업 시작 시 추적 파일 변경은 없었다. 기존 비추적 로컬 로그와 참고 ERP 저장소의 사용자 작업은 보존하고 커밋에서 제외했다.
- GitHub 배포 workflow의 push 대상은 main이다. 이 작업 브랜치는 `vercel.json`의 `git.deploymentEnabled`에서 false로 지정했다. 배포 명령과 workflow_dispatch는 실행하지 않는다.

## 2. 좁혀 확인한 문제와 원인

| 입력·사용자 조건 | 기대와 수정 전 동작 | 원인·최소 수정 |
|---|---|---|
| 활성 관리자, 안산 화면에서 평택·미분류 공통 원본 탐색 | 권한 있는 공통 원본을 조회해야 하지만 페이지·쿼리에 선택 센터가 중복 적용됨 | AdminPage/feature-access와 공통 목록의 권한 판정 및 속성 필터를 분리. 전체·안산·평택·미분류 제공 |
| 일반 직원에게 명시적으로 전체 범위 허용 | 설정된 범위로 수정해야 하지만 기본 센터 소속 조건이 추가로 적용됨 | 기존 permission 함수와 두 프런트 미리보기에서 공통 원장 5종에만 중복 소속 상한 제거. 역할·명시적 거부는 유지 |
| 서로 다른 속성의 코스와 같은 납품처·기사 연결 | 안정 ID로 이어져야 하지만 course_view의 center_code 동등 조건으로 연결이 누락됨 | 실제 운영 view 정의를 읽고 ID 조인으로 정정한 SQL 준비. 호출자 RLS는 유지 |
| 공유 납품처 기본값 존재, 한 코스에서 명시적 비움 | 빈 값이 유지돼야 하지만 COALESCE로 기본값이 다시 나타남 | 연결에 condition_modes 추가 준비. inherit/set/clear와 기존 모드 미지정 호환 계산을 view·출력·편집에 적용 |
| 정차지 순서 변경 중 두 번째 저장 실패 | 전체가 원복되어야 하지만 별도 요청의 임시 음수 순서가 남을 수 있음 | 기존 route_stops를 사용하는 단일 트랜잭션 RPC 준비. 연결 ID 유지, 읽은 스냅샷 비교, 동일 요청 재시도 무변경 반환 |
| 운수사 변경·후보 갱신 | 기존 기사·차량 선택을 보존해야 하지만 첫 후보 또는 빈 ID로 변경됨 | RouteForm 및 이관배송의 자동 초기화 제거. 현재 후보에 없는 기존 연결도 표시 |
| 코스/납품처 편집 중 다른 상세 왕복 또는 늦은 응답 | 입력이 남아야 하지만 선택 변경·재조회가 초안을 교체함 | 사용자·원본별 메모리 초안, 선택/필터/스크롤 보존, 응답 세대 비교, 저장 중 중복 제출 방지 |
| 원본 조회 실패·작은 서버 페이지 상한 | 오류와 전체 결과를 구분해야 하지만 대시보드·도우미가 다른 쿼리/빈 결과로 대체하거나 조기 종료함 | 확인된 컬럼/view 사용, 오류 전달, 실제 수신 건수 기반 페이지 이동, 기존 fetchAllRows 재사용 |

코드 경로와 합성 자료에서 확인한 재현이다. 사용자 실제 업무값을 변경해 재현하지 않았다.

## 3. 권한 판정 수정 전후

기존 체계 그대로 `Supabase Auth user.id → user_profiles.id/active/role → operations_permissions_context → operations_resource_allowed → 테이블 RLS`를 사용한다. 새 직원 체계·자료별 ACL·service-role 대리 요청은 없다.

운영 읽기 확인에서 사용자 본인 계정은 정확한 Auth UUID=프로필 ID로 연결된 1건의 활성 admin이었다. 이메일은 요청된 계정을 읽기 대조하는 데만 사용했으며 권한 부여 코드에 넣지 않았다. UUID·개인정보는 이 보고서에 적지 않았다.

- OP는 기존 admin 판정으로 공통 원장의 분류·미분류를 관리한다. 별도 이메일/이름 비교, 역할 승격, 관리자 우회를 추가하지 않았다.
- 일반 직원의 기존 read/edit 규칙, member_overrides none/read/edit, own/all, viewer 역할의 수정 제한, 비활성·admin_only를 보존했다. 수정 권한의 관리 동작에는 삭제 표시가 포함된다.
- 기존 함수는 admin을 개인별 거부보다 먼저 허용한다. 이는 OP 전체 관리 계약과 일치하는 기존 예외다. 일반 직원의 명시적 거부는 그대로이며 전체 거부 규칙을 삭제하지 않았다.
- 화면 진입은 공통 원장 전체의 접근 가능 여부로, 개별 수정은 해당 원본 속성으로 판단한다. DB는 요청자 auth.uid()로 다시 판정한다.
- 미분류 행은 DB 정책의 기존 `coalesce(center_code,'')` 의미를 유지하고, context에 read_unclassified/edit_unclassified를 추가한다. 화면의 미분류 조회는 NULL 속성이다. 기존 코드값 001/002는 안산/평택 표시값이며 새 운영 경계나 별도 DB를 만들지 않는다.
- 인증 캐시를 로그인·로그아웃·사용자 변경 때 무효화하고 30초 후 재조회한다. 이미 열린 화면의 즉시 권한 변경 push는 추가하지 않았다. DB가 매 요청의 최종 경계다.
- `legacy_save_route_stops`는 security invoker이며 코스 수정 권한 확인·행 잠금 뒤 실행한다. 테이블 권한·RLS·기존 쓰기 차단을 우회하지 않는다.

## 4. 공통 원본·연결과 소비 화면

| 소유 위치 | 보존·수정 내용 |
|---|---|
| delivery_points | 주소·연락처·공통 조건은 같은 ID의 원본 수정. 바뀐 필드만 보내며 미변경 NULL/빈 문자열/0/false/시간 원문을 보존 |
| routes | 기존 원본 ID와 기사·차량·운수사 FK 유지. 이름 유사 병합, 후보 자동 선택, 관계를 통한 센터 속성 복사 없음 |
| route_stops | 납품처 교체는 delivery_point_id만, 순서는 같은 연결 ID의 stop_order만 변경. 관계 제거가 납품처 삭제로 이어지지 않음 |
| 연결별 조건 | delivery_method/access_method/delivery_location/deadline의 inherit/set/clear. 미지정 모드는 종전 NULL 상속 규칙을 유지 |
| 원본 삭제 | 5개 원장 deleted_at로 삭제 표시. 준비 SQL은 실제 DELETE를 거절해 FK·서류·과거 참조 유지. 목록 후보는 삭제 원본 제외, 기존 연결은 식별 가능 |
| 과거 결과 | 확정 출력·배차 snapshot을 일괄 갱신하거나 다시 계산하지 않음 |

소비 경로:

- 대시보드: 기존 Supabase course_view 직접 조회. 원본 저장 후 필요한 데이터를 다시 읽고, 프런트 임의 병합으로 명시적 비움을 되살리지 않는다.
- 착지별 거리: 기존 delivery_points 직접 조회, 삭제 후보 제외·페이지 누락 방지. 거리 알고리즘 불변.
- 네이버 코스 거리 화면: 기존 코스 출력/원본 조회 경로와 course_view·출력 유효값을 재사용한다. 거리 요청·브라우저 계산은 변경하지 않았다.
- 통합검색: 기존 operations_search와 RLS 유지, 원본 상세 테이블을 5종 allowlist로 제한. 속성 검색 필터는 접근 권한을 대신하지 않는다. 현재 ERP 분기는 보존하고 아래 legacy 모드에서 기존 테이블을 읽는다.
- 이관배송: 코스는 선택 업무 속성으로, 연결 후보는 호출자가 볼 수 있는 공통 원본으로 조회. 후보 오류는 전달한다. 과거 erp_* UUID를 조회에서 보존한다. legacy 모드로 명시 저장할 때 같은 안정 ID를 기존 FK에 기록하고 erp_* 선택을 해제한다. **이에 앞서 ERP 신규 ID가 기존 원장에 보존되는 대조가 필수다. 없는 UUID는 FK 오류로 실패하며 가짜 원본을 만들지 않는다.**
- 운영 도우미: 기존 요청자 토큰으로 Supabase 원본·course_view 조회. legacy 공통 모드의 기사·차량·운수사 참조는 코스 속성과 별개다. 실패를 빈 자료로 대체하지 않는다. 모델·프롬프트·유료 호출 변경 없음. 기존 ERP 어댑터 출력의 pallet_count 호환도 유지한다.
- 기사·차량·운수사 참조는 같은 테이블을 다시 읽는다. 동기화 서비스는 추가하지 않았다.

## 5. 작업 문맥 보존

- 코스 목록: 기존 AG Grid 상태·열 설정·정렬/필터/선택/스크롤을 사용자·센터 작업 문맥으로 보존한다.
- 코스 편집: 원본별 초안과 최초 수정시각을 유지한다. 닫았다 다시 열어도 새 조회값으로 초안을 갈아끼우지 않는다.
- 납품처: 원본 전환·작업 공간 왕복 후 검색·선택·스크롤·초안 유지. 늦은 응답은 현재 선택/입력을 덮어쓰지 않는다.
- 코스 연결 편집: 초안과 처음 읽은 연결 스냅샷을 함께 보존한다. 나중 값을 자동 기준으로 삼아 충돌을 우회하지 않는다.
- 코스/납품처 저장: 기존 updated_at을 비교하는 조건부 update. 0행 응답을 성공으로 표시하지 않고 입력을 남긴다. 운영의 set_updated_at 트리거 존재를 읽기 확인했다.
- 신규 코스/납품처: 클라이언트 생성 ID를 재시도에도 유지. 같은 ID·내용의 응답 유실 재시도는 기존 결과를 읽으며 다른 내용의 충돌은 덮어쓰지 않는다.
- 대시보드 상세: 최초 원본 로드 전·저장 중 입력을 막고 에러를 표시한다. 저장 중 모달 닫기로 상태가 꼬이지 않게 한다.
- 초안은 현재 브라우저 실행 메모리 범위다. 새로고침·브라우저 종료·다른 PC까지 영구 보존한다고 주장하지 않는다. 기사·차량·운수사의 기존 저장 엔진 전체에 새 CAS를 추가한 작업은 아니다.

## 6. 검증 명령·결과와 한계

실행한 대표 검사:

```powershell
$env:PGLITE_MODULE=([System.Uri]((Resolve-Path 'app/node_modules/@electric-sql/pglite/dist/index.js').Path)).AbsoluteUri
$env:LEGACY_CATALOG_ONLY='1'
node tests/portal-permissions.test.mjs
node tests/unassigned-delivery-points.test.mjs
node tests/operations-assistant-security.test.mjs
node app/node_modules/typescript/bin/tsc -b app
# app 폴더
$env:VITE_LEGACY_COMMON_CATALOG='true'
node node_modules/vite/bin/vite.js build
# 저장소 루트
git diff --cached --check
```

- 모두 통과. 마지막 프런트 번들 빌드 4.67초. 기존 PGlite node:module/eval·큰 번들 경고는 남아 있다.
- 기존 설치된 PGlite에서 실제 준비 SQL 실행: authenticated RLS의 목록·상세·직접 수정 허용/거부, admin 미분류, 비활성, 공유 원본, 다른 속성의 연결, clear/빈 값/0/false, 동일 재시도, stale 충돌, 중간 FK 오류 시 전체 롤백, soft delete 참조 보존·hard delete 거절 확인. 운영 PostgreSQL의 모든 정책을 복제한 전체 리허설은 아니다.
- 실제 TypeScript 도메인 코드로 미변경 값 보존·출력의 inherit/set/clear 확인. 도우미 실제 REST 함수는 작은 페이지 상한과 403 응답을 모의 transport로 검증했다. 실제 모델 호출은 하지 않았다.
- Ego Lite의 격리 작업 공간에서 실제 React 화면 + 모의 Supabase API 사용. 전체/안산/평택/미분류 목록, 운수사 변경 후 기존 연결 유지, 코스 초안 닫기/복귀, 40001 저장 실패 후 초안, 납품처 전환/복귀 및 검색·선택·scrollTop 300 보존을 assertion으로 확인했다. 이 결과는 **실제 운영 로그인·API 저장 성공이 아니다**. 검사 공간과 임시 서버는 종료했다.
- 운영은 Supabase 스키마·정책·권한·계정 관계와 Vercel 배포 메타데이터만 읽었다. 실제 사용자 토큰의 모든 직원 직접 API 검증·운영 저장·전체 소비 화면 실사용은 미확인이다.
- 기존 전체 portal-permissions PGlite 블록은 과거 operations-explicit-scope 함수 버전 보호 검사에서 실패했다. 해시 보호를 바꾸거나 기존 이력을 수정하지 않았다. 이번 준비 SQL과 관련 검사는 LEGACY_CATALOG_ONLY로 구분했고 전체 회귀 통과로 보고하지 않는다.
- ESLint 실행은 로컬 eslint 모듈 부재로 불가했다. 새 패키지 설치 없음. UI 정적 검사는 기존 Impeccable 0.1.16 detect 대상 5파일에서 `[]`. 기존 DESIGN/공통 스타일·레이블·포커스/disabled 동작을 검토했고 재디자인하지 않았다.
- 새 테스트 파일/인프라·분업·전체 감사 없음. 기존 검사 3개만 보완했다.

## 7. 변경 파일과 영향

- 권한·진입: `app/src/lib/{auth,permissions,feature-access,erp-course-catalog,catalog-scope}.ts`, `app/src/components/AdminPage.tsx`, `app/src/domain/portal-permissions.ts`, `repo-root/js/portal-permissions.js`.
- 원본·연결: `app/src/lib/{routes,route-stops,delivery-points,drivers,vehicles,companies}.ts`, `app/src/domain/delivery-points.ts`, `repo-root/sql/legacy-common-catalog.sql`.
- 소비: `app/src/lib/{dashboard,distance,course-export,portal-search,transfers}.ts`, `app/src/domain/course-export.ts`, `supabase/functions/operations-assistant/index.ts`.
- 문맥·폼: `app/src/components/{RouteForm,StopForm,DashboardDetail}.tsx`, `app/src/pages/{Routes,RouteEdit,DeliveryPoints,Drivers,Vehicles,Companies,Dashboard,Transfers}.tsx`.
- 검증: `tests/{portal-permissions,unassigned-delivery-points,operations-assistant-security}.test.mjs`.
- 배포 방지: `vercel.json`. 업무 원문·개인정보·환경 비밀·실제 사본·로그·빌드 산출물은 커밋하지 않음.

차분 검토에서 요청자 토큰, security invoker, 고정 검색 테이블, 실제 원본 속성별 수정 판정, 입력 보존·충돌·음수 순서 원복 경계를 확인했다. 회사/기사/차량 참조 조회의 속성 조건을 완화해도 RLS는 유지된다. 관련 없는 도구 API나 권한을 열지 않았다.

## 8. 준비 SQL·운영 적용 순서·복구

준비 파일: `repo-root/sql/legacy-common-catalog.sql`. **운영 미실행**.

포함: 원장 5종 deleted_at, route_stops.condition_modes와 값 검증, 실제 FK 보호용 hard delete 거절, 기존 컬럼 순서를 보존한 security_invoker course_view, 기존 권한 함수/컨텍스트의 좁은 정정, 연결 원자 저장 RPC. 기존 조건 값은 변환하지 않고 모드 미지정 호환값으로 남긴다. 테이블 INSERT/UPDATE/DELETE grant, 기존 차단 trigger 해제, ERP 데이터 재이관은 포함하지 않는다.

운영에 적용하려면 별도 승인 후 다음 순서가 필요하다.

1. 현재 ERP의 전환 이후 변경·신규 UUID·revision·이력·문서 만료일과 기존 Supabase 자료를 비교하고, 기존 웹에서 사용할 현재 공통 원본과 쓰기 소유 관계를 확정한다. 과거 export 전체 재적용 금지.
2. 해당 테이블·FK/정책·view/함수 정의·현재 설정의 비공개 복구 사본을 확보한다. 현재 OneDrive/문서/이관배송의 ERP UUID 참조와 만료일 접점을 함께 대조한다.
3. 별도 승인된 유지 작업에서 준비 SQL 적용 및 실제 호출자 권한 검증. SQL 자체는 기존 쓰기 차단을 유지한다.
4. 이전 전환으로 바뀐 문서 접점·수동 배차 등 동일 원본 수정 경로의 소유를 정리한 후에만, 정확히 필요한 쓰기 차단 변경을 별도 검토·승인한다. 단순 버튼 표시 또는 전체 GRANT로 해결하지 않는다.
5. 관련 Edge와 프런트를 함께 적용한다. 준비된 레거시 경로는 `VITE_LEGACY_COMMON_CATALOG=true`, 도우미 서버는 `LEGACY_COMMON_CATALOG=true`다. **현재 운영 설정은 변경하지 않았다.** ERP 연결 설정/코드도 삭제하지 않았다.
6. 실제 OP·직원 토큰으로 대표 조회/거부를 확인하고 사용자에게 필요한 실제 변경 1건을 저장·재조회하도록 안내한다. 합성 행을 운영에 넣지 않는다.

복구: 현재 DB·변경분·이력·설정을 먼저 보존한다. 프런트/Edge를 직전 검증본으로 되돌릴 수 있으나 쓰기를 자동 재개하지 않는다. SQL 트랜잭션 실패는 원복되며, 적용 후 복구는 보관한 view/함수 정의와 변경 영향을 대조해 수행한다. deleted_at/condition_modes 및 새 업무값을 DROP하거나 과거 DB로 덮어쓰지 않는다. 이전 화면이 명시적 비움을 이해하지 못할 수 있으므로 동시 버전 운영을 피한다.

## 9. ERP에서 참고한 것과 사용하지 않은 것

참고: Ean 03단계의 안정 ID·분류와 접근 분리·직원과 기사 분리, 04단계의 공통/연결 소유·inherit/set/clear·충돌/재시도 사례, 최신 OP 공통 원장·운영 전환 보고서에서 현재 주체와 보존 범위.

사용하지 않음: Rust 서버, 별도 ERP DB, 전체 router/demo, ERP 저장 엔진·outbox·이관 패키지 재실행, OP 대리 토큰, 양방향 동기화. 기존 Supabase 테이블/RLS·React·AG Grid·Sortable·도메인 출력 코드를 재사용했다. ERP는 새 레거시 모드의 필수 조회 중간 서버가 아니다.

## 10. 운영 적용 전에 남은 정확한 조건

- 운영 Supabase의 6개 원본은 authenticated SELECT가 허용되고 INSERT/UPDATE/DELETE가 철회돼 있으며 기존 전환 차단이 남아 있음을 확인했다. 이를 해제하지 않았다. 기존 보고상 현재 주체는 ERP이고 이번에 sajo-search의 최신 행·로그까지 직접 대조하지는 않았다.
- ERP 전환 이후 최신 원본·신규 ID의 보존 대조, 문서 만료일/ERP UUID FK 접점, 같은 필드를 쓰는 남은 도구의 처리 방향을 먼저 확정해야 한다.
- 준비 SQL·실제 직원 토큰 검증·차단 조정·Edge/프런트 배포는 별도 운영 변경 승인 대상이다. 이번 Push는 운영 적용 완료가 아니다.
- 기존 직원의 명시적 예외 규칙은 변경하지 않았다. 활성 admin 대응은 운영 읽기로 확인했지만 일반 직원 각각의 현재 로그인으로 동작 확인하지 않았다.
- 이번 개선은 지정한 권한·공통 원본·소비·문맥 흐름의 코드와 격리 검증 결과다. 모든 도구/전체 ERP/전체 UI가 완성됐다고 기록하지 않는다. 이후 ERP 이전이나 다른 기능 개발을 자동 재개하지 않는다.
