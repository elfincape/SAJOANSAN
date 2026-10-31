# 일일정리 JEV 조합 조사

현재 운영은 공식 OpenAI gpt-6-luna가 본문·사진을 읽고 공통 분석 JSON을 생성한다. JEV는 아직 운영 메일·카톡 분석에 연결되지 않았다. 사용자 요청은 빠른 판단 모델을 실용적으로 조합하는 것이며 모든 단계의 이중 호출이나 UI 확장은 목적이 아니다.

## 확인한 계약

설치된 고정 Hermes SDK와 공식 문서가 같은 POST https://api.typesafe.ai/v1/systemone 계약을 사용한다. model/state/questions를 보내며 model/answers/usage를 받는다. Choice는 폐쇄 후보와 probabilities/confidence, Noul은 noul만 반환한다. 여러 질문은 같은 state에서 독립적으로 평가된다. 후속 질문에 앞선 답이 필요하면 별도 단계로 분리한다. 모델은 jev-1.14.0으로 고정해 비교한다. 사진은 실험적 JEV 기능보다 현재 검증된 Luna 경로를 유지한다. 확률은 정답 보증이나 자동 완료 승인이 아니다.

## 접근 비교

1. Luna 단독: 현행 기준선, 추가 호출 없음.
2. JEV 선분류 후 Luna: 분류가 필요한 모든 항목에 추가 호출이 생기며 추출 결과 검증에는 직접 도움이 적다.
3. Luna 추출 후 선택적 JEV 검증: 불명확한 근거/수신자 역할/기존 업무 후보 연결에만 적용. 현재 조사에서 우선 검증할 제안이다. 확정된 사용자 정정과 코드의 날짜·ID·완료 보호가 항상 우선한다.

## 실제 비민감 한국어 시험

2026-10-31 기존 승인된 TypeSafe 인증을 재사용했고 사용자 메일·사진·전화·주소는 보내지 않았다. 첫 SDK 기본 전송은 cloud proxy 미사용으로 network 실패했다. 같은 공식 endpoint에 환경 proxy를 사용하는 전송으로 성공했다. 제공자를 다른 gateway로 변경한 것이 아니다.

- 3개 독립 의도 선택: 참고/직접요청/동일업무후속 모두 기대와 일치. jev-1.14.0, 224ms, 입력887/출력129토큰.
- 5개 판단: 4P→4톤 및 하차13:15→처리기한 오추출 Noul0.85; 참고품의→개인승인업무 오인0.88; 직접검토요청 근거0.92; 동일후보2건은 unknown(probability0.91/confidence0.86); 명시D1은 D1(probability0.99/confidence0.98). 217ms, 입력1146/출력138토큰.
- 각 요청1회이므로 p50/p95/전체정확도나 Luna보다 빠르다는 결론은 내리지 않는다. 제공자 공식 가격을 적용한 단순 입력비용 추정은 총2033토큰×$0.042/백만=$0.000085386이며 실제 청구 확인은 별도다.

## 적용 전 남은 검증

같은 한국어 합성 세트로 Luna 단독/JEV선분류+Luna/Luna후JEV검증을 비교한다. 잘못된할일·연결·누락, p50/p95, 실제 usage와 실패를 분리한다. 애매한 후보는 none/unknown으로 남기고 JEV 실패는 기존 정상 경로나 확인필요를 보존한다. JEV가 완료를 직접 확정하거나 사용자정정을 덮어쓰지 않는다. 현재 실제 회사메일은 JEV에 추가 전송하지 않았다. 새로운 공급자 전송 범위는 합성 시험과 구분한다. 운영에 가짜 업무를 저장하지 않는다.

## 근거

- .agent-tools/JEV.md, .agent-tools/jev/sources-lock.json, 설치 Hermes jevkit/client.py·docs/mailbox-sorting.md
- https://docs.typesafe.ai/api/system-one
- https://docs.typesafe.ai/cookbooks/sde_cascade
- https://docs.typesafe.ai/cookbooks/entity_alignment
- https://docs.typesafe.ai/cookbooks/parallel_questions
- https://docs.typesafe.ai/primitives/choice
- https://docs.typesafe.ai/primitives/noul
- https://typesafe.ai/legal/privacy-policy

공식 서비스의 보관·미국처리 정책은 기본 ZDR을 뜻하지 않는다. 커뮤니티 mailbox helper의 자동분류·임계값·가격 예시는 이 제품의 검증 결과나 공식 정확도 보장이 아니다.
