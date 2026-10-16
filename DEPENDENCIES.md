# 개발 도구와 라이브러리 설치

Node.js 22.13 이상 또는 24 이상과 Python 3.12를 권장합니다.

```sh
npm ci
npm run test:browser:install
python -m venv .venv
```

Windows에서는 `.venv\Scripts\python -m pip install -r requirements.txt`, macOS/Linux에서는 `.venv/bin/python -m pip install -r requirements.txt`로 OR-Tools를 설치합니다.

| 도구              | 설치 패키지                           |
| ----------------- | ------------------------------------- |
| ESLint            | `eslint`                              |
| Prettier          | `prettier`                            |
| Playwright        | `playwright`                          |
| AG Grid Community | `ag-grid-community`                   |
| PDF.js            | `pdfjs-dist`                          |
| pdf-lib           | `pdf-lib`                             |
| ExcelJS           | `exceljs`                             |
| FullCalendar      | `fullcalendar`                        |
| Tiptap            | `@tiptap/core`, `@tiptap/starter-kit` |
| Uppy              | `@uppy/core`, `@uppy/dashboard`       |
| Google OR-Tools   | Python `ortools`                      |
| Vite              | `vite`                                |

npm 패키지의 정확한 버전과 하위 의존성은 `package-lock.json`에 기록합니다. OR-Tools는 브라우저용 JavaScript 패키지가 아니며 Python 환경에서 사용합니다.

이번 변경은 의존성 설치입니다. 기존 CDN 참조와 화면·인증·DB·배포 방식은 유지하며, 새 기능의 화면 연결과 Vite 빌드 전환은 포함하지 않습니다.
