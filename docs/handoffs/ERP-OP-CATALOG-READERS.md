# 공통 원장 읽기 연결 보완

- 저장소 SAJOANSAN, 브랜치 `codex/op-common-catalog`, 시작 `2bda8ccc00f62e030f308ec207e8f0afaa14b9b3`.
- 기존 대시보드·두 거리 화면·통합검색·이관배송 코스 후보의 ERP 연결을 재사용했다. 선택자에 명시적인 `all` / `unclassified` / 검토된 속성 UUID를 허용한다. 작업 센터와 ERP 조회 범위를 구분해 표시한다. 누락 대응과 ERP 오류는 실패하며 구버전 자료로 대체하지 않는다.
- 운영 도우미 snapshot_chat은 `ERP_COURSE_CATALOG_ENABLED=true`에서 `erp-catalog.js`를 사용한다. 실제 요청자의 bearer로 ERP 다섯 원본을 페이지 단위 조회한다. OP 공유 토큰·service role을 사용하지 않는다. 연결별 inherit/set/clear와 빈 문자열을 보존한다. null 마감 시간이 00:00으로 표시되던 변환을 수정했다. 일반 원본 수정 및 다른 AI 모드는 바꾸지 않았다.
- 프런트: `VITE_ERP_COURSE_CATALOG`, `VITE_ERP_COURSE_CENTER_MAP`, `VITE_ERP_COURSE_OPEN_URL`; Vercel 프록시: `ERP_COURSE_CATALOG_URL`; Edge: `ERP_COURSE_CATALOG_ENABLED`, `ERP_COURSE_CATALOG_URL`, `ERP_COURSE_CENTER_MAP`. 두 map은 같은 검토된 대응을 사용한다. `all`은 요청자의 기존 권한 안에서 전체이며 전체허용 정책을 만들지 않는다. 실제 운영 설정은 변경하지 않았다.
- 검사: `npm ci --ignore-scripts --no-audit --no-fund`, `npm run build --prefix app`, `node tests/operations-assistant-security.test.mjs`, `node tests/operations-assistant-result-plan.test.mjs`, `NODE_PATH=/workspace/SAJOANSAN-pop-release/app/node_modules node tests/destination-distance.test.mjs` 통과. 거리 검사 첫 실행은 루트의 xlsx 해석 실패였으며 이미 설치된 app 의존성을 지정해 재검사했다. 기존 큰 청크 경고는 유지한다. Edge TS syntax 변환 통과, 실제 Deno 배포/모델 호출은 미실시.
- 테스트에서 caller token, 명시적 비움/빈 문자열, 누락 선택자, 403/503 전달, 페이지 커서 반복 거절, 프런트 전체/미분류 분리를 확인했다. 실제 사용자 브라우저 연결을 검증한 것은 아니다.
- 연결 대상 `https://211.233.219.199:8443/`에 클라우드 Chromium으로 접근했으나 `ERR_CERT_COMMON_NAME_INVALID`. 검증을 끄지 않았다. 현재 환경에는 기존 Windows SSH 연결/로그인 세션이 없다. 운영 서버·배포·DB fence는 변경하지 않았다.
- ERP 쪽 OP 정책/참조 갱신 코드: Ean `44c226b` 및 `docs/transition/OP-COMMON-CATALOG.md`. 실제 최신 사본 대조는 Ean 새 인계 보고서 참조. 일반 직원의 누락 매핑을 OP로 대체하지 않는다.
- 활성화 전에는 실제 배포 브랜치와 차이, Hub→ERP 직원/정책, 각 읽기 화면과 Edge를 확인한다. 다른 직원 중 누가 영향받는지는 운영 계정별 검증 미실시로 확정할 수 없다. 본 브랜치를 push한 것만으로 배포/쓰기 전환 완료가 아니다.
