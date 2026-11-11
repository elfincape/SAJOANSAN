# 기존 웹 구조 개선 운영 적용 결과

기준: 2026-11-11 23:40 KST. 사용자 결정에 따라 **기존 웹과 Supabase를 운영 기준으로 복구**했다. ERP 이전을 재개하지 않는다. ERP 코드·DB·배포·비공개 자료는 보존하고 해당 쓰기는 껐다. 이번 결과는 지정된 공통 원장 구조 개선과 운영 복구이며, ERP에서 기획·구현한 모든 도구를 이식했다는 의미는 아니다.

## 1. 소스와 실제 배포

- 운영 웹: https://sajoansan.vercel.app/
- 저장소: `elfincape/SAJOANSAN`, 작업 브랜치 `codex/legacy-web-structure-fix`.
- 시작 main/종전 운영: `de768b8527f4fdfc3a4a3582c83b739c3d821f38`.
- 구조 개선: `ba21567625d5ebdbcae786049e9a0c2dfcf0ecc7`.
- 문서 만료일 접점: `8e2c6fec3d4b4972b41e5247379c7d3a6051b611`.
- 배포 코드: **`4761f7c179dd64c679355dcbc4de14892bed6d3b`**. 작업 브랜치 및 main Push 성공. main은 기존 HEAD에서 fast-forward했으며 강제 Push하지 않았다.
- Vercel production `dpl_9Dn77nLTCsKKpGXQpHkQiMSoaiH4`: READY, Git SHA 일치, `sajoansan.vercel.app` alias 연결 확인.
- production `VITE_LEGACY_COMMON_CATALOG=true`. 기존 ERP 환경값이 남아 있어도 현재 공통 원장 분기는 기존 Supabase를 사용한다.
- Supabase EanCorse `onedrive-auth` v168, `operations-assistant` v50 ACTIVE. `LEGACY_COMMON_CATALOG=true` 적용. 새 계정·과금 자원·권한 대리 토큰 없음.
- 이 보고서의 후속 문서 커밋은 위 실행 코드와 구분한다. 이 저장소에는 기존 RUN-STATE 파일이 없어서 별도 ERP 저장소의 상태 파일을 수정하지 않았다. 최신 운영 상태는 이 보고서다.

## 2. 현재 쓰기 주체와 보존 대조

코스·정차지·납품처·기사·차량·운수사 및 기존 평택 용차 자료의 현재 쓰기 주체는 **기존 웹의 Supabase**다. 공통 원장용 별도 DB나 센터별 사본을 만들지 않았다. 원본의 001/002는 안산/평택 표시와 기존 업무 출처로 보존하며 공통 목록의 권한 경계로 일괄 강제하지 않는다.

ERP 서비스의 `IAN_COURSE_WRITE_ENABLED`, `IAN_REFERENCE_WRITE_ENABLED`, `IAN_CHARTER_ENABLED`를 모두 false로 설정하고 서비스 재기동·실제 설정을 확인했다. `/opt/ian-erp/releases/20261111-c9741fb` 실행 파일과 DB는 보존했다. 현재 ERP는 보존용 조회 상태이며 운영 입력에 사용하지 않는다. reference-refresh를 실행하지 않았다.

최종 ERP 동결 사본 기준: **2026-11-11 23:01:05.119 KST** (`2026-11-11T14:01:05.119Z`). 이후 Supabase 원본 ID·수정시각 지문도 보관 기준과 같음을 확인하고 쓰기를 복구했다.

| 대상 | 건수 | 대조 결과 |
|---|---:|---|
| 코스 | 116 | 신규·누락·업무 필드 차이 0 |
| 정차지 관계 | 820 | ID·관계·순서·조건 차이 0 |
| 납품처 | 884 | 미연결 포함, 신규·누락·업무 필드 차이 0 |
| 기사 | 96 | 원본·보건증 현재값 포함 차이 0 |
| 차량 | 90 | 원본·연결 필드 차이 0 |
| 운수사 | 13 | 원본·업무 필드 차이 0 |
| 평택 용차 | 5,313 | ID·payload·version·updated_at 행별 지문 차이 0 |

용차 기간은 2026-08-11~2026-10-15, 원래 월별 archives는 0건이다. ERP의 가져온 작업 3개 외 추가 파일·분석 실행·미저장 행은 확인되지 않았다. 최신값이 같은 것으로 확인되어 **원본 재이관·업무 행 덮어쓰기·삭제를 하지 않았다**. 과거 Supabase 사본을 ERP에 다시 적용하지 않았다.

## 3. 실제 적용한 DB·Edge·전환 조치

1. `repo-root/sql/legacy-common-catalog.sql` 준비 migration 적용: 원장 5종 `deleted_at`, 연결 `condition_modes`, hard-delete 보호, `security_invoker` course_view, 기존 접근 판정 보완, 원자적 `legacy_save_route_stops`.
2. OneDrive 진행 중 저장과 미완료 만료일 저장을 확인하고 이번 전환용 connection 잠금 사용. 원본/문서/FK/파일은 보존.
3. ERP 쓰기를 끄고 최종 원본 대조 후 문서·운영 도우미의 기존 원장 어댑터를 배포.
4. `repo-root/sql/legacy-common-catalog-activate.sql`을 **공식 Supabase SQL Editor에서 실행·확인**. MCP 확인은 만료됐고 실제 trigger/grant로 미실행을 확인한 뒤 같은 MCP 요청을 반복하지 않았다. 에디터 내용과 승인 파일의 전체 문자열을 대조하고 공식 `Run query` 확인을 거쳤다. 실행은 2026-11-11 23:30 KST경, 23:30:22 KST 읽기 확인에서 반영 확인.
5. 3개 `ean_catalog_frozen`과 용차 행 변경 차단 2개만 제거. 원장 RLS, FK, 이력, no-truncate 및 soft-delete 보호 유지. authenticated에 필요한 insert/update, 정차지 관계 delete만 복구. 기사 등 원본 hard delete는 허용하지 않음.
6. `save_pyeongtaek_dispatch_profiles`와 원자적 정차지 저장은 authenticated 실행 허용, anon 거절. 폐기된 `notion_points_apply`/`notion_graph_apply`는 계속 실행 거절. 기존 수동 배차의 revision·허용 필드 검사는 유지.
7. 문서 `erp_document_catalog_enabled=true`는 UUID·문서 메타데이터 호환용으로 유지한다. **현재 만료일 쓰기/조회는 legacy 어댑터가 실제 요청자 토큰으로 Supabase 기사 원본에 수행**한다. 원문 당시 날짜와 파일 성공/원본 저장 충돌의 부분 상태·재시도는 보존한다.
8. 운영 frontend 배포 후 이번 작업 holder의 OneDrive 잠금만 해제했고 남은 행 0건을 확인.

SQL Editor 실행은 migration 이력을 자동 생성하지 않는다. 이력 0건을 미실행으로 해석하거나 재실행하지 않는다.

파일 SHA256:

- 준비 SQL: `05f2bfbc1e621dffa1c4b5294391b043523aae4fb9c3ae935d6262773951c5d6`
- 활성화 SQL: `c02dbc5e7fbd6ad1bb8da8bcdcc1c8049cca1bb5a915e36007ee929d332b66e8`
- OneDrive 배포 반환 지문: `02d2bd636283701a4a297ec91330b472e7713adb1a1a9c3a5ec4288f6450dcc4`
- 운영 도우미 배포 반환 지문: `ed3161558c165191f2762291afbe4846bc9fd690f4b9e312f315e69a04af8948`

## 4. 기존 웹에서 해결한 부분

- 정확한 로그인 UUID→활성 프로필→기존 역할/명시적 접근 규칙을 재사용. 이메일·이름으로 OP를 부여하지 않음. OP 공통 원장 전체 관리와 일반 직원의 명시적 거부·viewer·비활성 제한 유지.
- 공통 목록의 전체/안산/평택/미분류 속성 필터와 접근 판정을 분리. 센터가 달라도 ID로 연결된 원본을 읽는다.
- 공통 납품처 수정과 연결별 지정/상속/명시적 비움을 구분. 빈 값·0·false를 기본값으로 다시 채우지 않음.
- 정차지 순서·교체를 원자 저장하며 연결 ID 유지, stale 충돌·동일 재시도 처리. 후보 재조회가 기존 기사·차량 연결을 지우지 않음.
- 코스/납품처의 현재 브라우저 내 초안·목록 문맥과 늦은 응답 방어, updated_at 비교 저장. 모든 원장에 새 범용 저장 엔진을 도입한 것은 아님.
- 대시보드·거리 화면의 원본·검색/상세·이관배송·코스 출력·운영 도우미는 기존 테이블/공통 유효값을 사용. 거리 알고리즘·모델을 변경하지 않음.
- 평택 용차의 ERP 이동 안내를 제거하고 기존 파서·수정·저장·월별 보관 화면을 복구. 이전 운영값 5,313건을 그대로 사용.
- 예전 웹 탭이 ERP 중계 API를 요청하면 409 새로고침 필요를 반환하도록 차단. 오류 때 ERP/과거 사본으로 조용히 대체하지 않음.

## 5. 실제 확인과 격리 확인

**운영 실제 확인**

- Ego Lite의 기존 OP 로그인 상태에서 대시보드 585행 표시, 코스 공통 목록·편집 패널, 납품처 목록·실제 기존 원본의 편집 패널 열기 확인. 값을 수정·저장하지 않음.
- `user_profiles`, 권한 context RPC, `course_view`, routes/stops/points/drivers/vehicles/companies 요청 200. 확인한 화면에서 ERP 중계 요청 없음.
- 코스 속성 옵션 전체/안산/평택/미분류와 안산 선택 확인. 날짜/전체 속성 조합을 모두 실사용 검증했다고 주장하지 않음.
- 용차 실제 기존 웹의 DB 불러오기 성공: **5,313운행**, `charter_trips` 페이지 조회 200. 자동화의 날짜 입력이 빈 값으로 남아 전체 조회가 실행됐으므로 특정 기간 필터 검증으로 계산하지 않음.
- 비로그인 ERP 중계 API, OneDrive status, 운영 도우미 요청 모두 401. 유료 모델 호출 없음.
- DB 실제 RLS 6개 유지, course_view security_invoker, 위 grant/차단, 문서 호환 설정, 전환 잠금 해제 확인.
- 기존 ERP HTTPS는 인증서 검증을 켠 상태로 200. nginx·검색 엔진·검색 API·ERP 전용 PostgreSQL 실행 상태 정상.

**이 작업에서 실행한 관련 격리/코드 검사**

`node tests/charter-db.test.mjs`, `node tests/charter-storage.test.mjs`, `node tests/onedrive-server.test.mjs`, `node tests/driver-documents.test.mjs`, `node tests/operations-assistant-security.test.mjs`, `node tests/unassigned-delivery-points.test.mjs`, `LEGACY_CATALOG_ONLY=1` 및 기존 PGlite 모듈로 `node tests/portal-permissions.test.mjs`, TypeScript `tsc -b app`, `VITE_LEGACY_COMMON_CATALOG=true` Vite build 통과. 운영 Vercel build도 READY.

권한 허용/거절·공유 원본/연결 조건·충돌/롤백·문서 부분 성공·재시도는 격리 자료/모의 transport로 확인했다. 기존 React+모의 API의 초안/필터/스크롤 검증은 최초 구조 개선 보고서에 기록했다. 이를 운영 API 저장 성공으로 보고하지 않는다. 전체 회귀·전 직원 로그인·실제 OneDrive 업로드·운영 도우미 유료 분석은 실행하지 않았다. 기존 전체 portal-permissions 과거 버전 보호 검사와 로컬 ESLint 모듈 부재 한계는 최초 보고서 그대로다.

## 6. 사고·보존·복구

작업 중 1GB 서버에서 용차 데이터를 한 번에 JSON 집계한 조회 후 서비스 응답이 지연됐고, **22:49:28 KST 커널 OOM으로 PostgreSQL 프로세스가 종료된 기록**을 확인했다. 해당 조회 방식은 서버 자원에 부적절했다. 개별 PID와 조회의 직접 대응까지 확인한 것은 아니지만 시점상 관련성을 배제할 수 없다. 자동 승인 검토가 같은 집계 재실행을 거절했고 반복하지 않았다. 가용 메모리·클러스터 상태를 확인해 중단된 ERP 전용 PostgreSQL만 시작했다. 서버 전체 재부팅·nginx/검색 중지·자료 복원 덮어쓰기는 하지 않았다. 이후 개별 행 지문 스트리밍으로 대조를 완료했다.

최종 상태: 메모리 가용 509MB, 디스크 잔여 406MB/96% 사용, 서비스 정상. 디스크 공간이 적으며 임의 삭제·증설하지 않았다.

비공개 복구 위치(커밋 제외): 업무 PC 작업 루트의 `.local-tools/legacy-production-20261111/private/`.

- Supabase 원본 6종과 문서 4종, schema/function/policy/grant/view, Edge 이전 버전, ERP 설정/DB 사본 보관.
- 문서 사본: driver_documents 373, company_documents 59, driver_document_pdfs 33, onedrive_uploads 450. 실제 파일 바이트나 OneDrive 파일은 이동·삭제하지 않음.
- `erp-frozen.dump`: 5,019,034바이트, SHA256 `cf61976f4add6aa6acd931b8ffdffb1caabff5ef9da856e0c667d53eff249d74`. pg_restore 목록 302줄 확인. 별도 DB 전체 복원 시험을 추가 실행한 것은 아님.
- 최종 공통 원본 `erp-frozen.json`, `frozen-comparison.json`, 용차 행 지문 및 원본 사본 보관. 실제 설정·개인정보·직원 UUID는 보고서/커밋에 포함하지 않음.
- 임시 SSH 키 제거 후 `/root/.ssh/authorized_keys`가 원래 99바이트 파일과 정확히 일치. 작업용 로컬 개인키·공개키 4개도 제거.

장애 시 먼저 **현재 Supabase의 새 변경·문서 journal·이력과 ERP 보존 DB**를 백업한다. 기존 웹 쓰기를 필요한 범위로 정지한 후 원인을 수정한다. 과거 DB를 덮어쓰거나 ERP 쓰기를 즉시 재개하지 않는다. 활성화 전 frontend/Edge는 ERP를 전제로 하므로 단순 Vercel rollback만 하면 안 된다. `LEGACY_COMMON_CATALOG=true`를 유지하는 검증본을 사용하고, DB 정의 복구가 필요하면 새 deleted_at/condition_modes/업무값을 보존한 채 보관 정의와 차이를 검토한다. 양쪽을 동시에 쓰게 하지 않는다.

## 7. 남은 확인과 사용자 동작

운영 적용 자체는 완료했다. 사용자는 기존 웹을 새로고침한 뒤 실제로 필요한 코스 또는 납품처 변경 1건을 저장하고 재조회해 확인하면 된다. 임의 시험 변경은 하지 않았다. 일반 직원별 현재 로그인과 실제 업무 저장, 실제 OneDrive 업로드 및 전체 소비 도구 실사용은 아직 확인하지 않았다.

ERP에서 정리한 공통 원장·속성/권한 분리·연결 조건·충돌 사례를 필요한 범위로 기존 코드에 반영했다. ERP 전체 도구/UI·작업 재개 엔진을 모두 이식한 상태는 아니다. Notion·Windows 이전·다른 도구 개발을 자동 재개하지 않는다. Ego Lite 업데이트 알림은 있었으나 이번 작업에서 브라우저를 업그레이드하지 않았다.
