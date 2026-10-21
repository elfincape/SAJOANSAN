import { PortalInput, PortalField, MentionText } from './PortalMentions';
import { useRef, useState } from 'react';
import type { PortalTemplate } from '../../domain/portal-types';
import { designerDraft, designerSpec } from '../../domain/portal-designer';
import type { DesignerDraft } from '../../domain/portal-designer';
import { portalApi } from '../../lib/portal';
import { PortalDialog } from './PortalDialog';
import { usePortal } from './PortalStore';
import { cadenceLabels } from './PortalTaskList';
export function PortalDesigner({
  template,
  onClose,
}: {
  template: PortalTemplate | null;
  onClose: () => void;
}) {
  const { state, centerName, loadData, message } = usePortal(),
    spec = template?.spec ?? {},
    [draft, setDraft] = useState(() =>
      designerDraft(template?.title ?? '', spec),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    generated = useRef(new Map<string, string>()).current,
    retry = useRef<{
      key: string;
      id: string;
    } | null>(null);
  function change<K extends keyof DesignerDraft>(
    key: K,
    value: DesignerDraft[K],
  ) {
    setDraft((s) => ({ ...s, [key]: value }));
  }
  const dispatchFields = draft.fields.filter((f) =>
      ['text', 'textarea'].includes(f.control),
    ),
    dispatch = draft.dispatch_field
      ? dispatchFields.some((f) => f.key === draft.dispatch_field)
        ? draft.dispatch_field
        : ''
      : (dispatchFields[0]?.key ?? '');
  function text(
    key:
      | 'title'
      | 'description'
      | 'external_process'
      | 'capture_range'
      | 'worksheet'
      | 'due_time'
      | 'steps'
      | 'completion',
    label: string,
    type = 'text',
  ) {
    return (
      <PortalField>
        {label}
        {type === 'textarea' ? (
          <PortalInput
            name={key}
            disabled={busy}
            value={draft[key]}
            onValue={(mentionValue) => change(key, mentionValue)}
            multiline
          />
        ) : (
          <PortalInput
            name={key}
            type={type}
            required={key === 'title'}
            maxLength={key === 'title' ? 200 : undefined}
            pattern={
              key === 'capture_range'
                ? '[A-Za-z]{1,3}[1-9][0-9]{0,3}:[A-Za-z]{1,3}[1-9][0-9]{0,3}'
                : undefined
            }
            disabled={busy}
            value={draft[key]}
            onValue={(mentionValue) => change(key, mentionValue)}
          />
        )}
      </PortalField>
    );
  }
  return (
    <PortalDialog
      id="task-designer-dialog"
      className="task-designer"
      label="센터 업무 커스터마이징"
      onClose={onClose}
    >
      <div className="parent-dialog-heading">
        <h2>
          <MentionText>{centerName(state.center)}</MentionText> ·
          <MentionText> </MentionText>
          <MentionText>
            {template ? '업무 양식 수정' : '센터 업무등록'}
          </MentionText>
        </h2>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
      <form
        className="portal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          let next;
          try {
            next = designerSpec(
              { ...draft, dispatch_field: dispatch },
              spec,
              generated,
            );
          } catch (error) {
            alert(error instanceof Error ? error.message : String(error));
            return;
          }
          const data = {
              center: state.center,
              title: draft.title.trim(),
              spec: next,
              familyId: template?.family_id ?? null,
            },
            key = JSON.stringify(data);
          if (retry.current?.key !== key)
            retry.current = { key, id: crypto.randomUUID() };
          setBusy(true);
          try {
            await portalApi.publishCustom({
              ...data,
              requestId: retry.current.id,
            });
            await loadData();
            message(
              '업무 양식을 저장했습니다. 센터 업무에서 버튼을 눌러 티켓을 발행하세요.',
            );
            onClose();
          } catch (error) {
            setError(
              error && typeof error === 'object' && 'message' in error
                ? String(error.message)
                : String(error),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {text('title', '업무명')}
        {text('description', '업무 안내', 'textarea')}
        <label>
          업무 주기
          <select
            name="cadence"
            disabled={busy}
            value={draft.cadence}
            onChange={(e) => change('cadence', e.target.value)}
          >
            {Object.entries(cadenceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>
          일일은 날짜별, 주간은 월요일부터 일요일까지, 월간은 해당 월에 티켓
          1건을 발행합니다. 같은 기간에 다시 누르면 기존 티켓을 엽니다.
        </p>
        <fieldset className="designer-days" hidden={draft.cadence !== 'daily'}>
          <legend>실행 요일</legend>
          {['월', '화', '수', '목', '금', '토', '일'].map((label, i) => (
            <label key={label} className="weekday-choice">
              <input
                type="checkbox"
                value={i + 1}
                checked={draft.days.includes(i + 1)}
                disabled={busy}
                onChange={(e) =>
                  change(
                    'days',
                    e.target.checked
                      ? [...draft.days, i + 1].sort((a, b) => a - b)
                      : draft.days.filter((day) => day !== i + 1),
                  )
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        {text(
          'external_process',
          '외부 업무 프로세스 (한 줄에 하나)',
          'textarea',
        )}
        <label>
          업무 도움 연동
          <select
            name="integration"
            disabled={busy}
            value={draft.integration}
            onChange={(e) => change('integration', e.target.value)}
          >
            <option value="none">연동 없음</option>
            <option value="coupang_entry">
              쿠팡 입문 확인 · 사진 분석/배차 매칭/엑셀 생성
            </option>
          </select>
        </label>
        <fieldset
          className="designer-integration"
          hidden={draft.integration !== 'coupang_entry'}
        >
          <legend>쿠팡 입문 확인 설정</legend>
          {text('capture_range', '이미지로 만들 범위')}
          {text('worksheet', '시트 이름 (비우면 첫 시트)')}
          <label>
            배차정보 입력 항목
            <select
              name="dispatch_field"
              disabled={busy}
              value={dispatch}
              onChange={(e) => change('dispatch_field', e.target.value)}
            >
              {dispatchFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label || '이름 없는 입력 항목'}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        {text('due_time', '업무 마감시간 (한국시간, 선택)', 'time')}
        <section className="designer-fields">
          <h3>작성할 입력 항목</h3>
          {draft.fields.map((field, index) => {
            function patch(value: Partial<typeof field>) {
              change(
                'fields',
                draft.fields.map((f, i) =>
                  i === index ? { ...f, ...value } : f,
                ),
              );
            }
            return (
              <fieldset key={field.key} className="designer-field">
                <legend>입력 항목</legend>
                <PortalField>
                  항목 이름
                  <PortalInput
                    name="label"
                    required
                    disabled={busy}
                    value={field.label}
                    onValue={(mentionValue) => patch({ label: mentionValue })}
                  />
                </PortalField>
                <label>
                  입력 방식
                  <select
                    disabled={busy}
                    value={field.control}
                    onChange={(e) => patch({ control: e.target.value })}
                  >
                    {Object.entries({
                      text: '짧은 글',
                      textarea: '긴 글',
                      number: '숫자',
                      checkbox: '체크 여부',
                      date: '날짜',
                      select: '선택 목록',
                    }).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <PortalField hidden={field.control !== 'select'}>
                  선택지 (한 줄에 하나)
                  <PortalInput
                    name="options"
                    required={field.control === 'select'}
                    disabled={busy}
                    value={field.options_text}
                    onValue={(mentionValue) =>
                      patch({ options_text: mentionValue })
                    }
                    multiline
                  />
                </PortalField>
                <label>
                  완료할 때 필수 입력
                  <input
                    type="checkbox"
                    name="required"
                    disabled={busy}
                    checked={field.required_on_complete === true}
                    onChange={(e) =>
                      patch({ required_on_complete: e.target.checked })
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    change(
                      'fields',
                      draft.fields.filter((_, i) => i !== index),
                    )
                  }
                >
                  항목 삭제
                </button>
              </fieldset>
            );
          })}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              change('fields', [
                ...draft.fields,
                {
                  key: 'f_' + crypto.randomUUID().replaceAll('-', ''),
                  label: '',
                  type: 'string',
                  control: 'text',
                  options_text: '',
                },
              ])
            }
          >
            입력 항목 추가
          </button>
        </section>
        {text('steps', '처리 단계 (선택, 한 줄에 하나)', 'textarea')}
        {text('completion', '완료 전 확인 내용 (선택)', 'textarea')}
        <p>
          저장하면 이 센터 업무 화면에 버튼이 생깁니다. 양식을 수정해도 이미
          발행한 티켓의 입력 항목과 기록은 유지됩니다.
        </p>
        <button className="primary" disabled={busy}>
          저장하고 업무 버튼 생성
        </button>
        {error ? (
          <p className="designer-error error">
            <MentionText>{error}</MentionText>
          </p>
        ) : null}
      </form>
    </PortalDialog>
  );
}
