# 브라우저 기본 검증

기존 `node:test`와 Playwright를 재사용합니다. 별도 테스트 프레임워크는 설치하지 않습니다.

```sh
npm ci
npm run test:browser:install
npm run test:browser
```

로컬 전용 HTTP 서버와 임시 브라우저 컨텍스트를 사용합니다. 로그인 성공·실패, 미인증 접근 차단, 대시보드 조회·검색, 업무 포털 초기화·보기 전환을 검사합니다.

실제 인증과 화면 모듈은 그대로 실행하며 `/js/supabase.js`만 테스트 응답으로 대체합니다. 테스트 계정은 `browser@example.test` / `browser-test-password`이며 실제 계정이 아닙니다. DB 쓰기와 외부 함수 호출은 실패 처리하고 외부 네트워크 요청은 차단합니다. Tailwind CDN과 웹 폰트는 빈 응답으로 대체하므로 시각적 디자인 검증은 포함하지 않습니다.

스크린샷·영상·트레이스는 수집하지 않으며 자동 재시도도 없습니다. 기존 CI와 배포 설정은 변경하지 않습니다. 설치된 Chromium을 쓰려면 `BROWSER_EXECUTABLE`에 실행 파일의 절대 경로를 지정할 수 있습니다.
