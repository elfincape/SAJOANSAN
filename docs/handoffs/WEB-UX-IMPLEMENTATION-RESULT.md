# 기존 웹 UI·UX 8단계 실행 결과

2026-11-13. 저장소 `elfincape/SAJOANSAN`, 작업 경로 `/workspace/legacy-workspace-upgrade`, 브랜치 `codex/web-ux-eight-stages`, 시작 커밋 `a4c412281ec1c75fe553cf489c32c0304c0a9655`.

사용자의 “멈춤없이 마지막까지 작업” 지시로 [8단계 계획](../plans/WEB-UX-IMPROVEMENT-PLAN.md)을 연속 실행했다. **8/8 완료: 구현·격리 검증·GitHub 병합·운영 배포 및 공개 경로 확인 완료**이다. 새 ERP, DB/RLS, 권한 정책, 계산·분석·출력 알고리즘은 변경하지 않았다. 기존 작업공간의 사용자 변경은 보존했다.

## 단계별 결과

| 단계 | 실제 변경 및 확인 |
|---|---|
| 1/8 인증·이동 | 내부 이동의 강제 인증 재조회를 제거하고 기존 30초 인증 컨텍스트/동시 조회 합치기를 재사용했다. 만료·로그아웃·계정 변경·비활성 계정 처리는 유지한다. `body` 전체 inert를 제거했다. 이동 대기 중 새 입력은 현재 화면에 남고, 빠른 연속 메뉴 선택은 마지막 목적지만 연다. |
| 2/8 저장 범위 | 저장 중에도 메뉴 열기·테마 전환이 가능하다. 실제 이탈·센터 변경·중복 저장·삭제는 기존 가드로 막고 이유를 표시한다. 대시보드 셀 편집만으로 셸 전체를 잠그지 않는다. |
| 3/8 작업 문맥 | 기사·차량·운수사의 검색/필터·선택·스크롤과 사용자/센터별 입력 초안을 기존 sessionStorage 계약으로 보존한다. 재조회된 같은 원본에 사용자가 명시적으로 초안을 복원한다. Excel은 살아 있는 작업공간에서 workbook/조건/결과를 메모리로 유지하고 새로고침 뒤에는 파일 재선택을 알린다. 배차 파서의 글/결과도 기존 저장소로 보존한다. |
| 4/8 상세·원본 | 납품처 대시보드 상세와 감사 이력을 오른쪽 상세로 표시한다. 이름·연결 상세와 빠른 셀 수정의 기존 구분은 유지한다. 같은 출처 linked-detail은 부모의 유효 인증을 재사용한다. 변경 없이 닫을 때 목록을 재조회하지 않으며 저장한 경우에만 닫은 뒤 갱신한다. |
| 5/8 실패·재시도 | 원장·사용자·감사 이력 갱신 실패에서 마지막 성공 자료를 남기고 오류와 재시도를 표시한다. 실패를 빈 목록으로 표시하지 않는다. 공통 인증 오류도 해당 요청을 재시도하며 접근 불가 화면에서 메뉴 복귀가 가능하다. 코스 이름 검증 실패는 입력에 초점을 보낸다. |
| 6/8 도구 흐름 | PDF/이미지/전표/쿠팡/원탑/온도 입력 이탈 보호, PDF 입력 준비 전 병합 비활성, Excel 입력 전 불필요한 설정 숨김을 적용했다. 이배송의 목록 추가와 실제 저장을 구분하고 부분 성공 ID를 보존해 재시도한다. 수정한 기존 행도 저장 전에는 미저장이다. 기존 전문 도구의 진행·저장·재시도 처리는 재사용한다. |
| 7/8 밀도·탐색 | 원장 최초 진입은 목록 중심, 선택/신규에서 편집 패널을 열고 개인별 접힘/너비를 기억한다. 좁은 상세의 라디오 간격·포커스를 수정했다. 폐기된 Notion을 메뉴에서 제거하고 직접 주소에는 폐기 안내만 둔다. |
| 8/8 마감 | 아래 35개 모듈의 적용·기존 처리·제외를 대조했다. 관련 기존 검사 14개와 실제 React 화면을 연 합성 브라우저 검증, 최종 빌드를 통과했다. 실제 업무 쓰기와 외부 제공자 시험은 하지 않았다. |

## 주요 파일

- `app/src/lib/auth.ts`, `main.tsx`, `lib/workspace-navigation.ts`: 인증 재사용, 이동 대기와 경합, 부분 진행 표시. 연속 이동은 13개 모듈이며 모든 도구를 일괄 SPA로 바꾸지 않았다.
- `components/WorkspaceFrame.tsx`, `EditorStatus.tsx`, `AdminPage.tsx`: 셸 조작과 실제 저장/이탈 제한 분리, 오류·권한 불가 화면 복귀.
- `components/Workbench.tsx`, `pages/{Drivers,Vehicles,Companies}.tsx`: 기존 workspace store를 사용하는 목록 상태·수동 초안 복원·목록 우선 패널.
- `components/{Modal,DashboardDetail,LinkedRecordDetail,DashboardCellEditor}.tsx`: 오른쪽 상세, 입력 이탈 보호, 같은 출처 저장 알림 및 변경 시 부모 목록 갱신.
- `pages/{Users,AuditLog}.tsx`: 마지막 성공 목록과 요청별 재시도.
- `pages/{ExcelCompare,DispatchParser,PdfTools,ImageStraightener,PalletSlips,Transfers,CoupangEntry,OneTopWork,DailyTemperature}.tsx`: 도구별 입력/처리/저장 상태와 이탈 경계. 기존 계산·문구·양식은 유지.
- `domain/feature-catalog.ts`, `pages/NotionHealth.tsx`, `styles/workspace-*.css`, `components/workbench.css`: 폐기 메뉴, 상세 배치·간격·초점.
- 새 패키지·DB migration·권한 원장·상시 worker·서버 초안 없음. 기존 Radix/React/파일 라이브러리와 저장 계약 재사용.

## 35개 화면 적용·검증 범위

공통 적용은 해당 화면의 기존 AdminPage/셸을 통한 상태·오류·이탈 처리다. **코드 경로 확인은 실제 외부 업무 실행 통과가 아니다.** “기존 유지” 화면은 새 개별 기능을 만들지 않았다.

| 화면 모듈 | 적용/유지/제외 | 이번 근거와 한계 |
|---|---|---|
| AdminHub | 공통 적용 | 연속 이동·메뉴·폐기 항목 브라우저 확인 |
| AuditLog | 개별 적용 | 합성 접근/이력 응답으로 실패 후 마지막 자료·재시도·우측 상세 확인; 실제 OP 조회 미실시 |
| CharterParser | 기존 유지·공통 적용 | 기존 dirty/busy·검토/저장 구분 소스 확인; 실제 분석 미실시 |
| Companies | 개별 적용 | 합성 원본 선택·초안 수정·새로고침·복원 확인 |
| CoupangEntry | 개별 이탈 보호 | 독립 화면 보호, 포털 내 embedded는 부모 상태 재사용; AI 미실시 |
| CourseExport | 기존 유지·공통 적용 | 기존 출력/다운로드 유지; 문서 수명주기 때문에 네이티브 이동 유지, 실제 출력 미실시 |
| CourseImport | 기존 유지·공통 적용 | 기존 입력/검토 계약 유지; 업로드 수명주기 때문에 네이티브 이동 유지, 실제 이관 미실시 |
| DailyTemperature | 개별 이탈 보호 | 글·행 편집/삭제/날짜 적용/순번 변경 보호 코드·빌드 확인; 실제 업무 파일 미실시 |
| Dashboard | 개별 적용 | 합성 연결 상세/우측 납품처 상세·닫기 취소 입력 유지 확인; 기존 셀/CAS 동작 유지 |
| DeliveryPoints | 공통 패널·상세 적용 | 목록 우선·선택·패널 접기 복원, 1366/1440·라이트/다크 확인 |
| DispatchParser | 개별 입력 보존 | 사용자·센터별 글/결과 저장, 파서 알고리즘 유지; 실제 카톡 미실시 |
| DistanceCalculator | 기존 유지·공통 적용 | 기존 단계/실패/결과 계약 유지, 네이티브 이동; 실제 지도 미실시 |
| Drivers | 개별 적용 | 저장 중 무관한 셸 조작·중복 요청 차단·초안 복원·연결 iframe 저장 후 부모 갱신 확인 |
| ExcelCompare | 개별 적용 | 합성 xlsx 실제 파싱, 허브 왕복 복원, 재로드 후 재선택 안내·조건 유지 확인 |
| GimhaeDispatch | 기존 유지·공통 적용 | 기존 저장/실패·재시도 유지; 실제 Haiku 미실시 |
| HaulCalculator | 기존 유지·공통 적용 | 기존 Excel/계산 유지, 네이티브 수명주기 제외; 실제 업무 출력 미실시 |
| ImageStraightener | 개별 이탈·키보드 보호 | 입력/대화상자 안 화살표 탈취 방지; 실제 회사 사진 미실시 |
| KakaoRoutes | 기존 유지·공통 적용 | 기존 도구 입력/라우팅 유지; 실제 수집/외부 전송 미실시 |
| Login | 기존 유지·명시적 제외 | 정상 로그인 자체는 지속 인증 대상이 아님; 합성 auth 만료/비활성/로그아웃 검사, 실제 사용자 로그인 미실시 |
| MailDailyBriefing | 기존 유지·공통 적용 | 기존 업무/보고 상태와 재시도 유지; 실제 모델/OneNote 미실시 |
| NaverDistance | 기존 유지·공통 적용 | 기존 조회/캡처 검증·부분 실패 유지, 네이티브 이동; 실제 Naver 미실시 |
| NotionHealth | 폐기 적용 | 메뉴 미노출 확인, 직접 주소는 폐기 안내, 과거 데이터 보존 |
| OneTopWork | 개별 이탈 보호 | 캡처/분석/외부 저장 중 가드, 기존 분석 유지; 실제 외부 호출 미실시 |
| Operations | 기존 유지·공통 적용 | 기존 업무 상태/검색 유지; 실제 업무 저장 미실시 |
| PalletSlips | 개별 오류·이탈 보호 | 파일 선택 경합에서 늦은 파일 응답 무시, alert 대신 기존 피드백; 계산/양식 유지 |
| PdfTools | 개별 적용 | 합성 2쪽 PDF를 실제 렌더러로 열어 2/2, 입력 전 병합 차단·이탈 취소 후 보존 확인; 외부 서류 전송 미실시 |
| Portal | 공통 적용 | 기존 연속 셸/업무 검색·상세 유지; 실제 업무 데이터 미실시 |
| PyeongtaekDispatch | 기존 유지·공통 적용 | 기존 입력/저장/실패 구분 재사용; 실제 월 자료 미실시 |
| RouteEdit | 연속 이동 적용 | 기존 코스 편집/연결 조건/CAS 유지; 공유 원본 DB 변경은 이번에 실행하지 않음 |
| Routes | 공통 적용 | 코스→납품처→기사→코스 내부 이동, 기존 목록/원본 연결 유지 |
| Settings | 공통 적용 | 연속 이동·메뉴/테마 상태 유지; 실제 연결 설정 변경 안 함 |
| Talkcloud | 기존 유지·공통 적용 | 기존 연결/기록/실패 상태 유지; 실제 수집/분석 미실시 |
| Transfers | 개별 적용 | 합성 저장 부분 실패·동일 ID 재시도·기존 행 수정 후 미저장 표시 확인 |
| Users | 개별 적용 | 합성 갱신 실패→이전 목록 유지→재시도 확인; 실제 계정/권한 변경 없음 |
| Vehicles | 개별 적용 | 합성 원본 선택·초안 수정·새로고침·복원 확인 |

## 재현·수정·검증

- 연속 이동: 코스→납품처→기사→코스의 유효 시간 내 `getUser`/권한 조회는 최초 1회, 이동 후에도 1회. 단순히 인증 문구를 숨긴 것이 아니다. 만료 뒤 재조회는 유지한다.
- 이동 중 `body` 전체 inert는 0. 지연된 페이지 준비 중 새 입력은 화면에 남고 마지막 메뉴 선택만 적용한다.
- 저장 응답을 2.2초 지연시킨 기사 화면에서 테마/메뉴는 사용 가능, 같은 저장·삭제와 이탈은 차단된다. 서버 저장 자체가 빨라졌다고 주장하지 않는다.
- 연결 기사 상세는 부모 인증 1회, 자식 0회. 변경 없이 닫기는 재조회하지 않는다. **최종 재현에서 기사 저장 알림 누락을 발견했으며, 실제 저장 성공 지점의 알림을 추가한 뒤 부모 표의 새 이름까지 확인했다.**
- 이배송 2행 저장 중 2번째 실패 후 재시도 호출 ID는 `[null, null, "saved-1", null]`. 첫 저장 ID를 유지한다. **기존 행 수정 뒤에도 저장됨으로 보이던 오류는 실패 재현 후 기존 `_dirty` 필드를 재사용해 수정했다.** 응답을 아예 잃어 ID를 못 받은 경우의 서버 멱등 보장을 새로 구현한 것은 아니다.
- 차량/운수사/기사 초안은 현재 접근 가능한 같은 원본 조회 후 수동 복원한다. 다른 창 최신값에 자동 덮어쓰지 않는다. 원래 해당 원장이 제공하지 않던 서버 revision 계약을 추가했다고 주장하지 않는다.
- Users/AuditLog 갱신 실패는 마지막 정상 자료 유지, 오류와 빈 목록 구분, 현재 조건 재시도 통과. 감사 이력 첫 검증 실패는 합성 프로필의 비공개 기능 권한 설정 누락이었으며 실제 권한 코드를 완화하지 않고 테스트 픽스처만 정정했다.
- 1366×768, 1440×900에서 납품처 목록·상세의 가로 넘침 없음, 밝은/어두운 테마에서 조건 라디오 간격과 패널 접힘 복원 확인. 대시보드 우측 상세의 미저장 닫기 취소도 확인.

실행한 명령과 결과:

```sh
npm --prefix app run build
XLSX_TEST_MODULE=/workspace/legacy-workspace-upgrade/app/node_modules/xlsx node --test tests/excel-compare.test.mjs tests/portal-permissions.test.mjs tests/delivery-point-dashboard-content.test.mjs tests/dashboard-multi-term-search.test.mjs tests/dashboard-driver-contact-search.test.mjs tests/pdf-image-assignment.test.mjs
git diff --check
.agents/skills/impeccable/scripts/impeccable detect --json <변경 TSX 파일>
```

빌드 성공(기존 큰 청크 경고 유지), 기존 검사 **14/14**, diff 검사 통과, Impeccable 발견 0개. 별도 패키지·영구 테스트 파일·검사 인프라는 추가하지 않았다. 변경된 auth/navigation/저장/모달 경계를 직접 검토했으며 사용자 지시대로 에이전트 분업은 하지 않았다.

임시 검증 `/tmp/web-ux-implementation`: `auth.cjs`(VM 대역), `navigation.cjs`, `navigation-race.cjs`, `save.cjs`, `context.cjs`, `detail.cjs`, `errors.cjs`, `tools.cjs`, `layout.cjs`, `transfers.cjs`, `dashboard.cjs`, `masters-audit.cjs`. 브라우저 검사는 실제 Vite React 화면과 Chromium을 사용하고 Supabase/업무 응답만 합성 대역으로 교체했으며 외부 HTTPS 요청을 차단했다. 운영 DB나 실제 업무 값에는 쓰지 않았다. 임시 스크립트는 작업환경에만 있고 Git에는 추가하지 않았다.

합성 화면 근거: [밝은 상세](../reviews/assets/web-ux-after-2026-11-13/point-after-light.png), [어두운 상세](../reviews/assets/web-ux-after-2026-11-13/point-after-dark.png), [대시보드 오른쪽 상세](../reviews/assets/web-ux-after-2026-11-13/dashboard-detail-after.png), [PDF 입력 이후](../reviews/assets/web-ux-after-2026-11-13/pdf-after.png).

## 남은 실제 경계

1. 연속 이동 13개 모듈 외의 전문 도구는 스타일·worker·업로드 수명주기로 네이티브 이동을 유지한다. 모든 화면 전환의 인증/로딩이 사라지는 것은 아니다.
2. PDF/이미지/전표 등의 파일 바이트를 서버 초안으로 저장하지 않는다. 이탈 확인 후 떠나거나 새로고침하면 재선택해야 한다. Excel workbook은 현재 살아 있는 작업공간 메모리에만 있으며 재로드 후 설정/이전 파일명과 파일 바이트를 구분한다.
3. 복원 초안은 저장 전 최신값과 명시적으로 비교한다. 연결 상세 저장 후 부모 전체 목록 재조회는 유지하며 행별 갱신으로 전부 바꾸지 않았다.
4. 일부 전문 도구는 이번에 공통 셸 적용과 기존 단계 처리만 확인했다. 실제 모델/Haiku·Naver/지도 캡처·OneDrive/OneNote/Talkcloud·실제 직원 로그인·Windows IME/클립보드/다중 DPI는 미확인이다.
5. 35개 화면에서 모든 가능한 UI·업무 결함이 없음을 증명한 작업이 아니다. 기존 18개 발견 사항에 대한 조치·정당한 유지·제외를 마감하고 실제 검증 범위를 위에 구분했다.

## 배포

- PR: [#165](https://github.com/elfincape/SAJOANSAN/pull/165), 구현 head `3cce37afd4f408b021cbca1ebb11abf9291c15f0`, main 병합 `ecae6d5b7bfbbbf4835e5621d8d18d367d21017b`.
- Vercel 프로젝트 `prj_6K1FG1lemrMTwQB8T0tRnpMZfzM7` (`sajoansan`). 미리보기 `dpl_21terZGyCABU45gQhyp8mEVVxajM` READY 후 병합했다.
- 운영 배포 `dpl_7HNw3L17NQKNzyr9jyH3y7dxjXmj`, target production, 위 main 커밋, **READY**, alias `sajoansan.vercel.app`, aliasError 없음 확인.
- 실제 주소: https://sajoansan.vercel.app . 공개 `/admin/routes.html` HTTP 200 및 새 `index-Eh43wnrw.js` 확인. `Transfers-BLy4DfBa.js`, `ExcelCompare-B0asR-Kv.js`, `NotionHealth-DAB4M8Fu.js` HTTP 200과 변경 문자열 확인.
- 실제 공개 주소의 내부 Chromium에서 비로그인 `/admin/routes.html`, `/admin/delivery-points.html` → `/login.html`, pageerror 0. `NODE_USE_ENV_PROXY=1 node /tmp/web-ux-implementation/production.cjs`로 확인했다. 최초 Node 직접 fetch는 작업환경 프록시 미사용으로 실패했고, 이미 설정된 환경 프록시를 사용한 재확인에서 통과했다.
- 위 결과는 **실제 배포/공개 자산/비로그인 경로 확인**이다. 로그인한 실제 직원의 업무 읽기·수정, 외부 제공자 업무는 합성 UI 검사와 구분해 미확인으로 유지한다.
- 이 확인 기록은 제품 코드를 바꾸지 않는 문서 후속 커밋으로 저장한다. PR 첨부 도구는 응답이 완료되지 않아 첨부 성공으로 집계하지 않았으며 PR 링크는 위에 직접 제공했다.
- 문제가 생기면 해당 PR의 제품 변경을 되돌린 릴리스로 배포할 수 있다. DB·원본·파일 양식 변경이 없으므로 본 작업에 대한 데이터 migration rollback은 없다. 단, 사용자가 이미 저장한 업무 자료를 과거 사본으로 되돌리지 않는다.
