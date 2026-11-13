# 기존 웹 구조 개선 3/7 — 연결 오른쪽 상세

- 날짜: 2026-11-13
- 저장소: https://github.com/elfincape/SAJOANSAN
- 작업: `/workspace/legacy-workspace-upgrade`, `codex/legacy-workspace-stage3`
- 시작: `05ccde01706742d6cb8e55b72c8e84140bdd6c9d`
- [7단계 실행안](../plans/LEGACY-WORKSPACE-UPGRADE.md): 총 7단계 중 3단계 구현·격리 검증·운영 반영 확인 완료. 4~7단계 미착수.

## 결과와 사용 흐름
코스 표의 주/보조 기사·주차량 이름과 코스별 납품처 화면의 주/보조 기사·차량·납품처 이름을 누르면 오른쪽 원본 패널이 열린다. 이름으로 검색해 추정하지 않고 연결된 안정 ID를 사용한다. 기존 셸/표는 그대로 마운트해 필터·선택·스크롤을 유지하며, 닫을 때 참조 자료를 다시 읽고 원래 버튼으로 포커스를 복귀시킨다.

원본 편집기를 새로 복제하지 않았다. 같은 출처의 기존 기사·차량·납품처 관리 화면을 embedded 상세 모드로 사용한다. 기존 세션·페이지 접근 검사·원본별 수정 권한·저장 함수를 유지한다. 상세 모드는 지정 ID가 조회될 때만 편집기를 표시하고, 삭제/접근 불가/목록 미포함을 신규 원본으로 바꾸지 않는다. 차량 화면에는 기존 기사/납품처와 같은 ID 직접 선택 경로를 연결했다.

패널은 공통 원본 수정임을 표시한다. 납품처 이름은 공통 원본, `연결·조건 편집` 버튼은 기존 StopForm의 코스별 연결/순서/조건 편집이다. 원본 변경 때문에 연결 ID·순서·inherit/set/clear 조건을 수정하지 않는다. 기사 서류/OneDrive 설정은 기존 기사 관리 화면에 유지하며 이번 상세 패널에는 표시하지 않는다.

패널 닫기와 내부 Escape는 기존 입력/저장 가드를 통과해야 한다. 미저장 입력의 폐기를 거절하면 계속 편집할 수 있고 저장 중에는 닫지 않는다. 납품처의 보관된 초안은 2단계 저장소를 재사용하되 전체 관리 화면과 연결 상세의 문맥을 구분한다. 기사/차량의 입력은 기존 가드 방식이며 서버 초안이나 새로운 지속 보관을 추가하지 않는다.

## 변경 파일
- `app/src/components/LinkedRecordDetail.tsx`, `linked-record.css`: 같은 출처 원본 패널, 접근 가능한 Dialog/제목/포커스, 기존 이동 가드 연결, 내부 Escape 요청의 origin/source 확인. 기존 Radix 사용, 새 패키지 없음.
- `app/src/pages/Routes.tsx`: 기존 AG Grid 셀에 기사/차량 원본 버튼 연결, 닫은 뒤 자료 갱신.
- `RouteEdit.tsx`, `app/src/components/StopForm.tsx`: 연결 원본 버튼과 연결·조건 편집 명칭 구분. 저장 RPC 변경 없음.
- `Drivers.tsx`, `Vehicles.tsx`, `DeliveryPoints.tsx`: 지정 원본 선택 완료 후 상세 표시, 조회 불가 시 빈 신규 폼 방지. 기존 편집 함수 재사용.
- `app/src/components/AdminPage.tsx`: 기존 embedded 모드에서 원본 상세에 중복 헤더/셸을 표시하지 않음. 로그인·권한 로직 변경 없음.

## 검증
수정 전 코스 표에 기사 원본 열기 동작이 없어 브라우저 검사가 실패했다. 수정 후 내부 Linux Chromium에서 실제 React 화면과 같은 출처 iframe을 사용해 11사례를 통과했다. 세션/API는 합성 대역이며 운영 DB/RLS 확인이 아니다.

1. 코스에서 기사 오른쪽 패널 열기.
2. 정확한 ID의 기존 기사 폼 선택, 목록 중복 표시 없음.
3. 미저장 입력 폐기 거절 시 입력 유지, 이동 재확인 단계의 중복 질문 없음.
4. 기사 저장 후 부모 표 갱신, 코스 기사 ID 유지, 원래 행/열의 셀 포커스 복귀.
5. 차량 저장 중 패널 닫기 거절.
6. 차량 저장·내부 Escape 이후 부모 검색·행 선택 유지 및 최신 차량 표시.
7. 두 코스가 참조하는 공통 납품처 주소 수정 후 연결 ID·순서·clear/inherit 조건 불변.
8. 납품처 미저장 초안의 닫기/다시 열기 복원.
9. 읽기 전용 합성 세션에서 기존 편집 필드와 저장 버튼 비활성.
10. 조회할 수 없는 기사 ID에서 신규 저장 폼이 나오지 않음.
11. 코스 → 기존 납품처 편집 iframe → 원본 패널의 중첩 흐름과 복귀, 별도 연결·조건 편집 유지.

명령: `node /tmp/legacy-stage3/browser.cjs`, `npm --prefix app run build`, `git diff --check`, 변경 TSX의 Impeccable detect. 11사례·빌드·공백 검사 통과, 디자인 진단 `[]`. 실제 스크린샷으로 기존 화면 밀도·색·원래 표 유지 및 오른쪽 패널을 확인했다. 임시 재현 페이지와 테스트는 `/tmp/legacy-stage3`에 보관하고 커밋하지 않는다. 실제 업무 값/파일/관계에 시험 쓰기를 하지 않았다.

최종 검토에서 같은 기사가 여러 코스에 연결됐을 때 가상 표 셀이 재생성되면 첫 번째 코스로 포커스가 가는 경우를 추가 재현했다. 셀 DOM 교체를 주입한 검사에서 수정 전 `r12` 대신 `r`로 복귀해 실패했고, 원본 ID 외에 행/열 식별자를 보관한 뒤 같은 검사와 11사례가 통과했다. 실행: `node /tmp/legacy-stage3/browser-row.cjs`.

## 변경 범위와 한계
- DB·RLS·업무 API·원본 저장 함수 변경 없음. 원본 상세는 기존 요청자의 세션과 권한으로 읽고 저장한다. 패널 UI를 새로운 권한 경계로 취급하지 않는다.
- 납품처는 1단계 CAS/충돌 검토와 2단계 초안을 재사용한다. 기사·차량은 기존 저장 동작이며 이번 단계에서 새로운 revision/영수증 체계를 만들지 않았다. 기사·차량 동시 수정 충돌을 추가 해결했다고 주장하지 않는다.
- 실제 직원 로그인 후 운영 저장, Windows 실기, 실제 OneDrive 동작은 미검증이다. 내부 합성 UI 권한 검사는 실제 RLS 검증을 대신하지 않는다.
- 숨겨진/삭제된 원본의 상세 정보를 권한을 우회해 가져오지 않는다. 접근 가능한 조회 결과에 없으면 확인 필요로 남는다.
- 오른쪽 상세를 새로고침 후 자동 재개하는 기능이나 모든 도구의 상세 통일은 추가하지 않았다. 기존 2단계 부모 화면/납품처 초안은 그대로 사용한다.
- 별도 에이전트·새 UI 엔진·범용 iframe 작업 플랫폼을 추가하지 않았다. 대시보드의 기존 상세 및 다른 도구는 유지한다.
- 다음은 4/7단계 속성: 분류·필터와 접근 범위를 구분하고 관계로 자동 전파하지 않는 기존 계획을 따른다.

## 운영 반영 확인
- PR https://github.com/elfincape/SAJOANSAN/pull/159 — MERGED. 최신 구현 `9994fa1d02f58e24c0a7b8465d9587c2c2857d28`의 Vercel Preview 검사 SUCCESS.
- main 병합/실제 배포 코드: `2dba70895cac29a1dc9717028c5f1fd9abb70137`.
- Vercel `sajoansan` / `prj_6K1FG1lemrMTwQB8T0tRnpMZfzM7`, production `dpl_EFUaUTVZ8aJEegkLaBTfFn4gw5Ay`: READY. 위 SHA 및 `sajoansan.vercel.app` alias 확인.
- `LinkedRecordDetail-UFJcX2ke.js`의 상세 모드·원본 안내·닫기 가드, `RouteEdit-C3gow5hZ.js`의 연결·조건 편집 구분 확인. Routes/Drivers/Vehicles/DeliveryPoints 자산도 조회 성공.
- 배포 READY 이후 내부 Chromium: 코스 화면 및 기사/차량/납품처의 상세 전용 주소 4개 모두 비로그인 접근 시 `/login.html` 이동, HTTP 200, 비밀번호 입력 화면 1개, pageerror 0. 실제 직원 로그인/업무 저장은 미실시. 임의 실제 자료 변경 없음.
- 실행: `python3 /tmp/legacy-stage3/assets.py`, `node /tmp/legacy-stage3/live.cjs`. 이 후속 기록은 문서만 변경한다.
