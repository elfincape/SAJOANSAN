# 1탑2실 템플릿 기본 파일 위치

`admin/daily-temperature.html`은 접속 시 아래 파일을 우선 기본 템플릿으로 불러옵니다.

```text
repo-root/templates/one-top-two-room-template.xlsx
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
