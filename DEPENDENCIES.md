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

## 실행 및 배포

- `npm run dev`: Vite 개발 서버. 기존 HTML·Vanilla JavaScript 구조를 유지합니다.
- `npm run build`: 모든 HTML 화면과 npm 의존성을 `repo-root/dist`로 빌드합니다.
- `npm run preview`: 빌드 결과를 로컬에서 확인합니다.
- `npm run lint`, `npm run format:check -- <파일>`, `npm run test:browser`: 기존 개발 도구 명령입니다.

GitHub에 연결된 Vercel은 포함된 `vercel.json`에 따라 빌드합니다. 프로젝트 Root Directory가 저장소 루트 또는 `repo-root`인 경우를 지원합니다. 파일 다운로드에 사용하는 기존 템플릿도 빌드 결과에 포함합니다.

## 연결된 화면

- 관리 허브 → 데이터·Excel 편집 도구: AG Grid, ExcelJS, Uppy를 사용하며 파일은 서버에 업로드하지 않습니다.
- 관리 허브 → PDF IMG 변환기: PDF.js, pdf-lib로 미리보기·편집·병합·분할·변환합니다. 기존 기사 서류 등록 버튼만 OneDrive에 저장합니다.
- 관리 허브 → 개인 일정 도구: FullCalendar 일정은 계정별로 이 브라우저에 저장하며 기기 간 동기화하지 않습니다.
- 관리 허브 → 문서 편집 도구: Tiptap 초안은 계정별로 이 브라우저에 저장하고 HTML/TXT로 내보냅니다.

## PC 로컬 배차 계산

1. 위 OR-Tools 설치를 완료한 PC에서 `npm run optimizer`를 실행합니다.
2. 관리 허브 → 로컬 배차 계산에서 실행 창의 연결 키를 입력합니다. 연결 키는 서버를 재시작하면 바뀌며 브라우저에 저장하지 않습니다.
3. 예제 JSON을 실제 지점명·이동시간 행렬·물량·차량 적재량으로 바꾸고 계산합니다. 입력은 해당 PC의 `127.0.0.1` 서버로만 전송합니다.

기본 포트는 8765이며 `npm run optimizer -- --port 8766`으로 변경할 수 있습니다. 브라우저에서 로컬 네트워크 접근이 차단되면 허용하거나 `npm run dev`로 연 로컬 화면에서 계산합니다. 기본 운영 주소는 `https://sajoansan.vercel.app`이며 다른 운영 주소는 `SAJO_OPTIMIZER_ORIGINS` 환경 변수에 쉼표로 구분해 지정합니다.

계산은 센터 출발·복귀, 이동시간 최소화와 적재량 제약을 적용한 초안입니다. 지도 API·업무 DB를 호출하지 않으며 납품 마감·하차시간·실시간 교통·실제 차량 확보는 포함하지 않습니다. 로컬 서버가 종료되면 계산 연결도 종료됩니다.
