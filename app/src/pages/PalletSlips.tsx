import '../styles/pallet-slips.css';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { FileArea } from '../components/FileArea';
import { AdminPage } from '../components/AdminPage';
import { firstSheet, matchWorkbooks, sheetRange } from '../domain/pallet-slips';

interface Source {
  file: File;
  workbook: XLSX.WorkBook;
}
type Result = ReturnType<typeof matchWorkbooks>;
export default function PalletSlips() {
  const [source, setSource] = useState<Source | null>(null);
  const [upload, setUpload] = useState<Source | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [skipHeader, setSkipHeader] = useState(true);
  const [ignoreSpaces, setIgnoreSpaces] = useState(true);
  async function handleFile(kind: 'source' | 'upload', file?: File) {
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        cellDates: true,
      });
      if (kind === 'source') setSource({ file, workbook });
      else setUpload({ file, workbook });
      setResult(null);
    } catch (error) {
      console.error(error);
      alert(
        `파일을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  function runMatch(nextSkip = skipHeader, nextIgnore = ignoreSpaces) {
    if (source && upload)
      setResult(
        matchWorkbooks(source.workbook, upload.workbook, {
          skipHeader: nextSkip,
          ignoreSpaces: nextIgnore,
        }),
      );
  }
  function download() {
    if (!result) return;
    const base = source?.file.name.replace(/\.[^.]+$/, '') || '파레트_전표';
    const date = new Date();
    const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(result.output, `${base}_전표반영_${ymd}.xlsx`);
  }
  const matches = result?.matches ?? [],
    matched = matches.filter((item) => item.matched).length;
  return (
    <AdminPage
      title="파레트 전표관리"
      bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"
    >
      <main
        id="work-main"
        tabIndex={-1}
        className="app-main flex-1 max-w-[1200px] w-full mx-auto px-4 py-6 space-y-5"
      >
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(['source', 'upload'] as const).map((kind, index) => {
            const item = kind === 'source' ? source : upload;
            const range = item ? sheetRange(firstSheet(item.workbook)) : null;
            return (
              <FileArea
                key={kind}
                accept=".xlsx,.xls,.xlsm,.xlsb,.csv"
                onFiles={(files) => void handleFile(kind, files[0])}
                className="drop-card rounded-lg p-4"
                data-drop={kind}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div>
                    <div className="text-sm font-semibold">
                      {kind === 'source' ? '원본 템플릿 파일' : '업로드용 파일'}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {kind === 'source'
                        ? 'Sheet1 H열 매칭 → I열에 결과 입력'
                        : 'Sheet1 P열 기준 → T열 값을 가져옴'}
                    </div>
                  </div>
                </div>
                <input
                  id={`${kind}-file`}
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.xlsb,.csv"
                  className="w-full text-sm"
                  onChange={(event) =>
                    void handleFile(kind, event.currentTarget.files?.[0])
                  }
                />
                <div id={`${kind}-info`} className="mt-3 text-xs text-zinc-400">
                  {item ? (
                    <>
                      <div className="font-medium text-zinc-200">
                        {item.file.name}
                      </div>
                      <div>
                        Sheet1: {item.workbook.SheetNames[0] || '-'} ·{' '}
                        {range ? `${range.e.r + 1}행` : '빈 시트'}
                      </div>
                    </>
                  ) : (
                    '선택된 파일 없음'
                  )}
                </div>
              </FileArea>
            );
          })}
        </section>
        <section className="border border-zinc-700 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">매칭 실행</span>
            </div>
            <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-zinc-300">
              <input
                id="skip-header"
                type="checkbox"
                checked={skipHeader}
                className="rounded bg-zinc-900 border-zinc-600"
                onChange={(event) => {
                  const next = event.target.checked;
                  setSkipHeader(next);
                  if (result) runMatch(next);
                }}
              />
              1행 헤더 제외
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
              <input
                id="ignore-spaces"
                type="checkbox"
                checked={ignoreSpaces}
                className="rounded bg-zinc-900 border-zinc-600"
                onChange={(event) => {
                  const next = event.target.checked;
                  setIgnoreSpaces(next);
                  if (result) runMatch(skipHeader, next);
                }}
              />
              공백 무시 매칭
            </label>
            <div className="flex-1" />
            <button
              id="run-btn"
              className="btn btn-primary"
              disabled={!source || !upload}
              onClick={() => runMatch()}
            >
              매칭 실행
            </button>
            <button
              id="download-btn"
              className="btn btn-ghost"
              disabled={!result || !matched}
              onClick={download}
            >
              결과 Excel 다운로드
            </button>
          </div>
          <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {[
              ['source', '원본 대상 행', matches.length, ''],
              ['upload', '업로드 기준값', result?.uploadCount ?? 0, ''],
              ['match', '매칭 성공', matched, 'text-emerald-400'],
              ['miss', '미매칭', matches.length - matched, 'text-amber-400'],
            ].map(([id, label, value, color]) => (
              <div
                key={id}
                className="rounded bg-zinc-800/60 border border-zinc-700 p-3"
              >
                <div className="text-zinc-500">{label}</div>
                <div
                  id={`stat-${id}`}
                  className={`text-lg font-semibold mt-1 ${color}`}
                >
                  {result ? Number(value).toLocaleString('ko-KR') : '-'}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section
          id="preview-section"
          className={`border border-zinc-700 rounded-lg overflow-hidden${result ? '' : ' hidden'}`}
        >
          <div className="p-3 border-b border-zinc-700 bg-zinc-800/50 flex items-center gap-2">
            <span className="text-sm font-semibold">미리보기</span>
            <span id="preview-count" className="text-xs text-zinc-400">
              상위 {matches.slice(0, 300).length.toLocaleString('ko-KR')}건 표시
              / 전체 {matches.length.toLocaleString('ko-KR')}건
            </span>
          </div>
          <div className="overflow-auto max-h-[55vh]">
            <table className="app-table preview-table">
              <thead>
                <tr>
                  {[
                    '원본 행',
                    '원본 H값',
                    '기존 I값',
                    '입력될 T값',
                    '업로드 행',
                    '상태',
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="preview-body">
                {matches.slice(0, 300).map((row) => (
                  <tr
                    key={row.sourceRow}
                    className={row.matched ? '' : 'text-zinc-500'}
                  >
                    <td className="text-right">{row.sourceRow}</td>
                    <td>{row.sourceValue}</td>
                    <td>{row.before}</td>
                    <td className={row.matched ? 'text-emerald-300' : ''}>
                      {row.tText}
                    </td>
                    <td className="text-right">{row.uploadRow || ''}</td>
                    <td>
                      <span
                        className={
                          row.matched ? 'text-emerald-400' : 'text-amber-400'
                        }
                      >
                        {row.matched ? '매칭' : '미매칭'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AdminPage>
  );
}
