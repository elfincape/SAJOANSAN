import { useEffect, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { useAdminPage } from './AdminPage';
import { permissionAllowed } from '../lib/permissions';
import { readWorkbook } from '../domain/dispatch-import';
import type {
  DispatchWorkbook,
  Mapping,
  ImportIssue,
} from '../domain/dispatch-import';
import {
  PROFILE_FIELDS,
  suggestProfileMapping,
  previewProfiles,
  selectProfileTarget,
  normalizeProfile,
} from '../domain/dispatch-profiles';
import type {
  DispatchProfile,
  ProfileDestination,
  ProfileEntry,
} from '../domain/dispatch-profiles';
import {
  saveProfiles,
  dispatchProfilePermissions,
} from '../lib/dispatch-profiles';
import { FileArea } from './FileArea';
import { useFeedback } from './useFeedback';
import { useDownload } from './useDownload';

const modes = [
  ['unknown', '미확인'],
  ['unmanned', '무인'],
  ['attended', '유인'],
  ['yard', '야적'],
];
const editableFields = [
  'otd',
  'mode',
  'unloadMinutes',
  'inspectionMinutes',
  'marginMinutes',
  'notes',
] as const;
const label = (d: ProfileDestination) =>
  [d.code, d.name, d.address].filter(Boolean).join(' · ') || '이름 없는 납품처';
const issueText = (issues: ImportIssue[] = []) =>
  issues.map((i) => i.message || i.code).join(' · ');
interface Props {
  destinations: ProfileDestination[];
  busy: boolean;
  needsRegeneration: boolean;
  onReload: () => Promise<void>;
  onSaved: (records: ProfileDestination[]) => void;
  onDirty: (dirty: boolean) => void;
  run: (action: () => void | Promise<void>) => void;
  message: (text: string, error?: boolean) => void;
}
export function DispatchProfiles({
  destinations,
  busy,
  needsRegeneration,
  onReload,
  onSaved,
  onDirty,
  run,
  message,
}: Props) {
  const { permissions, center } = useAdminPage(),
    { confirm, feedback } = useFeedback(),
    { download, downloadLink } = useDownload();
  const [access, setAccess] = useState(permissions),
    [book, setBook] = useState<DispatchWorkbook | null>(null),
    [file, setFile] = useState<File | null>(null),
    [sheetIndex, setSheetIndex] = useState(0),
    [mapping, setMapping] = useState<Mapping>({ headerRow: 0 }),
    [preview, setPreview] = useState<{
      entries: ProfileEntry[];
      issues: ImportIssue[];
    } | null>(null),
    [search, setSearch] = useState(''),
    [edits, setEdits] = useState<Record<string, ProfileEntry>>({});
  const input = useRef<HTMLInputElement>(null),
    canRead = permissionAllowed(access, 'delivery_points', 'read', '002'),
    canEdit = permissionAllowed(access, 'delivery_points', 'edit', '002'),
    unavailable = busy || center.code !== '002';
  useEffect(() => {
    onDirty(!!book || Object.keys(edits).length > 0);
  }, [book, edits, onDirty]);
  function assertAccess(edit = false, updated = access) {
    if (
      center.code !== '002' ||
      !permissionAllowed(updated, 'delivery_points', 'read', '002') ||
      (edit && !permissionAllowed(updated, 'delivery_points', 'edit', '002'))
    )
      throw Error(
        '평택 납품처 ' + (edit ? '수정' : '열람') + ' 권한이 필요합니다.',
      );
  }
  function clearUpload() {
    setBook(null);
    setFile(null);
    setPreview(null);
    setMapping({ headerRow: 0 });
    setSheetIndex(0);
    if (input.current) input.current.value = '';
  }
  function invalidate(next: Mapping) {
    setMapping(next);
    setPreview(null);
  }
  function setup(next: DispatchWorkbook, index: number) {
    setSheetIndex(index);
    invalidate(suggestProfileMapping(next.sheets[index]?.rows || []));
  }
  function loadFile(selected: File) {
    run(async () => {
      assertAccess(true);
      if (
        book &&
        !(await confirm('현재 납품정보 파일 미리보기를 교체하시겠습니까?'))
      ) {
        if (input.current) input.current.value = '';
        return;
      }
      if (selected.size > 30 * 1024 * 1024)
        throw Error('30MB 이하 파일을 선택해 주세요.');
      const next = await readWorkbook(selected);
      if (!next.sheets.length) throw Error('시트가 없습니다.');
      setBook(next);
      setFile(selected);
      setup(next, 0);
      message('납품정보 파일을 불러왔습니다.');
    });
  }
  function normalizePreview(entries: ProfileEntry[]) {
    const counts = new Map<string, number>();
    for (const e of entries)
      if (e.targetId) counts.set(e.targetId, (counts.get(e.targetId) || 0) + 1);
    const next = entries.map((e) => ({
      ...e,
      issues: [
        ...e.issues.filter((i) => i.code !== 'DUPLICATE_TARGET'),
        ...((counts.get(String(e.targetId)) || 0) > 1
          ? [
              {
                code: 'DUPLICATE_TARGET',
                severity: 'error',
                message: '같은 납품처에 여러 행이 연결되었습니다.',
              },
            ]
          : []),
      ],
    }));
    return { entries: next, issues: next.flatMap((e) => e.issues) };
  }
  async function persist(entries: ProfileEntry[]) {
    const fresh = await dispatchProfilePermissions();
    setAccess(fresh);
    assertAccess(true, fresh);
    const targets = new Set();
    const normalized = entries.map((entry) => {
      if (
        !entry.targetId ||
        !destinations.some((d) => String(d.id) === String(entry.targetId))
      )
        throw Error('모든 행의 연결 납품처를 선택해 주세요.');
      if (targets.has(entry.targetId))
        throw Error(
          '같은 납품처에 여러 행이 연결되었습니다. 파일을 수정해 주세요.',
        );
      targets.add(entry.targetId);
      const result = normalizeProfile(entry.profile);
      if (result.issues.some((i) => i.severity !== 'warning'))
        throw Error(issueText(result.issues));
      return { ...entry, profile: result.profile };
    });
    let records: ProfileDestination[];
    try {
      records = await saveProfiles(normalized);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'PT409'
      )
        throw Error(
          '납품정보 DB가 변경되었거나 접근할 수 없습니다. 수정사항을 확인한 후 납품정보 DB 다시 읽기를 실행해 주세요.',
        );
      throw error;
    }
    onSaved(records);
    setEdits((old) =>
      Object.fromEntries(
        Object.entries(old).filter(
          ([id]) => !records.some((r) => String(r.id) === id),
        ),
      ),
    );
    message(
      needsRegeneration
        ? '납품정보 DB 저장 완료 · 현재 조정 유지 · 초안 재생성 후 저장 가능'
        : '납품정보 DB 저장 완료',
    );
  }
  function edit(
    destination: ProfileDestination,
    key: (typeof editableFields)[number],
    value: string,
  ) {
    if (!canEdit || unavailable) return;
    setEdits((old) => {
      const id = String(destination.id),
        entry = old[id] || {
          targetId: id,
          revision: destination.dispatch_profile?.revision ?? 0,
          profile: normalizeProfile(destination.dispatch_profile || {}).profile,
          issues: [],
        };
      return {
        ...old,
        [id]: {
          ...entry,
          profile: {
            ...entry.profile,
            [key]: key.endsWith('Minutes')
              ? value === ''
                ? null
                : Number(value)
              : value,
          },
        },
      };
    });
  }
  const sheet = book?.sheets[sheetIndex],
    columns = Math.max(
      0,
      ...(sheet?.rows || []).slice(0, 30).map((row) => row.length),
    ),
    visible = destinations.filter((d) =>
      label(d).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    );
  function exportTemplate() {
    run(async () => {
      assertAccess();
      const workbook = new ExcelJS.Workbook(),
        sheet = workbook.addWorksheet('납품정보');
      const keys = Object.keys(
        PROFILE_FIELDS,
      ) as (keyof typeof PROFILE_FIELDS)[];
      sheet.addRow(Object.values(PROFILE_FIELDS));
      for (const d of destinations)
        sheet.addRow(
          keys.map((key) =>
            ['code', 'name', 'address'].includes(key)
              ? d[key as 'code' | 'name' | 'address'] || ''
              : key === 'mode'
                ? modes.find(
                    ([mode]) => mode === d.dispatch_profile?.mode,
                  )?.[1] || ''
                : (d.dispatch_profile?.[key as keyof DispatchProfile] ?? ''),
          ),
        );
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((c) => {
        c.width = 24;
      });
      download(
        new Blob([await workbook.xlsx.writeBuffer()], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        '평택_납품정보_DB.xlsx',
      );
      message('납품정보 양식 다운로드 완료');
    });
  }
  return (
    <>
      <p className="pd-muted">
        {!canRead
          ? '평택 납품처 열람 권한이 필요합니다.'
          : !canEdit
            ? '납품정보 DB 열람 전용'
            : ''}
      </p>
      <FileArea
        accept=".xlsx,.xls,.csv"
        disabled={unavailable || !canRead || !canEdit}
        onFiles={(files) => {
          if (files[0]) loadFile(files[0]);
        }}
      >
        <fieldset
          className="pd-profile-fieldset"
          disabled={unavailable || !canRead || !canEdit}
        >
          <legend>납품정보 파일</legend>
          <div className="pd-fields">
            <label>
              납품정보 파일
              <input
                ref={input}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  if (e.target.files?.[0]) loadFile(e.target.files[0]);
                }}
              />
            </label>
            <label>
              시트
              <select
                value={sheetIndex}
                onChange={(e) => {
                  if (book) setup(book, Number(e.target.value));
                }}
              >
                {book?.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              제목 행
              <input
                type="number"
                min="1"
                step="1"
                value={mapping.headerRow + 1}
                onChange={(e) =>
                  invalidate({
                    ...mapping,
                    headerRow: Number(e.target.value) - 1,
                  })
                }
              />
            </label>
          </div>
          <div className="pd-fields">
            {book
              ? Object.entries(PROFILE_FIELDS).map(([key, title]) => (
                  <label key={key}>
                    {title}
                    <select
                      value={mapping[key] ?? -1}
                      onChange={(e) =>
                        invalidate({
                          ...mapping,
                          [key]: Number(e.target.value),
                        })
                      }
                    >
                      {Array.from({ length: columns + 1 }, (_, i) => i - 1).map(
                        (i) => (
                          <option key={i} value={i}>
                            {i < 0
                              ? '선택 안 함'
                              : `${i + 1}열 · ${sheet?.rows[mapping.headerRow]?.[i] ?? ''}`}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                ))
              : null}
          </div>
          <div className="pd-toolbar">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!book}
              onClick={() =>
                run(() => {
                  assertAccess(true);
                  if (!sheet || !file)
                    throw Error('납품정보 파일을 선택해 주세요.');
                  if (
                    !Number.isInteger(mapping.headerRow) ||
                    mapping.headerRow < 0 ||
                    mapping.headerRow >= sheet.rows.length
                  )
                    throw Error('제목 행을 확인해 주세요.');
                  const used = Object.keys(PROFILE_FIELDS)
                    .map((k) => mapping[k])
                    .filter((i) => i >= 0);
                  if (new Set(used).size !== used.length)
                    throw Error('같은 열을 여러 항목에 연결할 수 없습니다.');
                  setPreview(
                    normalizePreview(
                      previewProfiles(sheet.rows, mapping, destinations, {
                        fileName: file.name,
                        sheetName: sheet.name,
                      }).entries,
                    ),
                  );
                  message('납품정보 미리보기 완료 · DB 미저장');
                })
              }
            >
              납품정보 미리보기
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!preview?.entries.length || !!Object.keys(edits).length}
              onClick={() =>
                run(async () => {
                  assertAccess(true);
                  if (!preview?.entries.length)
                    throw Error('미리보기를 먼저 확인해 주세요.');
                  if (Object.keys(edits).length)
                    throw Error(
                      '목록의 수정사항을 먼저 저장하거나 취소해 주세요.',
                    );
                  if (
                    !(await confirm(
                      `${preview.entries.length}건의 납품정보를 DB에 저장하시겠습니까?`,
                    ))
                  )
                    return;
                  await persist(preview.entries);
                  clearUpload();
                })
              }
            >
              납품정보 DB 일괄 저장
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!book}
              onClick={() =>
                run(async () => {
                  assertAccess(true);
                  if (
                    book &&
                    !(await confirm(
                      '저장하지 않은 파일 미리보기를 버리시겠습니까?',
                    ))
                  )
                    return;
                  clearUpload();
                })
              }
            >
              파일 비우기
            </button>
          </div>
          <p role="status">
            {preview
              ? `${file?.name} · ${preview.entries.length}건 · DB 미저장`
              : ''}
          </p>
          <p className="pd-issues">
            {preview ? issueText(preview.issues) : ''}
          </p>
          <div className="pd-scroll">
            {preview ? (
              <table>
                <thead>
                  <tr>
                    {[
                      '원본 행',
                      '파일 납품처',
                      '주소',
                      '연결 납품처',
                      '상태',
                      ...editableFields.map((k) => PROFILE_FIELDS[k]),
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.entries.map((entry, index) => {
                    const candidates = new Set(
                      entry.candidates?.map((c) => String(c.id)),
                    );
                    return (
                      <tr key={index}>
                        <td>{entry.sourceRow}</td>
                        <td>
                          {[entry.code, entry.name].filter(Boolean).join(' · ')}
                        </td>
                        <td>{entry.address}</td>
                        <td>
                          <select
                            aria-label={`원본 ${entry.sourceRow}행 연결 납품처`}
                            value={entry.targetId || ''}
                            onChange={(e) => {
                              const destination = destinations.find(
                                (d) => String(d.id) === e.target.value,
                              );
                              let next: ProfileEntry;
                              if (destination)
                                next = selectProfileTarget(entry, destination);
                              else {
                                const normalized = normalizeProfile(
                                  entry.patch || {},
                                );
                                next = {
                                  ...entry,
                                  targetId: null,
                                  revision: 0,
                                  profile: normalized.profile,
                                  issues: [
                                    ...normalized.issues,
                                    {
                                      field: 'targetId',
                                      code: 'MATCH_REQUIRED',
                                      severity: 'error',
                                      message: '연결 납품처를 선택해 주세요.',
                                    },
                                  ],
                                };
                              }
                              setPreview(
                                normalizePreview(
                                  preview.entries.map((row, i) =>
                                    i === index ? next : row,
                                  ),
                                ),
                              );
                            }}
                          >
                            <option value="">납품처 선택</option>
                            {[...destinations]
                              .sort(
                                (a, b) =>
                                  Number(candidates.has(b.id)) -
                                  Number(candidates.has(a.id)),
                              )
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {candidates.has(d.id) ? '후보 · ' : ''}
                                  {label(d)}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td>
                          <div>
                            <span>
                              {entry.targetId ? '연결됨' : '연결 필요'}
                            </span>
                            <small>{issueText(entry.issues)}</small>
                          </div>
                        </td>
                        {editableFields.map((k) => (
                          <td key={k}>
                            {k === 'mode'
                              ? modes.find(
                                  ([mode]) => mode === entry.profile.mode,
                                )?.[1]
                              : (entry.profile[k] ?? '')}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
        </fieldset>
      </FileArea>
      <h4>등록된 납품정보</h4>
      <fieldset
        className="pd-profile-fieldset"
        disabled={unavailable || !canRead}
      >
        <label>
          납품처 검색
          <input
            type="search"
            placeholder="코드·착지명·주소"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="pd-toolbar">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={exportTemplate}
          >
            납품정보 양식 다운로드
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              run(async () => {
                if (
                  (book || Object.keys(edits).length) &&
                  !(await confirm(
                    '저장하지 않은 납품정보 수정사항과 파일 미리보기를 버리고 DB를 다시 읽으시겠습니까?',
                  ))
                )
                  return;
                const auth = await dispatchProfilePermissions();
                setAccess(auth);
                assertAccess(false, auth);
                await onReload();
                clearUpload();
                setEdits({});
                message(
                  needsRegeneration
                    ? '납품정보 DB 갱신됨 · 현재 조정 유지 · 초안 재생성 필요'
                    : '납품정보 DB를 다시 불러왔습니다.',
                );
              })
            }
          >
            납품정보 DB 다시 읽기
          </button>
        </div>
        <p className="pd-muted">
          {canRead
            ? `${visible.length}개 납품처 · 수정 중 ${Object.keys(edits).length}건`
            : ''}
        </p>
        <div className="pd-profile-list">
          {canRead
            ? visible.map((destination) => {
                const id = String(destination.id),
                  saved = destination.dispatch_profile,
                  current = edits[id]?.profile || saved || {};
                return (
                  <details key={id} open={edits[id] ? true : undefined}>
                    <summary>{label(destination)}</summary>
                    <p className="pd-muted">
                      {saved
                        ? `버전 ${saved.revision ?? 0} · OTD ${saved.otd || '미지정'} · ${modes.find(([mode]) => mode === saved.mode)?.[1] || '미확인'}`
                        : '납품정보 미등록'}
                    </p>
                    <fieldset
                      className="pd-profile-fieldset"
                      disabled={unavailable || !canEdit}
                    >
                      <div className="pd-fields">
                        {editableFields.map((key) => (
                          <label key={key}>
                            {PROFILE_FIELDS[key]}
                            {key === 'mode' ? (
                              <select
                                value={current[key] ?? 'unknown'}
                                onChange={(e) =>
                                  edit(destination, key, e.target.value)
                                }
                              >
                                {modes.map(([value, title]) => (
                                  <option key={value} value={value}>
                                    {title}
                                  </option>
                                ))}
                              </select>
                            ) : key === 'notes' ? (
                              <textarea
                                value={current[key] ?? ''}
                                onChange={(e) =>
                                  edit(destination, key, e.target.value)
                                }
                              />
                            ) : (
                              <input
                                type={
                                  key.endsWith('Minutes') ? 'number' : 'text'
                                }
                                min={key.endsWith('Minutes') ? 0 : undefined}
                                step={key.endsWith('Minutes') ? 1 : undefined}
                                value={current[key] ?? ''}
                                onChange={(e) =>
                                  edit(destination, key, e.target.value)
                                }
                              />
                            )}
                          </label>
                        ))}
                      </div>
                      <div className="pd-toolbar">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            run(async () => {
                              assertAccess(true);
                              const entry = edits[id];
                              if (!entry) {
                                message('변경사항이 없습니다.');
                                return;
                              }
                              if (
                                preview?.entries.some(
                                  (e) => String(e.targetId) === id,
                                )
                              )
                                throw Error(
                                  '같은 납품처의 파일 미리보기를 먼저 저장하거나 비워 주세요.',
                                );
                              await persist([entry]);
                            })
                          }
                        >
                          이 납품처 DB 저장
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            run(async () => {
                              assertAccess(true);
                              if (
                                edits[id] &&
                                !(await confirm(
                                  '이 납품처의 수정사항을 버리시겠습니까?',
                                ))
                              )
                                return;
                              setEdits((old) =>
                                Object.fromEntries(
                                  Object.entries(old).filter(
                                    ([key]) => key !== id,
                                  ),
                                ),
                              );
                            })
                          }
                        >
                          수정 취소
                        </button>
                      </div>
                    </fieldset>
                  </details>
                );
              })
            : null}
          {canRead && !visible.length ? (
            <p className="pd-muted">납품처가 없습니다.</p>
          ) : null}
        </div>
      </fieldset>
      {feedback}
      {downloadLink}
    </>
  );
}
