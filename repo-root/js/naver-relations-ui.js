import { supabase } from './supabase.js';
import { menuPermissions } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';
import { excelAddresses } from './destination-distance-model.js';

export function createRelationsUI({
  actor,
  permissions,
  onBusyChange = () => {},
  onCollected = async () => {},
}) {
  const $ = (id) => document.getElementById(id);
  let sourceRows = null,
    preview = null,
    job = null,
    busy = false,
    stopped = false,
    profile = actor,
    activeJobId = null,
    blocked = false;
  let allowed = permissionAllowed(
    permissions,
    'delivery_points',
    'edit',
    '002',
  );
  const message = (text) => ($('relation-status').textContent = text);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function controls() {
    const unavailable = busy || blocked || !allowed;
    for (const e of $('relations-panel').querySelectorAll('input,select'))
      e.disabled = unavailable;
    for (const id of [
      'relation-preview',
      'relation-use-db',
      'relation-restore',
      'relation-pair',
    ])
      $(id).disabled = unavailable;
    $('relation-start').disabled = unavailable || !preview;
    $('relation-resume').disabled =
      unavailable || !job || (job.status === 'completed' && !job.deferred);
    $('relation-stop').hidden = !busy || !activeJobId;
    $('relation-stop').disabled = stopped;
    $('relation-download').disabled = unavailable || !job?.completed;
  }
  function render(value) {
    job = value;
    const labels = {
      queued: '대기',
      running: '수집 중',
      paused: '중지됨',
      attention: '확인 필요',
      completed: value.deferred ? '조회 한도 도달' : '수집 완료',
    };
    if (value.origin) $('relation-origin').value = value.origin;
    if (value.limit) $('relation-limit').value = value.limit;
    if (value.directionsBudget) {
      const select = $('relation-budget');
      if (
        !Array.from(select.options).some(
          (o) => o.value === String(value.directionsBudget),
        )
      ) {
        const option = document.createElement('option');
        option.value = String(value.directionsBudget);
        option.textContent =
          value.directionsBudget.toLocaleString('ko-KR') + '건';
        select.append(option);
      }
      select.value = String(value.directionsBudget);
    }
    message(
      (labels[value.status] ?? value.status) +
        (value.error ? ' · ' + value.error : ''),
    );
    const n = (v) => Number(v ?? 0).toLocaleString('ko-KR');
    $('relation-count').textContent =
      `원본 ${n(value.sourceRows)}행 · 착지 ${n(value.stops)}개 · 주소 ${n(value.geoDone)}/${n(value.geoTotal)} · 후보 ${n(value.candidates)}구간 · 완료 ${n(value.completed)} · 캐시 ${n(value.cached)} · 실패 ${n(value.failed)} · 보류 ${n(value.deferred)} · 도로 요청 ${n(value.directionsAttempts)}/${n(value.directionsBudget)} · 주소 요청 ${n(value.geocodingAttempts)}/${n(value.geocodingBudget)}`;
    const issues = value.geoIssues ?? [];
    $('relation-issues').hidden = !issues.length;
    $('relation-issue-list').replaceChildren();
    for (const issue of issues) {
      const li = document.createElement('li');
      li.textContent = issue.address + ' · ' + issue.error;
      $('relation-issue-list').append(li);
    }
    $('relation-results').replaceChildren();
    const criteria = {
      center: '센터 출발',
      historical: '기존 배송',
      region: '권역',
      nearby: '인접',
    };
    for (const r of value.lastResults ?? []) {
      const row = document.createElement('tr'),
        old = r.measuredAt && Date.now() - Date.parse(r.measuredAt) > 1800000;
      const values = [
        r.from,
        r.to,
        criteria[r.reason] ?? r.reason,
        Number.isFinite(r.distanceMeters)
          ? (r.distanceMeters / 1000).toFixed(2)
          : '',
        Number.isFinite(r.durationSeconds)
          ? (r.durationSeconds / 60).toFixed(1)
          : '',
        r.measuredAt
          ? new Date(r.measuredAt).toLocaleString('ko-KR', {
              timeZone: 'Asia/Seoul',
            })
          : '',
        r.error ||
          [r.cached ? '저장값' : '조회값', old ? '오래된 추정' : '']
            .filter(Boolean)
            .join(' · '),
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value ?? '';
        row.append(cell);
      }
      $('relation-results').append(row);
    }
    controls();
  }
  function criteria() {
    return {
      center: '002',
      origin: $('relation-origin').value.trim(),
      limit: Number($('relation-limit').value),
      directionsBudget: Number($('relation-budget').value),
      ...(sourceRows ? { rows: sourceRows } : {}),
    };
  }
  async function call(action, args = {}) {
    const { data, error } = await supabase.functions.invoke('naver-relations', {
      body: { ...args, center: '002', action },
    });
    if (error) {
      let text = error.message;
      try {
        text = (await error.context.json()).error || text;
      } catch {}
      throw Error(text || '구간 수집 연결 실패');
    }
    if (data?.error && !(data.id && data.status)) throw Error(data.error);
    return data;
  }
  async function guarded(action, refresh = false) {
    if (busy || blocked) return;
    busy = true;
    stopped = false;
    onBusyChange(true);
    controls();
    try {
      const latest = await menuPermissions(true);
      allowed = permissionAllowed(latest, 'delivery_points', 'edit', '002');
      if (!allowed) throw Error('평택 납품처 수정 권한이 필요합니다.');
      await action();
      if (refresh) await onCollected();
    } catch (e) {
      message(e.message);
    } finally {
      busy = false;
      activeJobId = null;
      onBusyChange(false);
      controls();
    }
  }
  function invalidate() {
    preview = null;
    $('relation-start').disabled = true;
  }
  async function previewSource() {
    preview = await call('preview', criteria());
    $('relation-count').textContent =
      `원본 ${preview.sourceRows.toLocaleString('ko-KR')}행 · 통합 착지 ${preview.stops.toLocaleString('ko-KR')}개 · 주소 누락 ${preview.invalidRows.toLocaleString('ko-KR')}행 · 예상 최대 ${preview.estimatedCandidates.toLocaleString('ko-KR')}구간 · 이번 도로 요청 한도 ${preview.directionsBudget.toLocaleString('ko-KR')}건`;
    message('후보 범위 확인 완료');
  }
  async function collect() {
    activeJobId = job?.id;
    controls();
    while (!stopped && job && ['queued', 'running'].includes(job.status)) {
      const value = await call('batch', { jobId: job.id });
      render(value);
      if (value.busy) await delay(2000);
      else await delay(250);
    }
  }
  async function create() {
    job = await call('create', criteria());
    render(job);
    await collect();
  }
  async function resume() {
    render(
      await call('resume', {
        jobId: job.id,
        directionsBudget: Number($('relation-budget').value),
        expectedUpdatedAt: job.updatedAt,
      }),
    );
    await collect();
  }
  async function restore() {
    const { data, error } = await supabase
      .from('naver_api_jobs')
      .select('id')
      .eq('owner_id', profile.id)
      .eq('center_code', '002')
      .eq('state->>kind', 'collection')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw Error('최근 수집 작업을 불러오지 못했습니다.');
    if (!data) {
      message('저장된 수집 작업이 없습니다.');
      return;
    }
    render(await call('status', { jobId: data.id }));
  }
  async function singlePair() {
    const from = $('relation-pair-from').value.trim(),
      to = $('relation-pair-to').value.trim();
    if (!from || !to) throw Error('출발·도착 주소를 입력해 주세요.');
    if (
      from.normalize('NFKC').replace(/\s/g, '') ===
      to.normalize('NFKC').replace(/\s/g, '')
    ) {
      $('relation-pair-status').textContent =
        '같은 주소 · 이동 거리 0km · 이동시간 0분';
      return;
    }
    let value = await call('create', {
      kind: 'single',
      origin: from,
      rows: [{ address: to, source: 'manual', sourceRow: 1 }],
      limit: 1,
      directionsBudget: 3,
    });
    activeJobId = value.id;
    controls();
    while (!stopped && ['queued', 'running'].includes(value.status)) {
      $('relation-pair-status').textContent = '구간 조회 중';
      value = await call('batch', { jobId: value.id });
      if (value.busy) await delay(2000);
    }
    const r = value.lastResults?.at(-1);
    $('relation-pair-status').textContent =
      r && !r.error
        ? `${(r.distanceMeters / 1000).toFixed(2)}km · ${(r.durationSeconds / 60).toFixed(1)}분 · ${new Date(r.measuredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · ${r.cached ? '저장값 재사용' : 'DB 저장 완료'}`
        : value.error || r?.error || '구간 조회 중지';
  }
  async function upload() {
    const files = Array.from($('relation-files').files);
    if (!files.length) return;
    const rows = [];
    for (const file of files) {
      if (file.size > 30 * 1024 * 1024)
        throw Error('각 파일은 30MB 이하로 선택해 주세요.');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }),
        name =
          wb.SheetNames.find((n) => n === 'Sheet1') ??
          wb.SheetNames.find((n) => wb.Sheets[n]['!ref']);
      if (!name) throw Error(file.name + '에 주소 자료가 없습니다.');
      const sheet = wb.Sheets[name];
      const data = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          range: 0,
        }),
        headerRow = data
          .slice(0, 30)
          .findIndex((r) =>
            r.some((v) =>
              /^주소$|배송주소|납품처주소/.test(String(v).replace(/\s/g, '')),
            ),
          );
      if (headerRow < 0)
        throw Error(file.name + '의 주소 열을 확인하지 못했습니다.');
      const header = data[headerRow].map((v) => String(v).replace(/\s/g, '')),
        addressColumn = header.findIndex((v) =>
          /^주소$|배송주소|납품처주소/.test(v),
        );
      let nameColumn = header.findIndex((v) =>
        /^(착지|착지명|납품처|납품처명|거래처|거래처명|업체명)$/.test(v),
      );
      if (nameColumn < 0) nameColumn = Math.max(0, addressColumn - 1);
      const timeColumn = header.findIndex((v) =>
        /OTD|납품시간|도착시간|^시간$/i.test(v),
      );
      const customerColumn = header.findIndex((v) =>
          /^(고객사|고객사명)$/.test(v),
        ),
        quantityColumn = header.findIndex((v) => /물량|박스|수량/.test(v)),
        courseColumn = header.findIndex((v) =>
          /^(코스|코스명|차량번호|호차)$/.test(v),
        );
      const cell = (row, column) => {
        if (column < 0) return '';
        const merged = (sheet['!merges'] ?? []).find(
            (m) =>
              row >= m.s.r &&
              row <= m.e.r &&
              column >= m.s.c &&
              column <= m.e.c,
          ),
          value =
            sheet[
              XLSX.utils.encode_cell(merged ? merged.s : { r: row, c: column })
            ];
        return value?.t === 'e' ? '' : (value?.v ?? '');
      };
      rows.push(
        ...excelAddresses(sheet, XLSX, {
          addressColumn,
          nameColumn,
          startRow: headerRow + 2,
        }).map((r) => ({
          ...r,
          source: file.name,
          sourceSheet: name,
          customer: cell(r.sourceRow - 1, customerColumn),
          quantity: cell(r.sourceRow - 1, quantityColumn),
          originalCourse: cell(r.sourceRow - 1, courseColumn),
          otd: String(cell(r.sourceRow - 1, timeColumn)),
        })),
      );
      if (rows.length > 20000)
        throw Error('합계 20,000행 이하로 선택해 주세요.');
    }
    sourceRows = rows;
    $('relation-source-label').textContent = files
      .map((f) => f.name)
      .join(', ');
    invalidate();
    await previewSource();
  }
  async function download() {
    if (!globalThis.ExcelJS) throw Error('엑셀 모듈을 불러오지 못했습니다.');
    const addresses = new Map();
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from('naver_api_addresses')
        .select('id,address')
        .eq('center_code', '002')
        .order('id')
        .range(offset, offset + 499);
      if (error) throw Error('주소 조회 실패');
      for (const a of data) addresses.set(a.id, a.address);
      if (data.length < 500) break;
    }
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet('평택 도로 구간');
    sheet.addRow([
      '출발 주소',
      '도착 주소',
      '도로 거리(km)',
      '이동시간(분)',
      '측정 시각(KST)',
      '경로 기준',
      '상태',
    ]);
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase
        .from('naver_api_legs')
        .select(
          'from_id,to_id,distance_meters,duration_seconds,measured_at,priority',
        )
        .eq('center_code', '002')
        .order('from_id')
        .order('to_id')
        .order('coords_key')
        .order('priority')
        .range(offset, offset + 499);
      if (error) throw Error('구간 조회 실패');
      for (const r of data)
        sheet.addRow([
          addresses.get(r.from_id) || '',
          addresses.get(r.to_id) || '',
          Number(r.distance_meters) / 1000,
          Number(r.duration_seconds) / 60,
          new Date(r.measured_at).toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
          }),
          r.priority,
          Date.now() - Date.parse(r.measured_at) > 1800000
            ? '오래된 추정'
            : '조회 시점 추정',
        ]);
      if (data.length < 500) break;
    }
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((c, i) => (c.width = i < 2 ? 55 : 24));
    sheet.getRow(1).font = { bold: true };
    const buffer = await wb.xlsx.writeBuffer(),
      url = URL.createObjectURL(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = '평택_도로구간.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function initialize() {
    if (!allowed)
      message('도로 구간 수집에는 평택 납품처 수정 권한이 필요합니다.');
    $('relation-use-db').onclick = () =>
      guarded(async () => {
        sourceRows = null;
        $('relation-files').value = '';
        $('relation-source-label').textContent = '평택 납품처 DB';
        invalidate();
        await previewSource();
      });
    $('relation-files').onchange = () => guarded(upload);
    $('relation-preview').onclick = () => guarded(previewSource);
    $('relation-start').onclick = () => guarded(create, true);
    $('relation-restore').onclick = () => guarded(restore);
    $('relation-resume').onclick = () => guarded(resume, true);
    $('relation-download').onclick = () => guarded(download);
    $('relation-pair').onclick = () => guarded(singlePair, true);
    $('relation-stop').onclick = async () => {
      if (!activeJobId) return;
      stopped = true;
      controls();
      const { error } = await supabase.rpc('naver_api_cancel', {
        p_job: activeJobId,
      });
      if (error) message('중지 요청 실패 · 현재 배치 종료 후 조회를 멈춥니다.');
      else message('중지 요청됨 · 진행 중인 결과 저장 대기');
    };
    for (const id of ['relation-origin', 'relation-limit', 'relation-budget'])
      $(id).onchange = invalidate;
    addEventListener('pagehide', () => {
      stopped = true;
    });
    controls();
  }
  initialize();
  return {
    setBlocked(value) {
      blocked = value;
      controls();
    },
  };
}
