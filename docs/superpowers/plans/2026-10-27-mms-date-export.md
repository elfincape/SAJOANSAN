# MMS 기간 저장 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. 저장소 테스트 파일 추가 금지 규칙에 따라 임시 검증은 /tmp에서 수행한다.

**Goal:** 특정 번호의 기간 내 수신 MMS 사진을 OneDrive로 보존한다.
**Architecture:** 별도 mms 모듈에서 기존 Store/OneDrive/Rules 공유. 읽기 전용 MMS 조회, 전용 foreground 작업 서비스.
**Tech Stack:** Android 33+, Java 17 source, AGP 8.7.3, 기존 Graph HTTP.
**Spec:** docs/superpowers/specs/2026-10-27-mms-date-export-design.md

## Global Constraints

- 기존 카카오 앱/웹/DB 동작 유지, 문자 원본 삭제 금지.
- KST 날짜 양끝 포함, FROM 정확 일치, 이미지 원본/재시도 안정성 유지.
- READ_SMS 제한 및 실제 단말 미검증 명시, 비밀키 커밋 금지.

## Review Focus

- +82/구분기호 정규화와 잘못된 번호의 거짓 일치.
- 종료일 자정/윤일/역전 범위.
- MMS 중복/완료되지 않은 사진/지원 안 되는 이미지.
- 네트워크 중단 및 취소 후 큐 복구.
- 제한 권한 거부 및 MMS 조회 0건을 성공으로 과장하지 않기.

### Task 1: MMS 규칙과 읽기 전용 접수

- [x] /tmp에 날짜 경계, 번호 정규화, 이미지 헤더, 안정 접수 ID 검증을 작성하고 누락 구현으로 실패 확인.
- [x] MmsRules.java에 정규화, 기간, 이미지 검증, 접수 ID를 구현하고 검증 통과.
- [x] MmsSource.java에서 수신 완료 MMS/발신번호/이미지 parts를 읽고 기존 큐 형식으로 원자 접수. 미완성 접수 제거, 완료 접수 재사용.

### Task 2: 기간 UI·서비스·OneDrive 재사용

- [x] 별도 mms 모듈에 번호/달력/권한/로그인/저장/중지 UI 및 foreground service 연결.
- [x] OneDrive의 mms 접수에만 문자/번호 경로를 적용. 기존 경로 불변 모의 검증.
- [x] 현재 기간/번호 큐만 재시도, 실패/취소/미다운로드 건수 표시.

### Task 3: 검증·전달

- [x] Android assemble/lint 및 기존 웹 build. 임시 MMS provider/Graph 검증 및 권한·원본 삭제 없음 리뷰.
- [x] 새 독립 APK와 설치 안내를 저장소 밖에 생성, 커밋/Push.
