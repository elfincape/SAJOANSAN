# 대시보드 연결 상세 누락 보완

- 날짜: 2026-11-13
- 저장소: https://github.com/elfincape/SAJOANSAN
- 작업 경로/브랜치: `/workspace/legacy-workspace-upgrade`, `codex/dashboard-linked-details`
- 시작 main: `df0c4a7037f76445eb1bfd390f34e271d4774bd4`

## 원인과 변경
3단계는 코스 관리와 코스별 납품처 편집에만 오른쪽 원본 상세를 연결했다. 대시보드의 `editableCell`은 기존 셀 편집을 계속 열었다. 7/7단계 완료라는 보고만으로 대시보드도 같은 동작을 한다고 이해할 수 있었으므로, 단계 범위의 누락을 보완했다. 과거 단계 보고서는 변경하지 않는다.

- 대시보드 일반 표/코스별 묶음의 납품처 코드·이름·주소·연락처·공통 조건, 주/보조 기사 이름·연락처, 주차량 번호·톤수는 안정 ID로 기존 오른쪽 원본 상세를 연다.
- `LinkedRecordDetail`과 기존 기사/차량/납품처 편집기를 재사용한다. 기존 세션·페이지 접근·원본 수정 권한·입력/저장 중 닫기 가드는 그대로다. 새 권한이나 저장 API를 만들지 않았다.
- 기존 셀 편집이 지원되는 값은 F2로 열 수 있다. 보조기사 버튼의 F2로 주기사 셀 편집이 열리지 않게 구분했다. 연결 교체는 기존 셀 편집의 명시적 연결 변경으로 수행한다.
- 시간·순서·코스별 조건은 기존 셀 편집을 유지한다. 모든 셀이나 기존 행 전체 상세를 오른쪽 원본 편집으로 바꾼 것은 아니다.
- 원본 ID가 없으면 값을 유지하고 연결 확인 필요로 표시한다. 이름으로 다른 원본을 추정하거나 새 원본을 만들지 않는다.
- 상세 닫기 후 기존 목록을 다시 읽고 같은 보기·행·열로 포커스를 복귀한다. 같은 원본이 여러 행에 있어도 첫 행으로 잘못 복귀하지 않는다. 목록 갱신 실패 시 기존 패널의 오류/재시도 처리를 사용한다.
- 기존 ERP 조회 전용 경로의 동작은 유지한다. 현재 기존 웹 경로에 적용한 수정이다.

## 변경 파일
- `app/src/pages/Dashboard.tsx`: 연결 원본 클릭과 F2 편집 분리, 묶음 헤더의 주/보조 기사·차량 연결, 기존 목록 갱신 재사용.
- `app/src/components/LinkedRecordDetail.tsx`: 대시보드 보기/행/열 기반 복귀와 기본 포커스 대상 연결.
- `docs/plans/LEGACY-WORKSPACE-UPGRADE.md`: 단계 완료 보고의 범위와 이번 누락 보완 기록.

## 확인 결과와 한계
- 수정 전 내부 Chromium에서 대시보드의 납품처 원본 버튼을 찾지 못해 실패했다. 수정 후 같은 진입이 오른쪽 패널을 열고 셀 편집은 열지 않음을 확인했다.
- `node /tmp/dashboard-linked/full.cjs`: 합성 UI 10개 확인 통과. 공유 원본 두 행의 주소 갱신/연결·순서 불변, 재생성된 두 번째 행으로 복귀/검색 유지, 주·보조 기사/차량 ID, 닫기 가드, 보조기사 F2 보호, 묶음 보기, F2 기존 편집, 조회 전용 부모의 진입과 편집 제한, 누락 ID, 시간 셀 편집. pageerror 0.
- 위 테스트는 실제 Dashboard와 LinkedRecordDetail에 합성 조회/편집 자식 대역을 연결한 검사다. 실제 DB 저장 또는 운영 직원 권한 검증으로 집계하지 않는다. 실제 기존 편집기와 합성 DB 대역의 저장·초안·권한 검증은 [3단계 결과](LEGACY-WORKSPACE-STAGE-03.md)를 재사용한다.
- `node --test tests/dashboard-multi-term-search.test.mjs tests/dashboard-health-display.test.mjs tests/dashboard-driver-contact-search.test.mjs tests/delivery-point-dashboard-content.test.mjs`: 기존 관련 검사 4/4 통과.
- `npm --prefix app run build`: TypeScript/Vite 빌드 통과. 기존 대형 청크/의존성 경고는 이번 변경 대상이 아니다.
- Impeccable detect 결과 `[]`, 스크린샷에서 기존 오른쪽 패널 배치 확인, `git diff --check` 통과.
- 임시 합성 페이지·검사는 `/tmp/dashboard-linked`에 보관하며 커밋하지 않는다. 실제 업무 데이터·DB/RLS·Edge·외부 파일에 시험 쓰기 없음. 실제 로그인 후 업무 저장과 Windows 실기는 별도 미확인이다.

## 진행 상태
총 7/7단계 이후 발견된 3단계 대시보드 적용 누락을 보완한 작업이다. 다른 후속 도구나 새 단계는 시작하지 않았다. 운영 반영 결과는 배포 후 아래에 기록한다.
