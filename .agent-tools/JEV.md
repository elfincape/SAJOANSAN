# JEV용 스킬·MCP 조사

확인일: 2026-10-20. 관리웹에서 사용하는 JEV는 TypeSafe의 System One API(`https://api.typesafe.ai/v1/systemone`)다. 플러그인 디렉터리에서는 일치 항목을 찾지 못했지만 GitHub에서 다음 공개 프로젝트를 확인했다. 개인·커뮤니티 저장소이며 TypeSafe가 공식 유지관리하는 배포로 확인한 것은 아니다.

| 후보 | 제공 기능 | 관리웹 개발에서의 용도 |
| --- | --- | --- |
| [jkudish/jev-mcp](https://github.com/jkudish/jev-mcp) | npm `@jkudish/jev-mcp` 0.14.4, MCP와 `skills/jev` 동봉, MIT | 증거 대조 `jev_verify`, 선택 `jev_decide`, 후보 순위 `jev_rerank`, 추출값 검증 `jev_audit` 등 |
| [dbreunig/building-with-jev-skill](https://github.com/dbreunig/building-with-jev-skill) | `skills/jev/SKILL.md`, 질문·상태·판단 결합·실패 분석 지침 | JEV를 호출하는 개발 코드의 질문 설계와 검증 방법 참고. README는 `jev-1.13` 기준으로 설명; 라이선스 파일이 확인되지 않아 복제하지 않음 |
| [NiazMorshed2007/jev-review](https://github.com/NiazMorshed2007/jev-review) | 로컬 MCP `jev_review`, 리뷰 스킬, MIT, GitHub 배포 | 제공한 코드·diff를 여러 품질 축으로 평가하는 개발 리뷰 보조 |

## 적용 판단

이번 요청의 JEV 범위는 존재·용도 조사이며 위 추가 MCP/스킬을 설치하거나 자동 평가 루프를 실행하지 않았다. 기존 검증된 JEV API 경로는 유지한다.

범용 판단 도구가 필요하면 `jkudish/jev-mcp`, 코드 품질 축 평가가 필요하면 `jev-review`가 후보이다. 이 관리웹의 배차 품질은 실제 물량·실배차·거리·고정차 데이터와 불변 조건 검증으로 확인해야 하며, 코드 점수와 모델 판단값으로 대체할 수 없다.

`jev-mcp`의 현재 문서는 텍스트 기반 state와 텍스트 판단 도구를 설명하며 이미지 입력용 API를 제공하지 않는다. JEV 자체가 이미지를 처리하지 못한다는 뜻은 아니다. 이 관리웹에서 이미 검증한 실험적 이미지 API는 별도 이미지 자산과 헤더를 사용하는 경로이므로 화면 판독 평가는 기존 방식으로 수행한다. 문서의 이미지 비지원 서술을 현재 API 전체의 한계로 전파하지 않는다.

실제로 연결할 때는 버전을 고정하고 공식 API로 직접 요청하는지·요청에 어떤 코드와 데이터가 포함되는지 확인한다. `TYPESAFE_API_KEY` 또는 도구가 요구하는 환경변수로 키를 전달하고 소스·스킬·MCP 설정에 실제 키를 적지 않는다. MCP 설정과 현재 채팅에서의 도구 연결 여부, 모의 서버 검증과 실제 JEV 호출 검증을 구분한다.

## 확인한 출처

- TypeSafe API OpenAPI: `https://api.typesafe.ai/openapi.json`
- TypeSafe 개발 문서: `https://docs.typesafe.ai`
- jev-mcp README/코드 확인 커밋: `75cf447a8a1c22d11bf606547d8d7616015ede5f`
- 질문 설계 스킬 확인 커밋: `04fe3666c6b8b8abfec1271c0e581c823a181f6d`
- jev-review 확인 커밋: `57690af54ef7d862c2483342c1e61c14dffcf727`
