# 개발 도구와 라이브러리

Node.js 22.13 이상 또는 24 이상을 권장합니다.

```sh
npm ci
npm run test:browser:install
```

| 구분 | 도구 | 용도 |
| --- | --- | --- |
| 개발 | ESLint | JavaScript 구문·기본 오류 검사 |
| 개발 | Prettier | 변경 파일 형식 검사 |
| 개발 | Playwright | 기존 주요 화면의 브라우저 회귀 검사 |
| 개발·배포 | Vite | 기존 HTML·Vanilla JavaScript 다중 페이지 빌드 |
| 기존 코스 관리 | AG Grid Community | 코스 목록 정렬·필터·열 너비 조절 |
| 기존 Excel 화면 | ExcelJS | 템플릿 읽기·수정과 XLSX 생성 |
| 기존 PDF 화면 | PDF.js | PDF 미리보기와 페이지 이미지 변환 |
| 기존 PDF 화면 | pdf-lib | PDF 병합·분할·페이지 편집과 저장 |

npm 패키지의 정확한 버전과 하위 의존성은 `package-lock.json`에 기록합니다. 기존 기능에 실질적인 개선 효과가 확인되지 않은 라이브러리는 설치하거나 별도 화면으로 노출하지 않습니다.

## 실행 및 배포

- `npm run dev`: Vite 개발 서버. 기존 HTML·Vanilla JavaScript 구조를 유지합니다.
- `npm run build`: 모든 HTML 화면과 npm 의존성을 `repo-root/dist`로 빌드합니다.
- `npm run preview`: 빌드 결과를 로컬에서 확인합니다.
- `npm run lint`, `npm run format:check -- <파일>`, `npm run test:browser`: 기존 개발 도구 명령입니다.

GitHub에 연결된 Vercel은 포함된 `vercel.json`에 따라 빌드합니다. 프로젝트 Root Directory가 저장소 루트 또는 `repo-root`인 경우를 지원합니다. 파일 다운로드에 사용하는 기존 템플릿도 빌드 결과에 포함합니다.

## 연결된 화면

- 관리 허브 → 코스 관리: AG Grid Community를 기존 코스 목록에 적용하며 편집·납품처·삭제와 DB 처리는 기존 로직을 유지합니다.
- ExcelJS를 사용하는 기존 화면은 CDN 대신 npm/Vite에서 고정 버전을 공통 로딩합니다.
- 관리 허브 → PDF IMG 변환기: PDF.js와 pdf-lib를 기존 기사 서류 등록 흐름 안에서 사용합니다. 미리보기·편집·병합·분할·변환 결과는 사용자가 다운로드하며, 기존 기사 서류 등록 버튼을 눌렀을 때만 OneDrive에 저장합니다.
