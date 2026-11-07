# BMAD 설치와 사용

공식 안정판 `bmad-method@6.12.4`를 프로젝트에 설치했다. v7 preview, 별도 게임·테스트·자동 실행 확장 모듈, 호환용 구형 명령은 설치하지 않는다.

- 출처: https://github.com/bmad-code-org/BMAD-METHOD
- 고정 소스·npm 무결성: `_bmad/install-source.json`
- 스킬 소스·SHA-256: `.agents/skills-lock.json`
- 공통 런타임·설정: `_bmad/`
- Codex 스킬: `.agents/skills/bmad-*` (29개)
- 공식 MIT 라이선스: `_bmad/LICENSE`
- 기획 산출물: `docs/bmad/planning-artifacts/`
- 구현 산출물: `docs/bmad/implementation-artifacts/`

공통 설정은 `_bmad/custom/config.toml`에 둔다. 프로젝트명은 SAJOANSAN ERP, 대화·문서는 한국어다. 사용자 이름 등의 로컬 설정과 생성된 렌더 캐시는 Git에서 제외한다.

## 확인과 복원

```sh
npx --yes bmad-method@6.12.4 status
uv run _bmad/scripts/resolve_config.py --project-root "$PWD"
```

새 개발 환경에서는 기존 스킬을 먼저 확인한다. 설치를 복원해야 할 때만 다음 고정 버전 명령을 사용한다. 최신 버전으로 자동 업그레이드하지 않는다.

```sh
npx --yes bmad-method@6.12.4 install --directory "$PWD" --modules bmm --tools codex --no-shims --communication-language Korean --document-output-language Korean --output-folder docs/bmad --set bmm.project_knowledge=docs --yes
```

## ERP 설계에 사용할 스킬

- `bmad-help`: 기존 문서와 현재 단계 확인
- `bmad-product-brief` / `bmad-prd`: 제품 목표·사용자·업무 범위와 요구사항
- `bmad-ux`: 정보 구조·사용 흐름·디자인 기준
- `bmad-architecture`: 공통 구조·업무 경계·데이터 및 권한·확장 규칙

설치 완료는 ERP 설계 완료를 뜻하지 않는다. 기존 PRODUCT.md·DESIGN.md·AGENTS.md를 먼저 읽고, 운영 구조와 차이를 확인하며 설계한다. 새 스킬 목록이 현재 채팅에 즉시 반영되지 않으면 해당 SKILL.md를 직접 읽을 수 있다.

BMAD는 개발 시 사용하는 도구다. 앱 번들·DB·업무 데이터·API 모델·인증 설정을 바꾸지 않으며 설치만으로 에이전트·자동 구현·운영 배포를 시작하지 않는다.
