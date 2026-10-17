import { readWorkbook } from './pyeongtaek-dispatch-data.js';
import {
  PROFILE_FIELDS,
  suggestProfileMapping,
  previewProfiles,
  selectProfileTarget,
  normalizeProfile,
  saveProfiles,
} from './pyeongtaek-dispatch-profiles.js';
import { menuPermissions } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';
import { getSelectedCenter } from './center.js';

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
];
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text != null) el.textContent = String(text);
  if (className) el.className = className;
  return el;
};
const label = (destination) =>
  [destination.code, destination.name, destination.address]
    .filter(Boolean)
    .join(' · ') || '이름 없는 납품처';
const issueText = (issues = []) =>
  issues
    .map((issue) =>
      typeof issue === 'string' ? issue : issue.message || issue.code,
    )
    .join(' · ');

export function createProfilesUI({
  host,
  state,
  supabase,
  run,
  message,
  onDirty,
  onSaved,
  onReload,
}) {
  let canRead = false,
    canEdit = false,
    book = null,
    file = null,
    preview = null;
  const edits = new Map();
  const access = node('p', '', 'pd-muted');
  const reader = node('fieldset', null, 'pd-profile-fieldset');
  const upload = node('fieldset', null, 'pd-profile-fieldset');
  reader.disabled = upload.disabled = true;
  const files = node('div', null, 'pd-fields');
  const fileInput = node('input');
  fileInput.type = 'file';
  fileInput.accept = '.xlsx,.xls,.csv';
  const sheetInput = node('select');
  const header = node('input');
  header.type = 'number';
  header.min = '1';
  header.step = '1';
  header.value = '1';
  const mappingHost = node('div', null, 'pd-fields');
  const previewHost = node('div', null, 'pd-scroll');
  const previewStatus = node('p');
  previewStatus.setAttribute('role', 'status');
  const problems = node('p', '', 'pd-issues');
  const search = node('input');
  search.type = 'search';
  const list = node('div', null, 'pd-profile-list');
  const count = node('p', '', 'pd-muted');
  const mappingInputs = new Map();
  function field(parent, title, input) {
    const wrap = node('label', title);
    wrap.append(input);
    parent.append(wrap);
  }
  function command(text, fn, edit = false) {
    const button = node('button', text, 'btn btn-ghost');
    button.type = 'button';
    button.onclick = () =>
      run(async () => {
        assertAccess(edit);
        await fn();
      });
    return button;
  }
  function assertAccess(edit = false) {
    if (
      !state.ready ||
      getSelectedCenter()?.code !== '002' ||
      !canRead ||
      (edit && !canEdit)
    )
      throw Error(
        '평택 납품처 ' + (edit ? '수정' : '열람') + ' 권한이 필요합니다.',
      );
  }
  function changed() {
    controls();
    onDirty();
  }
  function invalidatePreview() {
    preview = null;
    previewHost.replaceChildren();
    previewStatus.textContent = '';
    problems.textContent = '';
    changed();
  }
  const previewButton = command('납품정보 미리보기', makePreview, true);
  const saveButton = command(
    '납품정보 DB 일괄 저장',
    async () => {
      if (!preview?.entries.length)
        throw Error('미리보기를 먼저 확인해 주세요.');
      if (edits.size)
        throw Error('목록의 수정사항을 먼저 저장하거나 취소해 주세요.');
      if (
        !confirm(
          `${preview.entries.length}건의 납품정보를 DB에 저장하시겠습니까?`,
        )
      )
        return;
      await persist(preview.entries);
      clearUpload();
      changed();
    },
    true,
  );
  const discardButton = command(
    '파일 비우기',
    () => {
      if (book && !confirm('저장하지 않은 파일 미리보기를 버리시겠습니까?'))
        return;
      clearUpload();
      changed();
    },
    true,
  );
  const template = command('납품정보 양식 다운로드', exportTemplate);
  field(files, '납품정보 파일', fileInput);
  field(files, '시트', sheetInput);
  field(files, '제목 행', header);
  const actions = node('div', null, 'pd-toolbar');
  actions.append(previewButton, saveButton, discardButton);
  upload.append(
    node('legend', '납품정보 파일'),
    files,
    mappingHost,
    actions,
    previewStatus,
    problems,
    previewHost,
  );
  const toolbar = node('div', null, 'pd-toolbar');
  const reload = command('납품정보 DB 다시 읽기', async () => {
    if (
      (book || edits.size) &&
      !confirm(
        '저장하지 않은 납품정보 수정사항과 파일 미리보기를 버리고 DB를 다시 읽으시겠습니까?',
      )
    )
      return;
    const permissions = await menuPermissions(true);
    canRead = permissionAllowed(permissions, 'delivery_points', 'read', '002');
    canEdit = permissionAllowed(permissions, 'delivery_points', 'edit', '002');
    assertAccess();
    await onReload();
    clearUpload();
    edits.clear();
    renderList();
    changed();
    message(
      state.needsRegeneration
        ? '납품정보 DB 갱신됨 · 현재 조정 유지 · 초안 재생성 필요'
        : '납품정보 DB를 다시 불러왔습니다.',
    );
  });
  toolbar.append(template, reload);
  field(reader, '납품처 검색', search);
  reader.append(toolbar, count, list);
  host.append(access, upload, node('h4', '등록된 납품정보'), reader);

  function controls() {
    const unavailable =
      state.busy || !state.ready || getSelectedCenter()?.code !== '002';
    reader.disabled = unavailable || !canRead;
    upload.disabled = unavailable || !canRead || !canEdit;
    for (const group of list.querySelectorAll('fieldset'))
      group.disabled = unavailable || !canEdit;
    previewButton.disabled = !book;
    saveButton.disabled = !preview?.entries.length || Boolean(edits.size);
    discardButton.disabled = !book;
    access.textContent = !canRead
      ? '평택 납품처 열람 권한이 필요합니다.'
      : !canEdit
        ? '납품정보 DB 열람 전용'
        : '';
  }
  function clearUpload() {
    book = file = preview = null;
    fileInput.value = '';
    sheetInput.replaceChildren();
    mappingHost.replaceChildren();
    mappingInputs.clear();
    previewHost.replaceChildren();
    previewStatus.textContent = '';
    problems.textContent = '';
    header.value = '1';
  }
  function currentSheet() {
    return book?.sheets[Number(sheetInput.value) || 0];
  }
  function setupMapping() {
    const rows = currentSheet()?.rows || [];
    const guess = suggestProfileMapping(rows);
    header.value = (guess.headerRow ?? 0) + 1;
    mappingInputs.clear();
    mappingHost.replaceChildren();
    const columns = Math.max(0, ...rows.slice(0, 30).map((row) => row.length));
    for (const [key, title] of Object.entries(PROFILE_FIELDS)) {
      const select = node('select');
      for (let index = -1; index < columns; index++) {
        const option = node(
          'option',
          index < 0
            ? '선택 안 함'
            : `${index + 1}열 · ${rows[guess.headerRow]?.[index] ?? ''}`,
        );
        option.value = index;
        select.append(option);
      }
      select.value = guess[key] ?? -1;
      select.onchange = invalidatePreview;
      mappingInputs.set(key, select);
      field(mappingHost, title, select);
    }
    invalidatePreview();
  }
  fileInput.onchange = () =>
    run(async () => {
      assertAccess(true);
      const next = fileInput.files[0];
      if (!next) return;
      if (book && !confirm('현재 납품정보 파일 미리보기를 교체하시겠습니까?')) {
        fileInput.value = '';
        return;
      }
      if (next.size > 30 * 1024 * 1024)
        throw Error('30MB 이하 파일을 선택해 주세요.');
      const nextBook = await readWorkbook(next);
      if (!nextBook.sheets?.length) throw Error('시트가 없습니다.');
      book = nextBook;
      file = next;
      sheetInput.replaceChildren(
        ...book.sheets.map((sheet, index) => {
          const option = node('option', sheet.name);
          option.value = index;
          return option;
        }),
      );
      setupMapping();
      message('납품정보 파일을 불러왔습니다.');
    });
  sheetInput.onchange = () =>
    run(() => {
      assertAccess(true);
      setupMapping();
    });
  header.oninput = invalidatePreview;
  search.oninput = renderList;

  function makePreview() {
    const sheet = currentSheet();
    if (!sheet) throw Error('납품정보 파일을 선택해 주세요.');
    const mapping = { headerRow: Number(header.value) - 1 };
    if (
      !Number.isInteger(mapping.headerRow) ||
      mapping.headerRow < 0 ||
      mapping.headerRow >= sheet.rows.length
    )
      throw Error('제목 행을 확인해 주세요.');
    for (const [key, input] of mappingInputs)
      mapping[key] = Number(input.value);
    const used = [...mappingInputs.keys()]
      .map((key) => mapping[key])
      .filter((index) => index >= 0);
    if (new Set(used).size !== used.length)
      throw Error('같은 열을 여러 항목에 연결할 수 없습니다.');
    preview = previewProfiles(sheet.rows, mapping, state.context.destinations, {
      fileName: file.name,
      sheetName: sheet.name,
    });
    renderPreview();
    changed();
    message('납품정보 미리보기 완료 · DB 미저장');
  }
  function renderPreview() {
    previewHost.replaceChildren();
    const counts = new Map();
    for (const entry of preview.entries) {
      if (entry.targetId)
        counts.set(
          String(entry.targetId),
          (counts.get(String(entry.targetId)) || 0) + 1,
        );
    }
    for (const entry of preview.entries) {
      entry.issues = (entry.issues || []).filter(
        (issue) => issue.code !== 'DUPLICATE_TARGET',
      );
      if (counts.get(String(entry.targetId)) > 1)
        entry.issues.push({
          code: 'DUPLICATE_TARGET',
          severity: 'error',
          message: '같은 납품처에 여러 행이 연결되었습니다.',
        });
    }
    preview.issues = preview.entries.flatMap((entry) => entry.issues);
    previewStatus.textContent = `${file.name} · ${preview.entries.length}건 · DB 미저장`;
    problems.textContent = issueText(preview.issues);
    const table = node('table'),
      head = node('thead'),
      titles = node('tr'),
      body = node('tbody');
    for (const text of [
      '원본 행',
      '파일 납품처',
      '주소',
      '연결 납품처',
      '상태',
      ...editableFields.map((key) => PROFILE_FIELDS[key]),
    ])
      titles.append(node('th', text));
    head.append(titles);
    table.append(head, body);
    for (const entry of preview.entries) {
      const tr = node('tr');
      const target = node('select');
      target.setAttribute(
        'aria-label',
        `원본 ${entry.sourceRow}행 연결 납품처`,
      );
      const empty = node('option', '납품처 선택');
      empty.value = '';
      target.append(empty);
      const candidateIds = new Set(
        (entry.candidates || []).map((candidate) =>
          String(candidate.id ?? candidate.targetId ?? candidate),
        ),
      );
      const destinations = [...state.context.destinations].sort(
        (a, b) =>
          Number(candidateIds.has(String(b.id))) -
          Number(candidateIds.has(String(a.id))),
      );
      for (const destination of destinations) {
        const option = node(
          'option',
          (candidateIds.has(String(destination.id)) ? '후보 · ' : '') +
            label(destination),
        );
        option.value = destination.id;
        target.append(option);
      }
      target.value = entry.targetId || '';
      const status = node('span', entry.targetId ? '연결됨' : '연결 필요');
      const detail = node('small', issueText(entry.issues));
      const statusCell = node('div');
      statusCell.append(status, detail);
      target.onchange = () => {
        const destination = state.context.destinations.find(
          (d) => String(d.id) === target.value,
        );
        if (destination)
          Object.assign(entry, selectProfileTarget(entry, destination));
        else {
          entry.targetId = null;
          entry.revision = 0;
          const normalized = normalizeProfile(entry.patch || {});
          entry.profile = normalized.profile;
          entry.issues = [
            ...normalized.issues,
            {
              field: 'targetId',
              code: 'MATCH_REQUIRED',
              severity: 'error',
              message: '연결 납품처를 선택해 주세요.',
            },
          ];
        }
        renderPreview();
        changed();
      };
      for (const value of [
        entry.sourceRow,
        [entry.code, entry.name].filter(Boolean).join(' · '),
        entry.address,
        target,
        statusCell,
        ...editableFields.map((key) =>
          key === 'mode'
            ? modes.find(([mode]) => mode === entry.profile?.mode)?.[1]
            : entry.profile?.[key],
        ),
      ]) {
        const td = node('td');
        td.append(value instanceof Node ? value : node('span', value ?? ''));
        tr.append(td);
      }
      body.append(tr);
    }
    previewHost.append(table);
  }
  async function persist(entries) {
    const permissions = await menuPermissions(true);
    canRead = permissionAllowed(permissions, 'delivery_points', 'read', '002');
    canEdit = permissionAllowed(permissions, 'delivery_points', 'edit', '002');
    assertAccess(true);
    const targets = new Set();
    for (const entry of entries) {
      if (
        !entry.targetId ||
        !state.context.destinations.some(
          (d) => String(d.id) === String(entry.targetId),
        )
      )
        throw Error('모든 행의 연결 납품처를 선택해 주세요.');
      if (targets.has(String(entry.targetId)))
        throw Error(
          '같은 납품처에 여러 행이 연결되었습니다. 파일을 수정해 주세요.',
        );
      targets.add(String(entry.targetId));
      const result = normalizeProfile(entry.profile);
      if (result.issues?.some((issue) => issue.severity !== 'warning'))
        throw Error(issueText(result.issues));
      entry.profile = result.profile;
    }
    let records;
    try {
      records = await saveProfiles(supabase, entries);
    } catch (error) {
      if (error.code === 'PT409')
        throw Error(
          '납품정보 DB가 변경되었거나 접근할 수 없습니다. 수정사항을 확인한 후 납품정보 DB 다시 읽기를 실행해 주세요.',
        );
      throw error;
    }
    onSaved(records);
    for (const record of records) edits.delete(String(record.id));
    renderList();
    changed();
    message(
      state.needsRegeneration
        ? '납품정보 DB 저장 완료 · 현재 조정 유지 · 초안 재생성 후 저장 가능'
        : '납품정보 DB 저장 완료',
    );
  }
  function renderList() {
    list.replaceChildren();
    if (!canRead) {
      count.textContent = '';
      controls();
      return;
    }
    const query = search.value.trim().toLocaleLowerCase();
    const destinations = state.context.destinations.filter((d) =>
      label(d).toLocaleLowerCase().includes(query),
    );
    count.textContent = `${destinations.length}개 납품처 · 수정 중 ${edits.size}건`;
    for (const destination of destinations) {
      const id = String(destination.id),
        saved = destination.dispatch_profile;
      const row = node('details');
      row.open = edits.has(id);
      row.append(node('summary', label(destination)));
      row.append(
        node(
          'p',
          saved
            ? `버전 ${saved.revision ?? 0} · OTD ${saved.otd || '미지정'} · ${modes.find(([key]) => key === saved.mode)?.[1] || '미확인'}`
            : '납품정보 미등록',
          'pd-muted',
        ),
      );
      const editor = node('fieldset', null, 'pd-profile-fieldset');
      const fields = node('div', null, 'pd-fields');
      const current = edits.get(id)?.profile || saved || {};
      for (const key of editableFields) {
        const control = node(
          key === 'mode' ? 'select' : key === 'notes' ? 'textarea' : 'input',
        );
        if (key === 'mode') {
          for (const [value, title] of modes) {
            const option = node('option', title);
            option.value = value;
            control.append(option);
          }
        } else if (key.endsWith('Minutes')) {
          control.type = 'number';
          control.min = '0';
          control.step = '1';
        }
        control.value = current[key] ?? (key === 'mode' ? 'unknown' : '');
        control.oninput = () => {
          if (!canEdit) return;
          if (!edits.has(id))
            edits.set(id, {
              targetId: destination.id,
              revision: saved?.revision ?? 0,
              profile: normalizeProfile(saved || {}).profile,
              issues: [],
            });
          edits.get(id).profile[key] = key.endsWith('Minutes')
            ? control.value === ''
              ? null
              : Number(control.value)
            : control.value;
          count.textContent = `${destinations.length}개 납품처 · 수정 중 ${edits.size}건`;
          changed();
        };
        field(fields, PROFILE_FIELDS[key], control);
      }
      const actions = node('div', null, 'pd-toolbar');
      actions.append(
        command(
          '이 납품처 DB 저장',
          async () => {
            const entry = edits.get(id);
            if (!entry) {
              message('변경사항이 없습니다.');
              return;
            }
            if (preview?.entries.some((item) => String(item.targetId) === id))
              throw Error(
                '같은 납품처의 파일 미리보기를 먼저 저장하거나 비워 주세요.',
              );
            await persist([entry]);
          },
          true,
        ),
        command(
          '수정 취소',
          () => {
            if (
              edits.has(id) &&
              !confirm('이 납품처의 수정사항을 버리시겠습니까?')
            )
              return;
            edits.delete(id);
            renderList();
            changed();
          },
          true,
        ),
      );
      editor.append(fields, actions);
      row.append(editor);
      list.append(row);
    }
    if (!destinations.length)
      list.append(node('p', '납품처가 없습니다.', 'pd-muted'));
    controls();
  }
  async function exportTemplate() {
    const workbook = new globalThis.ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('납품정보');
    const keys = Object.keys(PROFILE_FIELDS);
    sheet.addRow(Object.values(PROFILE_FIELDS));
    for (const destination of state.context.destinations) {
      sheet.addRow(
        keys.map((key) =>
          ['code', 'name', 'address'].includes(key)
            ? destination[key] || ''
            : key === 'mode'
              ? modes.find(
                  ([mode]) => mode === destination.dispatch_profile?.mode,
                )?.[1] || ''
              : (destination.dispatch_profile?.[key] ?? ''),
        ),
      );
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
    const url = URL.createObjectURL(
      new Blob([await workbook.xlsx.writeBuffer()], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const anchor = node('a');
    anchor.href = url;
    anchor.download = '평택_납품정보_DB.xlsx';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    message('납품정보 양식 다운로드 완료');
  }
  return {
    controls,
    renderList,
    isDirty: () => Boolean(book || edits.size),
    reset() {
      clearUpload();
      edits.clear();
      renderList();
    },
    setPermissions(permissions) {
      canRead = permissionAllowed(
        permissions,
        'delivery_points',
        'read',
        '002',
      );
      canEdit = permissionAllowed(
        permissions,
        'delivery_points',
        'edit',
        '002',
      );
      renderList();
    },
  };
}
