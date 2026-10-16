# 기존 웹 통합 및 전체 UI·UX 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 업무 흐름과 권한을 유지하면서 전체 화면의 사용성을 개선하고 검증된 도구 통합을 제공한다.

**Architecture:** Vite 다중 페이지와 기존 Supabase 인증·RPC·RLS를 유지한다. 공통 스타일과 재사용 가능한 탐색 요소를 정리한 후 화면별 레이아웃을 적용한다. XERJ는 네이버 서버의 내부 서비스로 실행하고 인증된 서버 API를 통해서만 검색 결과를 제공한다.

**Tech Stack:** Vanilla JavaScript, CSS, Vite, 기존 Playwright·ESLint·Prettier, Supabase, XERJ, Archify, Chrome DevTools MCP.

**Spec:** ../../server-integration-design.md 및 이 계획의 UI 확장 범위.

## Global Constraints

- 기존 기능과 업무 처리 방식을 유지한다.
- 오픈소스 전용 메뉴·페이지·중복 기능을 만들지 않는다.
- 기존 구현과 설치된 라이브러리를 재사용하고 중복 코드와 중복 설치를 피한다.
- 기존 DB와 테이블을 재사용하고 불필요한 DB 객체를 만들지 않는다.
- 별도 테스트 코드는 만들지 않고 변경 부분의 관련 검사만 실행한다.
- 사용자가 확인한 사용 환경: PC 중심, 모바일에서도 조회·처리.
- 전체 대상은 repo-root의 HTML 31개다. 로그인·포털·허브·대시보드·각 관리 및 도구 화면을 목록으로 관리하고 누락 없이 확인한다.
- 도구가 맞지 않는 기능에 억지로 결합하지 않고 실제 적용 여부와 불가능한 범위를 구분해 보고한다.

## Review Focus

- 검색 결과의 센터 외 기록·삭제된 원본·권한 회수 정보가 제목이나 본문 발췌로도 유출되지 않아야 한다.
- 빈 데이터·긴 이름·긴 표·많은 필터가 있는 화면에서 핵심 동작을 계속 찾을 수 있어야 한다.
- 390px 모바일 화면에서 본문이 화면 밖으로 밀리지 않아야 하며 넓은 표는 자체 영역에서 스크롤해야 한다.
- XERJ·본문 추출 실패가 기존 검색과 첨부파일 등록을 중단시키지 않아야 한다.
- 테스트 응답으로 확인한 화면을 실제 계정·실제 DB 검증으로 보고하지 않아야 한다.

## UI 확장 방향 — 검토 대상

추가 승인: Open Props를 공통 CSS 토큰 기반으로 설치하고 Uiverse Galaxy의 필요한 요소만 원본 출처·MIT 고지와 함께 적용한다. React 전용 라이브러리와 별도 CSS 프레임워크는 현재 구조에 필요하지 않아 설치하지 않는다. 기본 토큰 연결과 `내 업무만` 토글 적용을 첫 단계로 완료하고 전체 레이아웃 개선은 후속 항목으로 유지한다.

업무용 화면의 정확성과 조작성을 우선한다. 기존 한국어 명칭과 기능·센터 선택·권한·저장 절차를 유지한다. 현재의 어두운 바탕과 녹색 강조를 출발점으로 대비, 글자 크기, 간격, 상태 색상을 통일한다. 장식적인 효과보다 제목·주요 동작·필터·결과의 순서를 명료하게 만든다. 최종 시각 방향은 공통 디자인 기록에 명시하고 대표 화면 확인 후 전체로 확장한다.

- 업무포털: 사이드바 현재 위치, 센터 문맥, 주요 처리 동작의 위계를 명확히 한다. 빈 달력의 불필요한 높이를 줄이고 긴 업무 목록과 상세 영역을 정리한다.
- 관리허브: 실제 권한으로 보이는 메뉴를 업무 목적에 따라 정돈하고 자주 쓰는 화면을 빠르게 찾게 한다. 숨겨진 메뉴를 강제로 노출하지 않는다.
- 대시보드: 필터와 검색을 정돈하고 정렬·열 설정·필터 초기화 상태를 구분한다. 표의 가독성과 가로 스크롤을 개선한다.
- 공통: 키보드 포커스, 버튼 상태, 입력 레이블, 로딩·빈 상태·실패·저장 피드백을 정리한다. 모바일에서 헤더·폼·대화상자가 잘리지 않도록 한다.

### Task 1: 기준 화면과 공통 디자인 확정

**Files:** PRODUCT.md, DESIGN.md, docs/ui-screen-inventory.md, repo-root/css/common.css, portal.css, operations.css 및 HTML 31개를 조사.

**Interfaces:** 기존 CSS 변수·클래스와 HTML ID를 조사해 유지할 DOM 계약을 기록한다. 새 프레임워크를 도입하지 않는다.

- [x] 대표 포털·허브·대시보드를 기존 테스트 응답으로 렌더링하고 개선 전 캡처를 확인한다.
- [x] PC 중심·모바일 조회 및 처리라는 사용 환경을 사용자에게 확인한다.
- [ ] 화면 목록에 URL·기능·공통 CSS·권한·주요 동작·개선 및 검증 상태를 기록한다.
- [ ] 확인된 제품 사실만 PRODUCT.md에 쓰고 공통 색상·타이포·밀도·포커스·반응형 기준을 DESIGN.md로 확정한다.
- [ ] 1440px와 390px에서 주요 기능 위치 및 빈 상태를 기록한다. 실제 로그인 없이 확인하지 못한 상태는 별도 표시한다.

### Task 2: 공통 UI와 전체 화면 UX 개선

**Files:** repo-root/css/common.css, portal.css, operations.css, excel-compare.css, driver-documents.css; repo-root/index.html, login.html, portal/index.html, admin/*.html; 필요한 기존 js 화면 모듈.

**Interfaces:** 기존 이벤트가 사용하는 ID·name·dataset·폼 제출 계약을 보존한다. CSS 변경만으로 기능 완료를 주장하지 않는다.

- [ ] 공통 토큰과 버튼·폼·표·대화상자·포커스 스타일을 적용한다.
- [ ] 업무포털의 헤더·필터·보기 전환·캘린더 빈 상태 및 상세 레이아웃을 개선한다.
- [ ] 관리허브 메뉴 탐색과 대시보드 검색·필터·표 조작을 개선한다.
- [ ] 화면 목록의 나머지 로그인·기사·차량·회사·코스·납품처·엑셀·PDF·계산·설정 화면을 개별 확인하고 필요한 수정만 적용한다.
- [ ] 기존 브라우저 검사, 빌드, 변경 파일 lint·format 검사 및 Impeccable detector를 실행한다.
- [ ] 대표 화면과 화면별 위험 상태를 PC·모바일로 캡처해 직접 확인한다. 데모 데이터의 범위와 미확인 실제 권한 흐름을 보고한다.

### Task 3: 검색 서버와 기존 검색 통합

**Files:** scripts/deploy-search 관련 배포 스크립트, configurations의 비밀 없는 예시 설정, supabase/functions/document-search/index.ts, repo-root/js/portal-search.js, 기존 첨부파일 등록·삭제 모듈 중 조사로 확인된 파일.

**Interfaces:** `document-search`는 로그인 JWT, 검색어, 센터 및 페이지를 받고 원본 접근 권한이 재검증된 문서 ID·표시 제목·본문 발췌만 반환한다. 서버 간 키는 환경 설정에만 저장한다.

- [ ] operations-files.sql, operations-search.sql과 실제 파일 업로드·다운로드·삭제 경로를 조사해 권한 및 동기화 계약을 확정한다.
- [ ] 도메인·HTTPS 인증서와 Supabase 배포 권한 등 외부 설정이 필요한 값을 확인한다. 없는 값을 임의로 만들거나 평문 HTTP로 대체하지 않는다.
- [ ] SSH로 XERJ Linux 배포본 체크섬을 검증하고 루프백·인증·메모리 제한 및 systemd 재시작을 설정한다. 관리 포트는 공개하지 않는다.
- [ ] 비민감 샘플로 색인·검색·삭제·서비스 재시작을 확인한 뒤 기존 첨부 동기화와 인증 API를 구현한다.
- [ ] 기존 RPC 결과에 문서 검색을 결합하고 서버 실패 시 기존 결과를 계속 표시한다.
- [ ] 미인증·타 센터·원본 삭제·권한 회수·긴 검색어·빈 검색어·서버 중단을 관련 기존 검사와 수동 API 요청으로 확인한다.

### Task 4: 업무 흐름 시각화와 문서 도구 활용

**Files:** repo-root/js/portal-history.js, portal-history-model.js, operations-api.js, driver-documents.js, pdf-tools.js 중 실제 통합에 필요한 파일; 필요한 Archify 런타임 자산 및 라이선스 고지.

**Interfaces:** 권한이 확인된 `api.events()` 이벤트로만 흐름을 구성한다. 원본 이력을 유지하며 사용자 입력을 실행 가능한 HTML로 삽입하지 않는다.

- [ ] Archify의 배포 가능한 런타임·스키마를 확인해 기존 처리 이력 영역에서 실제 이벤트 시각화를 구현한다. 런타임 제약이 있으면 정적 업무 도움말 적용 범위를 구분한다.
- [ ] 빈 이력·재개·반복 인계·긴 메모를 표시하고 생성 HTML·브라우저 검증을 수행한다.
- [ ] OpenBidKit의 실제 출력·API·라이선스 경계를 조사해 독립 출력의 기존 PDF·이미지 처리 호환성을 검증한다.
- [ ] 소스 결합이 필요하면 AGPL 적용 범위를 구체적으로 정리해 별도 승인을 받는다. 독립 구현을 OpenBidKit 적용이라고 부르지 않는다.

### Task 5: 전체 검증과 배포

**Files:** DEPENDENCIES.md, docs/server-integration-design.md, 화면 목록, 실제 변경 파일.

- [ ] 기존 `node --test tests/browser/*.test.mjs`, ESLint, Prettier 변경 파일 검사, Vite build를 실행한다. 새 실패가 있으면 원인을 해결한다.
- [ ] DevTools로 검색·포털·허브·표·문서 화면의 콘솔·네트워크·반응형 동작을 확인한다.
- [ ] 서버·API·프론트엔드의 연결을 검증하고 실제 배포와 로컬 구현 상태를 구분해 기록한다.
- [ ] 올바른 GitHub 원격 저장소와 기존 배포 경로를 확인한다. 현재 부모 Git에 사이트가 미추적 상태이므로 전체 폴더를 임의 공개하지 않는다.
- [ ] 확인된 원격 저장소에 필요한 변경만 커밋·푸시하고 배포된 결과를 확인한다.
- [ ] 도구별 적용 결과·전체 화면 검사 현황·남은 외부 설정을 최종 보고한다.
