# JEV 일일정리 비교 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Luna의 정상 분석을 유지하며 JEV 근거·업무연결 검증의 실익을 측정한다.

**Architecture:** Luna는 해석·요약·공통 JSON을 담당한다. JEV는 검토가 필요한 제한된 후보만 평가하고 코드가 날짜·ID·완료·정정을 보존한다. 운영 활성화는 합성 비교 결과와 실제 전송 범위를 구분한다.

**Tech Stack:** 기존 Deno Edge/JavaScript, official OpenAI Responses, TypeSafe REST. Node22 SDK를 Deno에 설치하지 않는다.

**Spec:** docs/superpowers/specs/2026-10-31-jev-daily-analysis-study.md

## Global Constraints

- UI 확장, 새 자격증명, 운영 가짜 업무 저장 없음.
- 한국어 비민감 합성 자료만 사용한다.
- 제브 모델 jev-1.14.0, Luna 모델 gpt-6-luna.
- 사용자 정정·완료·날짜 보존과 기존 공통 JSON 검증 유지.

## Review Focus

- 참고 품의가 개인 승인 업무로 오인되지 않음.
- 동일 후보 다수는 임의 연결하지 않음.
- 4P·하차시각을 톤수·처리마감으로 오해하지 않음.
- 네트워크 실패가 정상 분석을 막거나 참고로 위장되지 않음.
- Noul을 Choice confidence처럼 읽지 않음.

### Task 1: 같은 자료의 비교

**Files:** 기존 tests/private-mail.test.mjs를 확장하고 실제 호출 자료는 /tmp에 둔다.

**Interfaces:** 합성 source/proposed/candidates → 기대판단과 실제 model/status/usage/latency/error 기록.

- [x] 설치 SDK·공식 API 계약 대조.
- [x] 합성 한국어 의도3개·근거/후보판단5개 JEV 실제 호출.
- [ ] 같은 세트의 Luna 단독과 두 조합을 실행하고 p50/p95·오류·비용을 비교. 최소 표본 수와 재현 fixture를 기록한다.
- [ ] 실패·모호후보·잘못된확률 계약 모의 검증.

### Task 2: 비교로 확인된 경로만 구현

**Files:** supabase/functions/onedrive-auth/private-mail-analysis.js 및 별도 작은 JEV REST adapter, 기존 tests/private-mail.test.mjs.

**Interfaces:** 유효 후보와 비민감 테스트 상태 → advisory judgment 또는 unavailable. 기존 정규화와 저장 인터페이스는 유지한다.

- [ ] 비교에서 실익이 확인된 판단에 대한 실패 회귀부터 추가한다.
- [ ] 고정 endpoint/model, timeout·유한재시도·응답계약 검증과 fallback을 구현한다.
- [ ] JEV 결과가 직접 완료·담당·기한·사용자정정을 바꾸지 않는지 검증한다.
- [ ] 기존 관련 검사·운영 전송 범위·실제검증 여부를 분리해 보고한다.
