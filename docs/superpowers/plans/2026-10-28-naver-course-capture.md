# Naver course capture implementation plan
> **For agentic workers:** Use superpowers:executing-plans. Existing user authorization requests implementation now; execute inline without another approval round.

**Goal:** Excel multi-course import creates real Naver shortest-distance screenshots and batch print output.
**Architecture:** Extend the existing jobs and browser worker; private Storage holds PNGs. Reuse React page, SheetJS, JSZip, pdf-lib.
**Spec:** ../specs/2026-10-28-naver-course-capture-design.md

## Global constraints
Keep legacy distance jobs unchanged. Five intermediate stops including center; fixed order; same starting/ending garage. No new dependencies or repository test files. Check owner and center permissions.

## Review focus
1. Repeated garage and identical courses must not collapse results.
2. Overflow/blank/duplicate names must not silently drop stops.
3. Cancellation and stale leases must not publish another worker's result.
4. Screenshot failures cannot become successful routes.
5. Other users/centers must not read private images.

## Tasks
- [x] Domain: add typed Excel row parsing with source row and stable per-row ID, bounds and roundtrip validation; verify temporary assertions for blanks, overflows and duplicate courses.
- [x] Server: extend jobs with kind/courses; authenticated enqueue and private Storage policies. Extend worker claim, route capture and PNG upload, retaining lease predicates. Verify SQL permissions and existing worker tests plus capture branch checks.
- [x] UI: add tab and import template, per-course results, restore/cancel/retry, signed private images, PNG/ZIP/PDF. Verify TypeScript build and mocked browser multi-course flow including failed course and mobile/light/dark.
- [x] Verify a real roundtrip on Naver, screenshot dimensions and distance card, run existing distance regression checks, review diff, apply schema, commit/push and check deployment.

## Progress (2026-10-28 KST)
Implemented owner/center-scoped queue and private Storage, Excel validation, actual Naver distance-priority selection/capture, React preview/retry/restore, PNG ZIP/PDF. Build, four existing Naver suites and menu permission checks pass. Mocked browser verified two duplicate courses -> two distinct PNG entries/two PDF pages, partial retry preservation, light/dark/mobile. Live public-address roundtrip and maximum five intermediate stops captured; no mathematical shortest-path guarantee. SQL rollback verified unauthenticated rejection, owner/cross-user queue/cancel/storage access, retry preserving successful results. Production additive migration applied. Commit/push and CI live upload verification pending. No live staff browser login used.

## 2회전 변경 및 검증
추가 지시 적용: 같은 호차명의 1회/2회 행을 회차 순으로 결합. 중간 센터 보존, 원본 행 두 개 추적, 일반 동일 이름 행은 별도 코스로 유지. 짝 누락/중복/센터·차고지 불일치/결합 후 5경유지 초과 차단. 템플릿 입력안내와 예시 갱신. 임시 도메인 검사로 역순 입력·호차 격리·경계 센터·한도·일반 중복 검증 통과. 모의 브라우저에서 두 회차→한 코스→PDF 한 페이지 확인. 실제 Naver 거리우선 선택 상태도 재검증 통과.

기본 커밋 9225e13 Vercel 배포 성공. GitHub 실행 40635915766 verify/replace 성공, worker 실행 중. 실제 서버에서 두 개의 독립 왕복 캡처·비공개 Storage 업로드·결과 저장 통과, 검증용 작업과 이미지가 모두 정리되었음을 SQL로 확인. 추가 변경 커밋 배포 확인 대기.

## 최종 배포 확인 중 기록
- a8518f3: 2회전 결합 Vercel 성공, 운영 도메인의 NaverDistance-D2Lclly9.js에서 캡처 UI/2회전 문구 확인. 100개 생성 역순 회차 검사 통과. 실제 2회전 센터 재방문 네이버 조회도 통과.
- 서버 재검사 실패는 기존 거리 조회 live 검사에서 이미 실행 중인 다른 워커가 검증 작업을 선점한 뒤 검사 스크립트가 완료를 기다리지 않은 경쟁 상태. 조회 결과가 오기 전 6초 만에 실패했고, 캡처 단계에는 진입하지 않았음. dc6ce94에서 다른 워커의 완료를 최대 180초 대기하도록 수정, 중간 running/완료/실패/작업 소실/시간 초과 임시 검사 통과. 실제 CI 재검사 대기.
- Ego Lite 사용 여부 질문: 이 세션의 ALL_TOOLS 및 저장소 스킬 목록에서 Ego Lite 호출 수단이 노출되지 않았고, 실제 실행 도구는 기존 Node Playwright + Chromium. 도구 전환·설치·권한 변경 없이 현 구현을 유지함.

Ego Lite 후속 확인: 도구 목록 외에도 /usr/bin, /usr/local/bin, /opt 및 작업용 실행 경로/desktop Name·Exec/작업용 Chromium 확장 이름을 읽기 전용으로 확인. 현재 이 클라우드에는 Chromium 154.0.8037.57(/usr/bin/chromium)만 확인되었고 Ego 이름의 실행 파일·desktop 항목·확장은 확인되지 않음. 사용자 PC의 별도 설치는 이 환경에서 확인할 수 없으며 현재 Playwright를 대체하지 않았음. 기존 프로필 기록/쿠키·비밀값은 읽지 않음. 토큰 절감 수치 미측정.

최종 확인 추가: dc6ce94 CI에서는 기존 거리 조회 검사가 정상 완료됐으나 캡처 두 건이 실패했다. 아직 확정하지 않은 원인을 성공으로 기록하지 않음. 9c30bc2에서 거리우선 선택 상태를 최대 10초 기다리고, 서버 실패 단계를 고정된 분류값만 로깅하도록 보완. 로컬 실제 센터 재방문 코스 캡처는 재통과. GitHub 40637071781 실환경 검증 진행 중.

## 완료 검증
9c30bc2의 GitHub 실행 40637071781: verify(122646382677) 및 replace 성공. 실제 거리 조회, 두 코스의 네이버 거리우선 선택·PNG 캡처·비공개 Storage 업로드·결과 저장 검증 통과. 새 worker(122647064351)는 실행 준비 중이며 장기 실행 작업이므로 전체 workflow 종료까지 기다리지 않음. Vercel 운영 배포 성공. 실제 직원 계정의 운영 브라우저 로그인을 통한 전체 클릭 검사는 수행하지 않았으며, UI 권한/업로드/재시도/다건 PNG·PDF/2회전·모바일은 모의 Supabase 브라우저에서 검증. 모든 사용자 승인 범위 내에서 진행, 새 패키지 설치·권한 확대·Ego Lite 전환 없음.

최종 UI 검토에서 URL의 center가 생략됐을 때 저장된 센터를 유지하도록 캡처 컴포넌트가 AdminPage의 실제 center.code를 사용하도록 수정. 명시적 URL 안산뿐 아니라 저장된 안산 센터로 업로드·재시도·2회전·PDF/ZIP 회귀 검증 수행.

## 기존 엑셀 자동 탐색 변경
- [x] 도메인: 제목 행/별칭/명시적 주소 열/납품처 번호 순서 탐색, 역할 미확정 시 실행 차단. 기존 회차 결합을 재사용하고 실제 원본 행 번호 보존.
- [x] UI: 모든 시트에서 후보 표 찾기, 명확한 단일 표 자동 선택. 여러 후보/모호한 열만 간단히 선택, 필요 시 제목 행 수정. 고정 양식 재작성 요구 제거.
- [ ] 검증: 안내 행·빈 행·변경된 열 순서·주소/이름 열·납품처5 초과·시트별 표·역순 회차·모호한 주소/번호·빈 차고지/센터·출력 건수 및 기존 회귀를 임시 도메인/브라우저 검사. 빌드·배포 확인. 실제 코스 엑셀은 현 작업 공간에서 확인되지 않음.
- 기존 1335505 배포 근거: GitHub combined status Vercel success, target https://vercel.com/elfincapes-projects/sajoansan/wvua9VT9TBK93xAMab61uNoZWWcF ; 운영 페이지 HTTP 200 및 캡처/2회전 lazy bundle 문구 확인. 서버 9c30bc2 CI https://github.com/elfincape/SAJOANSAN/actions/runs/40637071781 verify/replace 성공과 새 worker 실행 확인.

자동 탐색 구현 검증: 안내 시트 + C6 제목의 실제 생성 XLSX에서 원본 7행과 열 위치 보존, 열 순서 변경/별칭/번호가 붙은 착지 순서/명칭·주소 쌍/2단 제목/반복 제목/150행 뒤 제목/동일 시트의 별도 표 경계/모호한 열 확인/제목 없는 첫 데이터 행/빈 센터 실행 차단을 임시 도메인 및 Playwright에서 확인. 역순 1회·2회가 한 코스/PDF 한 페이지임을 확인. 기존 다중 코스·부분 실패 재시도·성공 보존·PNG ZIP/PDF·센터 상속·390px 가로 넘침 없음 검증 통과. 실제 사용자 코스 원본 XLSX는 현재 첨부·저장소에서 확인되지 않아 실제 파일 검증은 수행하지 않았음. 새 의존성·테이블·권한 변경 없음. 제목 없는 파일의 원본 1행도 등록되도록 기존 RPC의 sourceRow 최솟값을 1로 맞춤. TypeScript/Vite build 및 Impeccable detect 통과. 커밋·Vercel 배포 확인 대기.

52eb10c: 기존 엑셀 자동 탐색 UI와 도메인 구현 커밋. 제목 없는 원본 1행 서버 등록 검토 중 전체 초기화 SQL 재적용이 자동 승인에서 거절됨(보안 정책/EXECUTE 권한 재설정 포함). 안전한 대안으로 운영 함수 정의를 읽고 sourceRow 최솟값 2→1 한 곳만 변경한 CREATE OR REPLACE를 적용, 승인 및 성공. 저장소 정책/권한 SQL은 실행하지 않음. authenticated 롤의 sourceRow=1 등록은 rollback 트랜잭션에서 검증. 배포 스크립트도 현재 함수의 단일 검사 조건만 비교·수정하고 이미 최신이면 읽기 전용으로 종료하도록 변경해 광범위 초기화 SQL의 간접 재실행을 방지. 새 환경은 기존 bootstrap SQL을 별도 초기 설정해야 함. 변경된 스크립트의 old/current 두 경로 임시 검사 및 ESLint 통과.

## 차고지 단일 값과 빈 납품처 칸 처리
최신 지시 반영: 기존 filter(Boolean) 빈칸 처리는 유지, 별도 복귀 열의 필수/동일성 검사 제거. 동일 차고지로 왕복하며 UI에서도 차고지 단일 역할만 표시. 기존 복귀 차고지 열은 실제 차고지 열이 있으면 참고로 제외하고, 복귀 차고지라는 열만 있는 파일은 명시된 단일 차고지 값으로 호환한다. 고객사 열은 물리적 열 순서대로 채워진 값만 사용한다. 예시 양식을 차고지 1열·납품처1~5로 갱신. 서버/권한 변경 없음.
- [x] 도메인: 납품처1만 입력·31개 빈칸 조합·중간 빈칸·열 순서·레거시 빈/동일/다른 복귀 값·역순 두 회차·센터 재방문·실제 경유지 한도·필수값 공란 검사 통과.
- [x] 브라우저: 생성 XLSX에서 단일/빈칸 2코스→PNG ZIP 2개/PDF 2페이지, 빈칸 많은 역순 회차 2행→1코스/PDF 1페이지, 옛 복귀 열 호환, 필수값/실제 초과 차단 및 모바일 검사 통과.
- [x] 기존 자동 탐색 회귀: 안내/빈 행, 별칭, 명칭/주소, 다단/반복 제목, 시트 경계, 모호한 열, 원본 행, 30개 열 순서 변형을 최신 물리 열 순서 규칙으로 재검증. 실제 사용자 원본 파일 검증은 아님.
- [x] TypeScript/Vite build, Impeccable detect, diff 검사 통과. 커밋·Vercel 배포 확인 대기.

## 최신 정정: 회전별 요청/빈 행/참고 열
기존 합산 경유지·통합 PDF 1페이지 해석은 폐기한다. 기존의 과거 검증 기록은 당시 구현이며 아래 기준으로 교체됨.
- [x] 도메인: 같은 호차는 그룹만 공유하고 1회전 G→C→착지→C / 2회전 C→착지→G로 별도 ID/요청 생성. 대-12호차 10·11행 합계 7개 사례가 2건으로 통과. 역순·호차 격리·각 회전 5경유지·개별 과다/주소 오류 격리 검증.
- [x] 서버: 기존 RPC에 회차 1/2 메타데이터 및 해당 시작·끝 규칙만 좁게 반영. 일반 코스 왕복은 유지. 2회전 3경로점 허용. authenticated 롤 등록/잘못된 endpoint 거절은 rollback SQL로 검사. grant/Storage 정책 재적용 없음.
- [x] 비데이터: trim/장식 정규화 및 의미 있는 행만 검증. 16~35행 공란·공백·빈/숨김0 수식, 순번/점 제외. 이후 유효 행 유지. 실제 호차/주소가 있는 불완전 행은 구체적 누락 오류 유지.
- [x] 역할: 필수 역할이 정해진 뒤 나머지 참고 열 자동 제외. 실제 추가 주소 후보는 확인. 기본은 필요한 열만 렌더, 참고 열은 검색/50개 단위. 점 20,000행 127ms·추가 점 열 20,000개 195ms 도메인 검사, 수동 확인 0건. 실제 XLSX 20,000점 브라우저 처리 211ms, DOM 분류 컨트롤 최대 50개.
- [x] 출력/UI: 회차별 이름과 PNG 2개/PDF 2페이지, 부분 실패/재시도 성공 보존, import 오류 복원, 역할 확인/모바일/오류 없음 검사 통과. 기존 잘못된 통합 결과는 구분하고 배치 출력은 원본 재등록 안내.
- [x] 실제 네이버: 공개 주소로 1회전 G→C→A→C(50km), 2회전 C→A→G(51km) 각각 다른 네이버 출발/도착 URL 및 실제 PNG 확인(주행거리는 조회 시점 값). 실제 사용자 원본 파일 검증은 아님.
- [x] 기존 Naver worker/model/lifecycle/UI 회귀, ESLint(script), Impeccable, TS/Vite build 통과.
- [x] 서버 97cedb8의 GitHub CI https://github.com/elfincape/SAJOANSAN/actions/runs/40645788057 verify/replace 성공, 새 worker의 --serve 실행 확인. 새 회전별 실제 캡처·비공개 업로드 2건 검증 완료. 화면은 서버 확인 후 후속 커밋으로 배포해 이전 워커와의 요청 형식 충돌을 방지. 최종 Vercel 확인 대기.

배포 검증용 회전 작업은 UUID 예약으로 이전 워커가 선점하지 않게 격리한다. 기본 워커의 일반 큐 조건/사용자 작업 권한은 바꾸지 않고, 검증 스크립트의 명시적 jobId+reservationId에서만 사용한다. 기본/예약 조건 임시 검사 및 기존 워커 회귀 통과. 최종 브라우저 재검사: 대-12호차 행10/11→서로 다른 PNG 파일명2개/PDF2페이지, 실패 재시도·성공 보존·가져오기 오류 복원, 공란16~35 무시, 점20,000셀 198ms/분류컨트롤최대50 통과.
