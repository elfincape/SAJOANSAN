# 관리허브 React 앱

기존 화면·주소·Supabase 계약을 유지한 React + TypeScript + Vite 앱입니다. 기존 소스는 저장소의 `repo-root/`, 메일 함수는 루트 `api/`와 `server/`에 남아 있습니다.

## 로컬 실행

```sh
cd app
npm ci
cp .env.example .env
# .env에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 설정
npm run dev
```

실제 키를 커밋하지 않습니다. `.env`는 무시됩니다. 문서 본문 검색 주소는 필요할 때 `VITE_DOCUMENT_SEARCH_URL`로 지정할 수 있습니다.

```sh
npm run build
```

`src/page-paths.ts`가 기존 URL과 화면을 연결합니다. 빌드 시 각 페이지 제목을 유지한 공통 진입 HTML을 기존 경로에도 생성하므로 `/admin/*.html`, `/portal/`, `/login.html`을 직접 열거나 새로고침할 수 있습니다. 원래 제공하던 `assets/`, `templates/`, `sql/` 정적 자료도 유지합니다. SQL 파일은 실행하지 않습니다.

## Vercel

| 설정 | 값 |
| --- | --- |
| Root Directory | 저장소 루트 (`.`) |
| Install Command | `npm ci --omit=dev && cd app && npm ci` |
| Build Command | `cd app && npm run build` |
| Output Directory | `app/dist` |

루트 메일 함수가 `postal-mime`을 루트에서 불러오므로 루트 런타임 의존성도 설치합니다. `api/`를 `app/`으로 이동하거나 프런트 번들에 포함하지 않습니다. 기존 함수의 리전·시간 제한은 유지합니다.

Vercel의 해당 배포 환경에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 설정해야 합니다. 기존 메일 서버 환경변수는 그대로 유지합니다. 로컬 Vite 서버만으로 루트 메일 수신 함수를 실행하지는 않습니다.

## 확인 범위

TypeScript/Vite 빌드, 기존 모델과의 비교, 모의 DB·AI·OneDrive·메일 응답을 사용한 브라우저 검증을 수행했습니다. 원본과 같은 데이터로 주요 화면의 밝은/어두운 테마 및 데스크톱/모바일 배치를 비교했습니다. 운영 DB 변경, 실제 메일 수집, 실제 AI 호출 및 main 배포는 수행하지 않았습니다.

사용자가 없다고 확인한 평택 `one-top-two-room-template_PYT.xlsx`는 만들지 않았으며 기존 누락 안내를 유지합니다. 이전의 상세 기록은 `../docs/react-migration/progress.md`를 참고하세요.
