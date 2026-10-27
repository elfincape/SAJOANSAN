# 삼성 화면 저장 Implementation Plan

**Spec:** docs/superpowers/specs/2026-10-27-samsung-screen-export-design.md
**Architecture:** 문자 앱의 기존 UI/foreground service/token/OneDrive를 재사용한다. 삼성 전용 AccessibilityService와 Download 이미지 접수 유틸리티를 추가한다. 기존 MMS 및 카카오 동작 유지.

- [x] 임시 순수 규칙 검사에서 한국어 날짜/오전오후/명시연도/기간 경계 RED→GREEN 확인.
- [x] 삼성 화면 상태기계: 확인된 번호 뷰어→앨범 처음→안정 위치 후보→번호/날짜 재확인→저장→MediaStore 검증→기존 OneDrive→앨범 복귀/스크롤.
- [x] 기존 작업 토큰을 화면 흐름에 전달, 재시작/중지 경합 방지. 잠금/미확인 화면/불명 위치/목록 변경은 실패 상태로 중단.
- [x] 선택적 새 저장본 삭제, 원본 메시지/RCS 첨부 불변. 새 미디어/접근성/관리 권한과 전체 받은 사진 확인 UI.
- [x] 실제 XML fixture/날짜/큐/Graph/취소 임시 검사, 양 앱 Android build/lint, 기존 웹 build, 독립 리뷰, 같은 문자 APK 서명 확인 및 전달.
