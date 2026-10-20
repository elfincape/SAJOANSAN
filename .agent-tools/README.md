# 관리웹 개발 스킬

공식 스킬 7개를 `.agents/skills/`에 설치했다. `.agents/skills-lock.json`에 출처, 고정 버전, 파일 해시를 기록했으며 원본 라이선스를 각 스킬의 `upstream-licenses/` 또는 `LICENSE.txt`에 보존했다. 스킬 폴더는 Codex의 프로젝트 검색 경로다. 현재 채팅에서 새 스킬 목록이 즉시 갱신되지 않으면 다음 채팅에서 다시 검색하며, 현재 작업에서는 해당 `SKILL.md`를 직접 읽어 사용할 수 있다.

| 스킬 | 적용 작업 |
| --- | --- |
| UI UX Pro Max | 기존 화면의 색, 타이포, 간격, 모바일 UX |
| Web Design Guidelines | 접근성, 테마, 폼·키보드 조작 리뷰 |
| Webapp Testing | 기존 Playwright로 실제 브라우저 흐름 검증 |
| Property-Based Testing | 물량·상차 한도·분할·저장 복원 규칙 검증 |
| Differential Review | 변경된 권한·데이터 흐름과 회귀 리뷰 |
| React Best Practices | React를 실제 도입하는 작업에 한해 사용 |
| REA | 외부 프로그램·배포 번들의 기능과 동작 분석 |

Supabase와 Superpowers는 현재 연결된 플러그인에서 제공하므로 복사하지 않는다. 다른 개발 환경에서 제공되지 않으면 각각 https://github.com/supabase/agent-skills 와 https://github.com/obra/superpowers 의 공식 설치 절차를 사용한다.

Anthropic XLSX는 외부 복제·배포 제한이 있어 포함하지 않는다. 기존 SheetJS·ExcelJS 흐름과 사용 가능한 스프레드시트 도구로 엑셀 업무를 수행한다. 이 설치로 웹 런타임, React 도입 여부, DB 구조, 배차 정책을 변경하지 않는다.

## UI 검색

저장소 루트에서 실행한다. 제안은 기존 제품과 업무 규칙에 맞게 검토하며 그대로 적용하지 않는다.

```sh
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "dashboard table contrast" --domain ux
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "logistics dashboard" --stack html-tailwind
```

## REA 6.7.0

Node.js 22.19+, 24.11+, 또는 26+가 필요하다. 웹의 package.json과 분리하여 버전을 고정했다. 새 체크아웃에서는 다음 명령으로 복구한다.

```sh
npm ci --prefix .agent-tools/rea --ignore-scripts --no-audit --no-fund
node .agent-tools/rea/node_modules/rea-agents/scripts/rea.mjs --version
node .agent-tools/rea/node_modules/rea-agents/scripts/rea.mjs analyze-javascript-application /absolute/path/to/shipped-app --format json
```

`.codex/config.toml`은 위 프로젝트 설치를 사용하는 REA MCP 연결을 등록한다. 이 저장소 루트에서 Codex를 열고 도구 설치 후 세션을 재시작해야 새 MCP가 로드된다. 이 설정 파일을 추가한 것과 현재 채팅에 MCP 도구가 연결된 것은 다르다. CLI는 재시작 없이 사용할 수 있다. 프로젝트 설정은 신뢰된 프로젝트에서만 적용된다.

일반 자체 소스 분석에는 REA를 실행하지 않는다. Hopper·Ghidra 등은 설치하지 않았으며 네이티브 디컴파일에는 별도 분석 엔진이 필요하다. 정적 JavaScript 분석은 이 엔진 없이 동작한다.

공급업체 원본 스킬은 수정하지 않는다. 프로젝트별 예외·적용 기준은 루트 AGENTS.md에서 관리하고 업데이트 시 출처 버전과 해시를 다시 기록한다.

## 원본 보존과 외부 규칙

Git 공백 검사는 `.agents/skills/`의 공급업체 원본에만 적용하지 않는다. upstream의 공백까지 그대로 보존하여 잠금 파일 해시와 일치시키기 위한 설정이며, 프로젝트가 작성한 코드·설정·문서의 공백 검사는 유지한다.

Web Design Guidelines는 실행 시 upstream `main`의 규칙을 가져온다. 잠금 파일은 설치된 스킬 파일만 고정하며 원격 규칙까지 고정하지 않는다. 리뷰 결과를 남길 때 적용한 원격 규칙의 조회 시점 또는 커밋을 함께 기록한다.

## 추가 디자인·코드 도구

- Impeccable 4.7.0 / 엔진 0.1.16: 공식 Codex 프로젝트 설치. 기존 PRODUCT.md와 DESIGN.md를 사용하고 자동 편집 훅은 설치하지 않았다. 스킬 문서·런처는 커밋하고 플랫폼 바이너리는 제외한다.
- Ponytail: 공식 core/review/audit/debt/help/gain 스킬을 고정 커밋으로 설치했다. 벤치마크 수치는 upstream 주장이고 이 관리웹의 실측 개선량으로 사용하지 않는다.
- awesome-design-md: Airtable·Linear·IBM 자료와 MIT 고지를 고정 버전으로 포함했다. 전체 디자인을 교체하지 않고 기존 업무 화면의 정보 위계·일관성 참고로 사용한다.
- Serena 2.1.0: GPL-3.0-or-later 독립 개발 도구이며 웹 배포물에 포함하지 않는다. Python 환경과 uv.lock을 분리하고 .serena/project.yml로 JavaScript 심벌을 인덱싱한다. HTML 인라인 코드나 CSS의 의미 분석을 보장하지 않는다.

새 체크아웃에서 다음 명령으로 복구한다.

```sh
npm ci --prefix .agent-tools/design --ignore-scripts --no-audit --no-fund
node .agent-tools/design/node_modules/impeccable/cli/bin/cli.js install --providers=codex --scope=project --no-hooks --yes
uv sync --project .agent-tools/serena --frozen --no-dev
```

Serena MCP는 `.codex/config.toml`에 연결했다. 저장소 루트에서 신뢰된 프로젝트로 세션을 재시작해야 현재 도구 목록에 표시된다. 대시보드·GUI 창 자동 실행은 끄고 상태·다운로드된 언어 서버는 `.agent-tools/serena/state/`에 보관한다. 설치 후 언어 서버는 첫 프로젝트 활성화 시 필요에 따라 다운로드된다.

Lenis 1.3.27은 웹의 고정 의존성으로 추가했다. 패키지 모듈을 처리하지 않는 정적 파일 미리보기에서는 기본 스크롤로 동작한다.
