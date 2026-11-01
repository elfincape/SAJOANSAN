import { useEffect, useRef, useState } from 'react';
import { privateMail } from '../../lib/portal-mail';
import type {
  MailAnalysisRule,
  MailFilterStatus,
  MailRulePreview,
} from '../../lib/portal-mail';

type Override = 'inherit' | 'include' | 'exclude';
const photoReasons: Record<string, string> = {
  REMOTE_IMAGE_REVIEW:
    '본문이 외부 이미지로 구성되어 있습니다. 확인된 본문 이미지의 분석 범위를 검토해야 합니다.',
  REMOTE_IMAGE_SOURCE:
    '외부 본문 이미지를 안전하게 읽지 못했습니다. 원문은 보존되어 있습니다.',
  BODY_IMAGES_EXCLUDED:
    '본문이 이미지로 구성되어 있어 본문·헤더만으로 정리할 수 없습니다. 이번 분석 범위에서 이미지는 제외됐습니다.',
  ANALYSIS_SUMMARY_EMPTY:
    '요약 내용이 비어 있어 완료로 저장하지 않았습니다. 기존 결과를 보존합니다.',
  IMAGE_CONTEXT_REVIEW:
    '첨부 사진을 원본 메일과 정확히 연결하지 못했습니다. 원본 첨부를 확인해 주세요.',
  IMAGE_PRIVACY_REVIEW:
    '보호 정보가 포함될 수 있는 사진은 자동 분석하지 않았습니다. 원본 첨부를 직접 확인해 주세요.',
  IMAGE_LIMIT:
    '첨부 사진이 자동 분석의 크기·개수 범위를 넘었습니다. 원본 첨부를 확인해 주세요.',
  IMAGE_TYPE_UNSUPPORTED:
    '이 사진 형식은 자동 분석을 지원하지 않습니다. 원본 첨부에서 확인해 주세요.',
};

const fields: Record<MailAnalysisRule['conditions'][number]['field'], string> =
  {
    subject: '제목에 포함',
    body: '본문에 포함',
    sender: '보낸 주소 일치',
    domain: '보낸 도메인 일치',
  };
function errorCode(error: unknown) {
  const value =
    error && typeof error === 'object'
      ? (error as { code?: string; message?: string })
      : {};
  return value.code || value.message || '';
}
function filterError(error: unknown) {
  return (
    (
      {
        ...photoReasons,
        MAIL_FILTER_SCHEMA_REQUIRED:
          '분석 제외 저장 설정이 준비되지 않았습니다.',
        MAIL_RULE_INVALID:
          '규칙 이름과 조건을 확인해 주세요. 보낸 주소와 도메인은 정확한 형식으로 입력해 주세요.',
        MAIL_FILTER_BODY_UNAVAILABLE:
          '본문을 읽지 못했습니다. 기존 제외 설정을 유지합니다.',
        MAIL_FILTER_TIMEOUT:
          '본문 확인에 시간이 걸립니다. 잠시 후 다시 시도해 주세요.',
        MAIL_RULE_PREVIEW_REQUIRED:
          '켜거나 수정한 규칙의 미리보기를 먼저 확인해 주세요.',
        OWNER_REQUIRED: '본인 계정에서만 설정할 수 있습니다.',
        NOTES_PERMISSION_REQUIRED:
          'OneNote 읽기·쓰기 권한 연결을 먼저 완료해 주세요.',
        MICROSOFT_CONNECTION_REQUIRED:
          'Microsoft 계정의 OneNote 권한을 먼저 연결해 주세요.',
        NOTES_TARGET_UNAVAILABLE: 'OneNote 일일정리 섹션 접근을 확인해 주세요.',
        AI_NOT_CONFIGURED: 'AI 분석 연결이 준비되지 않았습니다.',
        ONEDRIVE_CONNECTION_BUSY:
          '다른 파일 작업이 진행 중입니다. 작업이 끝나면 원노트 기록을 이어갑니다.',
        MODEL_TRUNCATED:
          '모델의 출력 한도에 도달해 분석이 중단됐습니다. 이번 결과는 저장하지 않았습니다.',
        MODEL_RESPONSE:
          '모델이 빈 답변을 반환했거나 응답 형식을 확인하지 못했습니다. 이번 결과는 저장하지 않았습니다.',
        MODEL_FAILED:
          'AI 제공자 요청이 실패했습니다. 연결 상태와 서버 오류 기록을 확인해 주세요.',
        RATE_LIMITED:
          'AI 제공자 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',

        MAIL_NOT_FOUND:
          '대상 메일을 찾지 못했습니다. 목록을 다시 확인해 주세요.',
      } as Record<string, string>
    )[errorCode(error)] ||
    '요청을 처리하지 못했습니다. 기존 설정을 확인한 뒤 다시 시도해 주세요.'
  );
}
function confirmReportChange(subjects: string[]) {
  return window.confirm(
    `다음 메일 ${subjects.length}건이 기존 OneNote 일일정리에 포함되어 있습니다. 제외 상태가 바뀌면 해당 메일의 자동 정리 영역을 갱신해도 될까요? 원본 메일과 직접 작성한 메모는 삭제하지 않습니다.\n\n${subjects.map((subject) => '- ' + subject).join('\n')}`,
  );
}
export function MailFilterControls({
  onChanged,
  onBusyChange,
  disabled = false,
}: {
  onChanged: () => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [data, setData] = useState<MailFilterStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busyText, setBusyText] = useState('');
  const [reportRetry, setReportRetry] = useState<{
    day: string;
    subject: string;
  } | null>(null);
  const [draft, setDraft] = useState<MailAnalysisRule | null>(null);
  const [preview, setPreview] = useState<{
    digest: string;
    result: MailRulePreview;
  } | null>(null);
  const [choices, setChoices] = useState<Record<string, Override>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const mounted = useRef(false);
  const requested = useRef(false);
  const locked = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  async function read(targetOffset = offset) {
    const id = ++request.current;
    const result = await privateMail.filterStatus(targetOffset);
    if (!mounted.current || id !== request.current) return;
    setData(result);
    const nextOffset = result.offset ?? targetOffset;
    setOffset(nextOffset);
    setChoices({});
    setSelected((current) =>
      nextOffset !== offset
        ? []
        : current.filter((id) =>
            result.messages.some((mail) => mail.id === id),
          ),
    );
  }
  async function act(
    action: () => Promise<string | void>,
    label = '분석 제외 설정을 확인하는 중…',
  ) {
    if (locked.current || disabled) return;
    locked.current = true;
    setBusy(true);
    setBusyText(label);
    onBusyChange(true);
    setFeedback('');
    try {
      const result = await action();
      if (mounted.current && result) setFeedback(result);
    } catch (error) {
      if (mounted.current) setFeedback(filterError(error));
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  function edit(rule: MailAnalysisRule) {
    setDraft(structuredClone(rule));
    setPreview(null);
    setFeedback('');
  }
  function update(rule: MailAnalysisRule) {
    setDraft(rule);
    setPreview(null);
    setFeedback('');
  }
  const digest = JSON.stringify(draft);
  const valid = Boolean(
    draft &&
    draft.name.trim() &&
    draft.conditions.length &&
    draft.conditions.every((condition) => condition.value.trim()),
  );
  const saved = draft ? data?.rules.find((rule) => rule.id === draft.id) : null;
  const changed = draft && JSON.stringify(saved) !== digest;
  const previewed = preview?.digest === digest;
  async function showPreview(next = false) {
    if (!draft) return;
    const rule = structuredClone(draft),
      key = digest;
    await act(async () => {
      const result = await privateMail.previewRule({
        rule,
        offset: next ? preview?.result.nextOffset || 0 : 0,
        limit: 5,
      });
      if (!mounted.current) return;
      setPreview((current) => ({
        digest: key,
        result:
          next && current?.digest === key
            ? {
                ...result,
                matches: [...current.result.matches, ...result.matches],
                unresolved: [
                  ...current.result.unresolved,
                  ...result.unresolved,
                ],
                scanned: current.result.scanned + result.scanned,
              }
            : result,
      }));
    });
  }
  async function saveRule(remove = false) {
    if (!draft || !data) return;
    const next = data.rules.filter((rule) => rule.id !== draft.id);
    if (!remove) next.push(draft);
    await act(async () => {
      const result = await privateMail.saveRules({
        rules: next,
        previewConfirmed: !remove && Boolean(previewed),
      });
      if (!result.saved) throw Error('save failed');
      if (!mounted.current) return;
      setDraft(null);
      setPreview(null);
      try {
        await read();
      } catch {
        return '규칙 변경은 저장했지만 목록을 갱신하지 못했습니다. 제외 설정을 새로고침해 주세요.';
      }
      return remove
        ? '규칙을 삭제했습니다. 기존 메일의 제외 상태는 아래에서 개별 변경하거나 선택 적용해 주세요.'
        : '규칙을 저장했습니다. 기존 메일은 아래에서 선택한 경우에만 다시 적용합니다.';
    });
  }
  async function applyOverride(id: string, override: Override) {
    await act(async () => {
      try {
        const result = await privateMail.setMailFilter({ id, override });
        if (!result.saved) throw Error('save failed');
      } catch (error) {
        if (errorCode(error) !== 'FILTER_REPORT_CONFIRM_REQUIRED') throw error;
        if (
          !mounted.current ||
          !confirmReportChange([
            data?.messages.find((mail) => mail.id === id)?.subject ||
              '(제목 없음)',
          ])
        )
          return 'OneNote 자동 정리 갱신을 취소했습니다. 기존 설정을 유지합니다.';
        const retried = await privateMail.setMailFilter({
          id,
          override,
          confirmExisting: true,
        });
        if (!retried.saved) throw Error('save failed');
      }
      if (!mounted.current) return;
      try {
        await read();
      } catch {
        if (mounted.current) onChanged();
        return '메일 설정은 저장했지만 목록을 갱신하지 못했습니다. 제외 설정을 새로고침해 주세요.';
      }
      if (!mounted.current) return;
      onChanged();
      return '메일의 분석 제외 설정을 저장했습니다. 원본 메일은 유지됩니다.';
    });
  }
  async function applySelected() {
    const ids = [...selected];
    await act(async () => {
      const result = await privateMail.applyRules({ ids });
      if (!mounted.current) return;
      const confirmations = result.unresolved
        .filter((item) => item.code === 'FILTER_REPORT_CONFIRM_REQUIRED')
        .map((item) => item.id);
      let unresolved = result.unresolved.filter(
        (item) => item.code !== 'FILTER_REPORT_CONFIRM_REQUIRED',
      ).length;
      let cancelled = false;
      if (confirmations.length) {
        if (
          confirmReportChange(
            confirmations.map(
              (id) =>
                data?.messages.find((mail) => mail.id === id)?.subject ||
                '(제목 없음)',
            ),
          )
        ) {
          const retry = await privateMail.applyRules({
            ids: confirmations,
            confirmExisting: true,
          });
          unresolved += retry.unresolved.length;
        } else cancelled = true;
      }
      if (!mounted.current) return;
      let refreshed = true;
      try {
        await read();
      } catch {
        refreshed = false;
      }
      if (!mounted.current) return;
      onChanged();
      setSelected([]);
      return `${ids.length}건의 규칙 적용을 확인했습니다.${cancelled ? ' OneNote 갱신이 필요한 메일은 기존 상태를 유지했습니다.' : ''}${unresolved ? ` ${unresolved}건은 판단하지 못해 기존 상태를 유지했습니다.` : ''}${!refreshed ? ' 목록은 갱신하지 못했습니다. 제외 설정을 새로고침해 주세요.' : ''}`;
    });
  }
  function reportReason(code?: string) {
    return (
      {
        ...photoReasons,
        NOTES_IMAGE_TYPE_UNSUPPORTED:
          '본문 정리는 반영됐지만 원본 WebP 등 사진 형식을 확인해야 합니다. 해당 사진의 반영은 완료되지 않았습니다.',
        NOTES_PERMISSION_REQUIRED:
          'OneNote 읽기·쓰기 권한 연결을 먼저 완료해 주세요.',
        MICROSOFT_CONNECTION_REQUIRED:
          'Microsoft 계정의 OneNote 권한을 먼저 연결해 주세요.',
        NOTES_TARGET_UNAVAILABLE:
          '할 일 목록 노트북의 일일정리 섹션 접근을 확인해 주세요.',
        NOTES_RATE_LIMITED:
          'OneNote 요청이 많습니다. 잠시 후 정리 반영을 이어서 확인해 주세요.',
        PAGE_MANAGED_CONFLICT:
          'OneNote 자동 정리 영역이 변경됐습니다. 내용을 확인한 뒤 다시 반영해 주세요.',
        PAGE_WRITE_UNCERTAIN:
          'OneNote 반영 결과를 다시 확인해야 합니다. 정리 반영을 이어서 확인해 주세요.',
        AI_NOT_CONFIGURED: 'AI 분석 연결이 준비되지 않았습니다.',
        ONEDRIVE_CONNECTION_BUSY:
          '다른 파일 작업이 진행 중입니다. 작업이 끝나면 원노트 기록을 이어갑니다.',
        MODEL_TRUNCATED:
          '모델의 출력 한도에 도달해 분석이 중단됐습니다. 이번 결과는 저장하지 않았습니다.',
        MODEL_RESPONSE:
          '모델이 빈 답변을 반환했거나 응답 형식을 확인하지 못했습니다. 이번 결과는 저장하지 않았습니다.',
        MODEL_FAILED:
          'AI 제공자 요청이 실패했습니다. 연결 상태와 서버 오류 기록을 확인해 주세요.',
        RATE_LIMITED:
          'AI 제공자 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
      } as Record<string, string>
    )[code || ''];
  }
  async function writeSelectedReport(day: string, subject: string) {
    if (!mounted.current) return;
    setReportRetry({ day, subject });
    let result: Awaited<ReturnType<typeof privateMail.writeReport>> | null =
      null;
    for (let part = 0; part < 5; part++) {
      if (!mounted.current) return;
      setBusyText(`${day} 정리·사진 반영 확인 ${part + 1}/5…`);
      result = await privateMail.writeReport(day);
      if (!mounted.current) return;
      if (result.status !== 'pending' || result.code) break;
    }
    if (!result || !mounted.current) return;
    if (result.code)
      return (
        reportReason(result.code) ||
        'OneNote 정리 또는 사진 반영에 확인이 필요합니다. 정리 반영을 이어서 확인해 주세요.'
      );
    if (
      ['created', 'updated', 'reconciled', 'skipped'].includes(result.status)
    ) {
      setReportRetry(null);
      return result.status === 'skipped'
        ? '저장된 분석과 OneNote 정리가 같습니다. 추가 변경은 없습니다.'
        : 'OneNote 기록을 확인했습니다.';
    }
    if (result.status === 'pending')
      return '본문 정리를 반영했으며 사진 추가 반영이 남아 있습니다. OneNote에 기록 버튼으로 계속할 수 있습니다.';
    if (result.status === 'busy')
      return '같은 날짜의 정리가 진행 중입니다. 잠시 후 정리 반영을 이어서 확인해 주세요.';
    return 'OneNote 정리 반영이 대기 중입니다. 연결 상태를 확인한 뒤 정리 반영을 이어서 확인해 주세요.';
  }
  async function organizeMail(mail: MailFilterStatus['messages'][number]) {
    if (mail.analysis_excluded) return;
    await act(async () => {
      const result = await privateMail.analyzeOne(mail.id);
      if (!mounted.current) return;
      if (result.status === 'excluded')
        return '이 메일은 분석 제외 상태입니다. 먼저 메일 설정에서 분석 포함으로 복원해 주세요.';
      if (result.status !== 'done')
        return (
          reportReason(result.code) ||
          (result.status === 'stale'
            ? '이 메일의 분석 상태가 변경됐습니다. 목록을 새로고침한 뒤 다시 확인해 주세요.'
            : '이 메일의 분석을 완료하지 못했습니다. 상태와 연결을 확인한 뒤 다시 시도해 주세요.')
        );
      onChanged();
      if (result.reportDay)
        setReportRetry({
          day: result.reportDay,
          subject: mail.subject || '(제목 없음)',
        });
      try {
        await read();
      } catch {
        return '메일 분석은 포털에 저장했습니다. 메일 목록은 새로고침해 주세요.';
      }
      return '메일 분석을 포털에 저장했습니다.';
    }, '선택한 기존 메일 1건을 정리하는 중…');
  }
  async function resumeReport() {
    if (!reportRetry) return;
    const target = reportRetry;
    await act(async () => {
      const message = await writeSelectedReport(target.day, target.subject);
      if (mounted.current) onChanged();
      return message;
    }, '저장된 분석으로 OneNote 정리·사진 반영을 이어가는 중…');
  }
  return (
    <details
      className="daily-filters work-surface"
      onToggle={(event) => {
        if (event.currentTarget.open && !requested.current && !disabled) {
          requested.current = true;
          void act(async () => {
            await read();
          });
        }
      }}
    >
      <summary>
        <strong>메일 선택·정리·분석 제외</strong>
      </summary>
      <p>
        수집된 메일을 한 건씩 포털에 정리하고, 분석 제외와 제외 규칙을
        설정합니다. 제외한 메일의 원본 수집·보관은 유지합니다.
      </p>
      <p className="daily-feedback" role="status" aria-live="polite">
        {busy ? busyText : feedback}
      </p>
      {reportRetry ? (
        <div className="daily-filter-actions">
          <span>
            {reportRetry.day} · {reportRetry.subject}
          </span>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || disabled}
            onClick={() => void resumeReport()}
          >
            OneNote에 기록
          </button>
        </div>
      ) : null}
      <button
        className="btn btn-ghost"
        type="button"
        disabled={busy || disabled}
        onClick={() =>
          void act(async () => {
            await read();
          })
        }
      >
        제외 설정 새로고침
      </button>
      {data && !data.schemaReady ? (
        <p>분석 제외 저장 설정이 준비되지 않았습니다.</p>
      ) : null}
      {data?.schemaReady ? (
        <fieldset disabled={busy || disabled} className="daily-filter-fields">
          <legend>제외 규칙</legend>
          {!data.rules.length ? (
            <p>등록된 제외 규칙이 없습니다.</p>
          ) : (
            <ul className="daily-filter-rules">
              {data.rules.map((rule) => (
                <li key={rule.id}>
                  <div>
                    <strong>{rule.name}</strong> ·{' '}
                    {rule.enabled ? '켜짐' : '꺼짐'} ·{' '}
                    {rule.mode === 'all'
                      ? '모든 조건 일치 (AND)'
                      : '하나 이상 일치 (OR)'}
                  </div>
                  <p>
                    {rule.conditions
                      .map(
                        (condition) =>
                          `${fields[condition.field]}: ${condition.value}`,
                      )
                      .join(rule.mode === 'all' ? ' 그리고 ' : ' 또는 ')}
                  </p>

                  <div className="daily-filter-actions">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => edit(rule)}
                    >
                      편집
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => edit({ ...rule, enabled: !rule.enabled })}
                    >
                      {rule.enabled ? '끄기 설정' : '켜기 설정'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            className="btn btn-ghost"
            type="button"
            disabled={data.rules.length >= 50}
            onClick={() =>
              edit({
                id: crypto.randomUUID(),
                name: '',
                enabled: false,
                mode: 'all',
                conditions: [{ field: 'subject', value: '' }],
              })
            }
          >
            규칙 추가
          </button>
          {draft ? (
            <div className="daily-rule-editor">
              <label>
                규칙 이름
                <input
                  className="app-input"
                  value={draft.name}
                  maxLength={100}
                  onChange={(event) =>
                    update({ ...draft, name: event.target.value })
                  }
                />
              </label>
              <label className="daily-filter-check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) =>
                    update({ ...draft, enabled: event.target.checked })
                  }
                />
                이 제외 규칙 켜기
              </label>
              <label>
                조건 조합
                <select
                  className="app-select"
                  aria-label="조건 조합"
                  value={draft.mode}
                  onChange={(event) =>
                    update({
                      ...draft,
                      mode: event.target.value as 'all' | 'any',
                    })
                  }
                >
                  <option value="all">모든 조건 일치 (AND)</option>
                  <option value="any">하나 이상 일치 (OR)</option>
                </select>
              </label>
              <p>
                제목·본문은 포함 여부, 보낸 주소·도메인은 정확한 일치로
                확인합니다. 전각·반각과 영문 대소문자는 구분하지 않습니다.
              </p>
              {draft.conditions.map((condition, index) => (
                <div className="daily-rule-condition" key={index}>
                  <label>
                    조건 {index + 1}
                    <select
                      className="app-select"
                      aria-label={`조건 ${index + 1}`}
                      value={condition.field}
                      onChange={(event) =>
                        update({
                          ...draft,
                          conditions: draft.conditions.map((item, at) =>
                            at === index
                              ? {
                                  ...item,
                                  field: event.target
                                    .value as typeof condition.field,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      {Object.entries(fields).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    비교 값 {index + 1}
                    <input
                      className="app-input"
                      value={condition.value}
                      maxLength={500}
                      onChange={(event) =>
                        update({
                          ...draft,
                          conditions: draft.conditions.map((item, at) =>
                            at === index
                              ? { ...item, value: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={draft.conditions.length <= 1}
                    onClick={() =>
                      update({
                        ...draft,
                        conditions: draft.conditions.filter(
                          (_, at) => at !== index,
                        ),
                      })
                    }
                  >
                    조건 {index + 1} 삭제
                  </button>
                </div>
              ))}
              <div className="daily-filter-actions">
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={draft.conditions.length >= 10}
                  onClick={() =>
                    update({
                      ...draft,
                      conditions: [
                        ...draft.conditions,
                        { field: 'subject', value: '' },
                      ],
                    })
                  }
                >
                  조건 추가
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={!valid || !draft.enabled}
                  onClick={() => void showPreview()}
                >
                  적용 대상 미리보기
                </button>
              </div>
              {draft.enabled && !previewed ? (
                <p>
                  규칙을 켜서 저장하려면 변경한 조건으로 미리보기를 확인해
                  주세요.
                </p>
              ) : null}
              {previewed && preview ? (
                <div className="daily-rule-preview">
                  <p>
                    조회한 {preview.result.scanned}건 중 제외{' '}
                    {
                      preview.result.matches.filter((mail) => mail.matched)
                        .length
                    }
                    건 · 판단 보류 {preview.result.unresolved.length}건. 전체
                    메일에 적용한 결과가 아닙니다.
                  </p>
                  <ul>
                    {preview.result.matches.map((mail) => (
                      <li key={mail.id}>
                        <a
                          href={
                            '/portal/?view=mail&message=' +
                            encodeURIComponent(mail.id)
                          }
                        >
                          {mail.subject || '(제목 없음)'}
                        </a>{' '}
                        · {mail.matched ? '제외 대상' : '해당 없음'}
                        {mail.matchedFields.length
                          ? ` · ${mail.matchedFields.map((field) => fields[field as keyof typeof fields] || '조건').join(', ')}`
                          : ''}
                      </li>
                    ))}
                    {preview.result.unresolved.map((mail) => (
                      <li key={mail.id}>
                        <a
                          href={
                            '/portal/?view=mail&message=' +
                            encodeURIComponent(mail.id)
                          }
                        >
                          {mail.subject || '원본 메일 확인'}
                        </a>{' '}
                        · 원본을 확인하지 못해 판단 보류
                      </li>
                    ))}
                  </ul>
                  {preview.result.more ? (
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => void showPreview(true)}
                    >
                      다음 5건 미리보기
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="daily-filter-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!valid || !changed || (draft.enabled && !previewed)}
                  onClick={() => void saveRule()}
                >
                  규칙 저장
                </button>
                {saved ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => void saveRule(true)}
                  >
                    규칙 삭제
                  </button>
                ) : null}
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setPreview(null);
                  }}
                >
                  편집 닫기
                </button>
              </div>
            </div>
          ) : null}
          <h3>메일별 정리·제외·복원</h3>
          <p>
            ‘선택 메일 정리’는 저장된 해당 메일 1건을 포털에 분석·저장합니다.
            OneNote 기록은 선택입니다.
          </p>
          <p>
            ‘규칙 무시·포함’은 제외 규칙보다 우선하며, ‘규칙에 맡김’은 저장된
            규칙으로 다시 판단합니다.
          </p>
          <div className="daily-filter-actions">
            <button
              className="btn btn-ghost"
              type="button"
              disabled={offset === 0}
              onClick={() =>
                void act(async () => {
                  await read(Math.max(0, offset - 25));
                })
              }
            >
              이전 25건
            </button>
            <span>
              {data.messages.length
                ? `수신 메일 ${offset + 1}–${offset + data.messages.length}건`
                : '수신 메일 0건'}
            </span>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={!data.hasMore}
              onClick={() =>
                void act(async () => {
                  await read(data.nextOffset ?? offset + 25);
                })
              }
            >
              다음 25건
            </button>
          </div>
          <div className="daily-filter-actions">
            <button
              className="btn btn-ghost"
              type="button"
              disabled={!selected.length}
              onClick={() => void applySelected()}
            >
              선택한 {selected.length}건에 저장된 규칙 적용
            </button>
            <span>최대 20건 선택</span>
          </div>
          <ul
            className="daily-filter-messages"
            tabIndex={0}
            aria-label="최근 메일의 분석 제외 설정"
          >
            {data.messages.map((mail) => {
              const choice =
                choices[mail.id] || mail.analysis_filter_override || 'inherit';
              return (
                <li key={mail.id}>
                  <label className="daily-filter-check">
                    <input
                      type="checkbox"
                      aria-label={`${mail.subject || '(제목 없음)'} 규칙 적용 대상 선택`}
                      checked={selected.includes(mail.id)}
                      disabled={
                        !selected.includes(mail.id) && selected.length >= 20
                      }
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, mail.id]
                            : current.filter((id) => id !== mail.id),
                        )
                      }
                    />
                    <a
                      href={
                        '/portal/?view=mail&message=' +
                        encodeURIComponent(mail.id)
                      }
                    >
                      {mail.subject || '(제목 없음)'}
                    </a>
                  </label>
                  <p>
                    {mail.sender} ·{' '}
                    {mail.analysis_excluded
                      ? `분석 제외${mail.analysis_exclusion?.ruleName ? ` · 규칙: ${mail.analysis_exclusion.ruleName}` : mail.analysis_filter_override === 'exclude' ? ' · 본인 지정' : ''}`
                      : '분석 포함'}
                    {mail.analysis_filter_override === 'include'
                      ? ' · 규칙 무시·포함'
                      : ''}
                  </p>
                  {mail.analysis_excluded ? (
                    <p>정리하려면 먼저 분석 포함으로 복원해 주세요.</p>
                  ) : null}
                  <div className="daily-filter-actions">
                    <label>
                      분석 포함 여부
                      <select
                        className="app-select"
                        aria-label={`${mail.subject || '(제목 없음)'} 분석 포함 여부`}
                        value={choice}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [mail.id]: event.target.value as Override,
                          }))
                        }
                      >
                        <option value="inherit">규칙에 맡김</option>
                        <option value="exclude">분석 제외</option>
                        <option value="include">규칙 무시·포함</option>
                      </select>
                    </label>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={
                        choice === (mail.analysis_filter_override || 'inherit')
                      }
                      onClick={() => void applyOverride(mail.id, choice)}
                    >
                      메일 설정 저장
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      aria-label={`${mail.subject || '(제목 없음)'} 선택 메일 정리`}
                      disabled={
                        mail.analysis_excluded ||
                        choice !== (mail.analysis_filter_override || 'inherit')
                      }
                      onClick={() => void organizeMail(mail)}
                    >
                      선택 메일 정리
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
    </details>
  );
}
