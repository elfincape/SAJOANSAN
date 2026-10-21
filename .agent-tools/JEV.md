# JEV 브라우저 도구

설치일: 2026-10-21. 사용자가 제공한 TypeSafe JEV API를 사용한다. 다음 MIT 프로젝트를 고정 버전으로 설치했다. 개인·커뮤니티 도구이며 TypeSafe 공식 배포로 단정하지 않는다.

| 도구 | 고정 버전 | 실행 |
| --- | --- | --- |
| [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` | `python3 .agent-tools/jev/run.py ultrafast` |
| [jiawei686/jev-ultrafast-mcp](https://github.com/jiawei686/jev-ultrafast-mcp) | 0.1.5 / `6b2e275a98a4429c2f91135f67092fb5cf062f8a` | `python3 .agent-tools/jev/run.py mcp` |
| [kerpopule/hermes-jev-skills](https://github.com/kerpopule/hermes-jev-skills) | `53dbc1d0e33d3129f44e230a81aef4c5c3cdb4c0` | `python3 .agent-tools/jev/run.py hermes --help` |

MCP 스킬 1개와 Hermes 스킬 12개를 `.agents/skills`에 설치했다. Mac 전용 `typesafe-computer-use` 및 Hermes `jev-computer-use`는 제외했다. 플랫폼 공용 브라우저·판단·검색 스킬은 포함한다. 부가 앱(Blender 등), Hermes 에이전트 본체, 모델 자동 전환, 전역 설정·훅은 설치하지 않는다. 작업과 관련된 스킬만 적용한다.

## 복구 및 연결

Python 3.12+, uv, Chrome/Chromium이 필요하다. 소스는 archive SHA-256과 Git SHA로 고정하고 런타임 의존성은 uv.lock으로 고정한다. 공용 가상환경 하나를 사용한다.

```sh
python3 .agent-tools/jev/install.py
uv sync --project .agent-tools/jev --locked --no-dev
python3 .agent-tools/jev/run.py hermes --help
```

`.codex/config.toml`에 JEV MCP를 기존 REA·Serena와 함께 등록했다. **신뢰된 프로젝트에서 Codex 세션을 재시작해야 새 MCP가 로드된다.** 현재 대화에 도구가 노출된 것과 설정·서버 실행 검증은 다르다. CLI는 즉시 실행할 수 있다.

키는 환경변수 `TYPESAFE_API_KEY` 또는 gitignore된 `.agent-tools/jev/.env.local` JSON 파일에 둔다. JSON 키는 `TYPESAFE_API_KEY`이며 파일 권한을 0600으로 설정한다. 실제 키는 문서·소스·MCP 설정에 기록하지 않는다. 환경변수가 로컬 파일보다 우선한다. 임의 셸 코드는 실행하지 않는다. 설치 복구 시 키는 복원되지 않는다.

MCP는 기본적으로 headless Chrome을 별도 프로필로 실행한다. MCP·browser-harness·Hermes 상태와 프로필의 기본 경로는 `.agent-tools/jev/state`로 격리한다. `JEVMCP_CHROME`/`BH_CHROME_PATH`로 브라우저 경로, `JEVMCP_HEADLESS=0`으로 화면 표시를 지정할 수 있다. 일반 사용자의 브라우저 프로필에 자동 연결하지 않는다.

## 사용과 완료 판정

`browser_goal`은 JEV가 관측된 요소에서 다음 동작을 선택한다. 결과는 `verify` 또는 `browser_assert`로 확인한다. `browser_open/observe/act/assert` 같은 직접 조작에는 JEV 토큰이 들지 않는다. 실배차 품질·실제 사용자 발생률을 모델의 점수로 증명하지 않는다. 운영 데이터와 모의 데이터 검증을 구분한다.

Hermes 브라우저 러너도 같은 가상환경과 Ultrafast 소스를 사용한다.

```sh
python3 .agent-tools/jev/run.py browser --url http://127.0.0.1:5173 --goal 'Open the dispatch screen without submitting any data.' --allow-hosts 127.0.0.1 --expect '배차' --max-ticks 10 --json
```

클릭·이동은 TypeSafe 키로 동작한다. 원본 Ultrafast의 텍스트 생성은 별도 `TEXT_MODEL_API_KEY`와 모델 설정이 필요하다. 미설정 상태에서 자유 입력이 검증됐다고 주장하지 않는다. 업스트림의 `jev` 실행 파일 이름이 겹치므로 전역 PATH에 두 개를 설치하지 않고 `run.py`의 모드로 구분한다.

이전 조사 후보 `jkudish/jev-mcp`, `jev-review`는 이번 설치 대상에 포함하지 않았다. 기존 관리웹 배차 API·DB·UI·배차 정책은 이번 개발 도구 설치로 바뀌지 않는다.

## 설치 검증 결과

- MCP 초기화 및 도구 10개 조회 성공.
- 실제 TypeSafe JEV 호출로 로컬 모의 페이지 버튼을 선택하고 `browser_assert`로 목표 문구 확인 성공(MCP 경로 2,471 tokens).
- 원본 Ultrafast + Hermes 브라우저 러너도 별도 Chromium에 연결하여 1회 클릭 후 독립 heading 검사 성공. 이 런타임의 루트 사용자 제약으로 러너 검증에는 별도 시작한 headless Chromium을 명시적 CDP로 연결했다. 일반 브라우저 프로필은 사용하지 않았다.
- 운영 로그인·운영 데이터 수정·자유 입력은 이 설치 검증 범위에 포함하지 않았다.
- uv 잠금 설치, 스킬 원본 해시, 웹 lint·production build 통과.
