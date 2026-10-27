# 삼성 URI 배치 계획

Spec: docs/superpowers/specs/2026-10-27-samsung-uri-batch-design.md

- [x] 전체 대상 1차 수집, 목록 재검증 후 순서별 처리, 모든 계획 항목 완료 검사 및 진행 건수.
- [x] 선택된 원본 content URI의 일회 수신 Activity와 큐 접수, 업로드 후 private 사본 제거, 기존 파일 검색/저장 클릭 제거.
- [x] 요청 중 외부 공유만 읽는 수명/취소/정확한 payload 검증. 공유 UI 자동 선택 및 복귀 확인.
- [x] 번호 대화 열기 intent와 헤더/공유메뉴 탐색, 초기 수동 사진 선택은 fallback으로만 유지.
- [x] 실제 상태기계 배치 모의, URI payload/읽기/기존 이미지 처리/실패 큐/정리/취소 회귀, 양 앱 build/lint, 웹 build, 독립 리뷰, APK 동일 서명, 커밋/Push.
