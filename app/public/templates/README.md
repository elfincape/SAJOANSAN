# 1탑2실 템플릿 기본 파일 위치

`admin/daily-temperature.html`은 선택한 센터에 따라 아래 기본 템플릿을 불러옵니다.

```text
사조안산센터: repo-root/templates/one-top-two-room-template.xlsx
사조평택센터: repo-root/templates/one-top-two-room-template_PYT.xlsx
```

`admin/one-top-two-room-work.html`은 선택 센터가 평택(`002`)이면 아래 평택 전용 파일을 사용합니다.

```text
repo-root/templates/one-top-two-room-template_PYT.xlsx
```

운영 중 기본 템플릿을 교체하려면 GitHub에서 같은 경로/파일명으로 Excel 파일을 업로드하거나 덮어쓰면 됩니다.
화면의 파일 업로드는 기본 템플릿을 바꾸지 않고 현재 작업에서만 임시로 교체합니다.

## 쿠팡 입문확인 템플릿

`admin/coupang-entry.html`은 접속 시 아래 파일을 우선 기본 템플릿으로 불러옵니다.

```text
repo-root/templates/sazocoupang.xlsx
```

G6:G23에는 납품시간이 있어야 하며, I/J부터 오른쪽 2칸 단위로 하차지/종사자명이 입력됩니다.

## 쿠팡 입문확인 API 프록시

브라우저에서 AIAPIFlow 직접 호출이 CORS로 막히면 Supabase Edge Function을 배포해야 합니다.

```bash
supabase functions deploy coupang-vision
supabase secrets set AIAPIFLOW_API_KEY=<키값>
```

프론트는 먼저 `coupang-vision` 함수를 호출하고, 실패할 때만 브라우저 직접 호출을 fallback으로 시도합니다.

## GitHub Actions Supabase Edge Function 자동 배포

`main` 브랜치에 `supabase/functions/coupang-vision/**` 변경사항이 push되면 `.github/workflows/deploy-supabase-functions.yml` workflow가 `coupang-vision` 함수를 자동 배포합니다.

GitHub 저장소의 **Settings > Secrets and variables > Actions > Repository secrets**에 아래 3개 값을 추가해야 합니다.

| Secret 이름 | 넣을 값 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase 계정 Access Token |
| `SUPABASE_PROJECT_REF` | Supabase 프로젝트 ref. 현재 프로젝트는 `vvrppotrnpwrwpwqaiet` |
| `AIAPIFLOW_API_KEY` | AIAPIFlow API 키 |

workflow에서 실행하는 핵심 명령은 아래와 같습니다.

```bash
supabase secrets set AIAPIFLOW_API_KEY="$AIAPIFLOW_API_KEY" --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy coupang-vision --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt
```
