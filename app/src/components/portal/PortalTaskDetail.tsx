import { PortalInput, PortalField, MentionText } from './PortalMentions';
import { useEffect, useRef, useState } from 'react';
import type { PortalTask, PortalInputs } from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
import { finished, collectPortalInputs } from '../../domain/portal-model';
import {
  taskState,
  taskStateLabels,
  taskPeriod,
  taskEnd,
} from '../../domain/portal-calendar';
import { statusLabels } from '../../domain/operations';
import { portalApi } from '../../lib/portal';
import { usePortal, PortalStore } from './PortalStore';
import { PortalCoupang } from './PortalCoupang';
import { PortalParticipants } from './PortalParticipants';
import { subjectLabel, PortalTaskRow } from './PortalTaskList';
import { PortalRecordHistory } from './PortalHistory';
import { PortalFiles } from './PortalFiles';
import { PortalVersionStatus } from './PortalVersionStatus';
import { PortalWorkflowReview } from './PortalWorkflowReview';
const text = (value: unknown) => String(value ?? '').replaceAll('HQ', '배송팀');
function localTime(value?: string | null) {
  if (!value) return '';
  return new Date(+new Date(value) + 9 * 3600000).toISOString().slice(0, 16);
}
export function PortalTaskDetail({
  task,
  readOnly = false,
  popup = false,
}: {
  task: PortalTask;
  readOnly?: boolean;
  popup?: boolean;
}) {
  const portal = usePortal();
  const [workflowBusy, setWorkflowBusy] = useState(false),
    busy = portal.state.busy || workflowBusy;
  const {
      state,
      taskDrafts,
      workflowRequests,
      update,
      message,
      mutate,
      choose,
      canWrite,
      allowed,
      centerName,
    } = portal,
    cached = taskDrafts.get(task.id),
    initial =
      !readOnly && cached?.version === task.version
        ? cached.inputs
        : task.inputs,
    [values, setValues] = useState<PortalInputs>(() =>
      structuredClone(initial ?? {}),
    ),
    [handlerRequest, setHandlerRequest] = useState(0),
    [deadline, setDeadline] = useState<{
      due: string;
      reason: string;
    } | null>(null),
    form = useRef<HTMLFormElement>(null),
    deadlineForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const draft = taskDrafts.get(task.id);
    setValues(
      structuredClone(
        !readOnly && draft?.version === task.version
          ? draft.inputs
          : (task.inputs ?? {}),
      ),
    );
    setDeadline(null);
  }, [task, readOnly]);
  const writable = !readOnly && canWrite(task.center_code),
    coupang =
      task.template_snapshot?.spec?.integration?.kind === 'coupang_entry',
    fields = (task.template_snapshot?.spec?.fields ?? []).filter(
      (f) =>
        !coupang ||
        f.key === task.template_snapshot?.spec?.integration?.dispatch_field,
    ),
    handler =
      state.participants.find((s) => s.id === task.handler_subject_id) ??
      state.participants.find((s) => s.user_id === task.owner_id),
    children = state.incidents.filter((i) => i.task_id === task.id),
    disabled = busy || finished(task) || !writable;
  function changeValues(change: (previous: PortalInputs) => PortalInputs) {
    const next = change(values);
    setValues(next);
    if (!readOnly && JSON.stringify(next) !== JSON.stringify(task.inputs ?? {}))
      taskDrafts.set(task.id, {
        version: task.version,
        inputs: structuredClone(next),
      });
    else taskDrafts.delete(task.id);
  }
  function collect() {
    const visible = Object.fromEntries(
      fields.map((f) => [
        f.key,
        values[f.key] ?? (f.type === 'boolean' ? false : ''),
      ]),
    );
    return collectPortalInputs(
      task,
      visible,
      coupang ? undefined : String(values.work_note ?? ''),
    );
  }
  function stash() {
    taskDrafts.set(task.id, { version: task.version, inputs: collect() });
  }
  function save(
    status: string,
    step?: {
      step: string;
      status: string;
    },
  ) {
    try {
      const inputs = collect();
      if (step) inputs.steps = { ...inputs.steps, [step.step]: step.status };
      const data = {
        task,
        center: task.center_code,
        title: task.title,
        date: task.work_date,
        endDate: taskEnd(task),
        inputs,
        status,
      };
      void mutate(
        JSON.stringify(['save', data]),
        (id) => portalApi.save({ requestId: id, ...data }),
        (row) => {
          if (
            row.status !== status ||
            (finished(row) && (!row.completed_at || !row.completed_by))
          )
            throw Error(
              '완료 저장 결과를 확인하지 못했습니다. 새로고침해 주세요.',
            );
          taskDrafts.delete(task.id);
          choose({ type: 'task', row });
        },
      );
    } catch (error) {
      message(error instanceof Error ? error.message : String(error), true);
    }
  }
  function trash(restore: boolean) {
    void mutate(
      JSON.stringify(['trash', task.id, task.version, restore]),
      (requestId) => portalApi.trashTask({ requestId, task, restore }),
      () => {
        taskDrafts.delete(task.id);
        update((s) => {
          s.selected = null;
          s.ticket = false;
        });
      },
    );
  }
  function changeDeadline() {
    if (!deadline) setDeadline({ due: localTime(task.due_at), reason: '' });
    requestAnimationFrame(() => {
      deadlineForm.current?.scrollIntoView({ block: 'nearest' });
      deadlineForm.current
        ?.querySelector<HTMLInputElement>('[name=due]')
        ?.focus();
    });
  }
  const dirty = !readOnly && taskDrafts.has(task.id);
  const nextStep = task.template_snapshot?.spec?.steps?.find(
    (item) =>
      !['completed', 'not_applicable'].includes(
        task.inputs?.steps?.[item.key] ?? '',
      ),
  );
  const entry = (
    <form
      ref={form}
      className="portal-form task-entry-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (writable && !finished(task)) save('in_progress');
      }}
    >
      <h3 className="task-input-heading">업무 입력</h3>
      <p
        className="editor-status"
        data-state={busy ? 'saving' : !disabled && dirty ? 'dirty' : 'ready'}
        role="status"
        aria-live="polite"
      >
        <span className="editor-status-dot" aria-hidden="true" />
        {busy
          ? '요청을 처리하고 있습니다.'
          : disabled
            ? '저장된 업무 내용을 보고 있습니다.'
            : dirty
              ? '변경 내용이 있습니다. 저장하거나 업무 완료로 반영하세요.'
              : '필요한 내용을 입력하고 저장하세요.'}
      </p>
      {writable && !finished(task) && dirty ? (
        <PortalWorkflowReview
          task={task}
          values={values}
          fields={fields}
          includeNote={!coupang}
        />
      ) : null}
      {fields.map((f) => (
        <PortalField key={f.key}>
          {f.label}
          {f.control === 'select' ? (
            <select
              name={'field_' + f.key}
              value={String(values[f.key] ?? '')}
              disabled={disabled}
              onChange={(e) =>
                changeValues((s) => ({ ...s, [f.key]: e.target.value }))
              }
            >
              <option value="">선택하세요</option>
              {f.options?.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          ) : f.type === 'boolean' ? (
            <input
              name={'field_' + f.key}
              type="checkbox"
              checked={values[f.key] === true}
              disabled={disabled}
              onChange={(e) =>
                changeValues((s) => ({ ...s, [f.key]: e.target.checked }))
              }
            />
          ) : f.control === 'textarea' ? (
            <PortalInput
              name={'field_' + f.key}
              value={String(values[f.key] ?? '')}
              disabled={disabled}
              onValue={(mentionValue) =>
                changeValues((s) => ({ ...s, [f.key]: mentionValue }))
              }
              multiline
            />
          ) : (
            <PortalInput
              name={'field_' + f.key}
              type={
                f.type === 'number'
                  ? 'number'
                  : f.control === 'date'
                    ? 'date'
                    : 'text'
              }
              step={f.type === 'number' ? 'any' : undefined}
              value={String(values[f.key] ?? '')}
              disabled={disabled}
              onValue={(mentionValue) =>
                changeValues((s) => ({ ...s, [f.key]: mentionValue }))
              }
            />
          )}
        </PortalField>
      ))}
      {!coupang ? (
        <PortalField>
          업무 내용
          <PortalInput
            name="work_note"
            value={String(values.work_note ?? '')}
            disabled={disabled}
            onValue={(mentionValue) =>
              changeValues((s) => ({ ...s, work_note: mentionValue }))
            }
            multiline
          />
        </PortalField>
      ) : null}
      {!coupang
        ? task.template_snapshot?.spec?.steps?.map((step) => {
            const status = task.inputs?.steps?.[step.key],
              done = status === 'completed' || status === 'not_applicable',
              actions =
                !finished(task) && writable ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        save(task.status, {
                          step: step.key,
                          status: 'completed',
                        })
                      }
                    >
                      처리 완료
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        save(task.status, {
                          step: step.key,
                          status: 'not_applicable',
                        })
                      }
                    >
                      해당 없음
                    </button>
                  </>
                ) : null;
            return done ? (
              <details key={step.key}>
                <summary>
                  <MentionText>{step.label}</MentionText> ·{' '}
                  <MentionText>{statusLabels[status || ''] ?? ''}</MentionText>
                </summary>
                {actions}
              </details>
            ) : (
              <fieldset key={step.key}>
                <legend>
                  <MentionText>{step.label}</MentionText> ·{' '}
                  <MentionText>{statusLabels[status || ''] ?? ''}</MentionText>
                </legend>
                {actions}
              </fieldset>
            );
          })
        : null}
    </form>
  );
  const relationships = (
    <PortalParticipants
      task={task}
      writable={writable && !finished(task)}
      requestEdit={handlerRequest}
      stash={stash}
      onSave={(data) =>
        void mutate(
          JSON.stringify(['participants', task.id, task.version, data]),
          (requestId) =>
            portalApi.setParticipants({ requestId, task, ...data }),
          (row) => {
            const draft = taskDrafts.get(task.id);
            if (draft)
              taskDrafts.set(task.id, { ...draft, version: row.version });
            choose({ type: 'task', row });
          },
        )
      }
    />
  );
  const body = task.deleted_at ? (
    <>
      <h2>
        <MentionText>{text(task.title)}</MentionText>
      </h2>
      <p>
        휴지통에 보관 중 ·<MentionText> </MentionText>
        <MentionText>{portalStamp(task.deleted_at)}</MentionText>
      </p>
      <p>
        <MentionText>{centerName(task.center_code)}</MentionText> ·
        <MentionText> </MentionText>
        <MentionText>{task.work_date}</MentionText>
      </p>
      <p>
        <MentionText>{text(task.inputs?.work_note)}</MentionText>
      </p>
      <dl>
        {task.template_snapshot?.spec?.fields?.map((f) => (
          <span key={f.key} style={{ display: 'contents' }}>
            <dt>
              <MentionText>{f.label}</MentionText>
            </dt>
            <dd>
              <MentionText>{String(task.inputs?.[f.key] ?? '')}</MentionText>
            </dd>
          </span>
        ))}
      </dl>
      {!readOnly &&
      canWrite(task.center_code, 'trash') &&
      canWrite(task.center_code) ? (
        <button className="primary" disabled={busy} onClick={() => trash(true)}>
          업무 복원
        </button>
      ) : null}
      <PortalRecordHistory kind="task" id={task.id} version={task.version} />
      {!coupang && !readOnly ? (
        <PortalFiles
          kind="task"
          subjectId={task.id}
          center={task.center_code}
        />
      ) : null}
      <PortalParticipants
        task={task}
        writable={false}
        stash={() => {}}
        onSave={() => {}}
      />
    </>
  ) : (
    <>
      <h2>
        <MentionText>{text(task.title)}</MentionText>
      </h2>
      <section className="task-detail-summary">
        <div className="task-summary-top">
          <span
            className="badge task-state-badge"
            data-task-state={taskState(task)}
          >
            <MentionText>
              {task.status === 'not_applicable'
                ? '해당 없음'
                : taskStateLabels[taskState(task)]}
            </MentionText>
          </span>
          {!readOnly &&
          canWrite(task.center_code, 'trash') &&
          canWrite(task.center_code) ? (
            <button
              className="trash-button"
              disabled={busy}
              onClick={() => trash(false)}
            >
              휴지통으로 이동
            </button>
          ) : null}
        </div>
        <dl className="task-detail-info">
          {[
            ['센터', centerName(task.center_code)],
            ['업무 기간', taskPeriod(task)],
            ['담당자', subjectLabel(handler, centerName)],
            ['마감', task.due_at ? portalStamp(task.due_at) : '미설정'],
          ].map(([label, value]) => (
            <span key={label} style={{ display: 'contents' }}>
              <dt>
                <MentionText>{label}</MentionText>
              </dt>
              <dd>
                <MentionText>{value}</MentionText>
              </dd>
            </span>
          ))}
        </dl>
      </section>
      <PortalVersionStatus
        task={task}
        dirty={dirty}
        busy={busy}
        readOnly={readOnly}
      />
      {!finished(task) && writable && !coupang ? (
        <p className="task-next-step">
          <strong>다음 할 일</strong>{' '}
          {nextStep ? (
            <MentionText>
              {nextStep.label + ' 단계를 처리한 뒤 업무 완료를 선택하세요.'}
            </MentionText>
          ) : dirty ? (
            '변경 내용을 확인하고 저장하세요. 모든 처리가 끝났다면 업무 완료를 선택하세요.'
          ) : (
            '업무 내용을 확인하세요. 처리가 끝났다면 업무 완료를 선택하세요.'
          )}
        </p>
      ) : null}
      {!coupang && task.template_snapshot?.spec?.external_process?.length ? (
        <details className="external-process">
          <summary>외부 업무 프로세스</summary>
          <ol>
            {task.template_snapshot.spec.external_process.map((step, i) => (
              <li key={i}>
                <MentionText>{text(step)}</MentionText>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {!coupang && task.template_snapshot?.spec?.completion_condition ? (
        <p>
          완료 전 확인 ·<MentionText> </MentionText>
          <MentionText>
            {text(task.template_snapshot.spec.completion_condition)}
          </MentionText>
        </p>
      ) : null}
      {!coupang && task.template_snapshot?.spec?.description ? (
        <p>
          <MentionText>
            {text(task.template_snapshot.spec.description)}
          </MentionText>
        </p>
      ) : null}
      {finished(task) ? (
        <p className="completion-confirmed">
          완료 확정 ·<MentionText> </MentionText>
          <MentionText>{portalStamp(task.completed_at)}</MentionText>
        </p>
      ) : null}
      {coupang ? (
        <PortalCoupang
          task={task}
          dispatch={String(
            values[
              task.template_snapshot?.spec?.integration?.dispatch_field ?? ''
            ] ?? '',
          )}
          writable={writable && !finished(task)}
          collect={collect}
          onBusy={setWorkflowBusy}
          persist={async (inputs) => {
            if (state.busy)
              throw Error('저장 중입니다. 잠시 후 다시 시도하세요.');
            const key = JSON.stringify([task.id, task.version, inputs]);
            let request = workflowRequests.get(task.id);
            if (request?.key !== key) {
              request = { key, id: crypto.randomUUID() };
              workflowRequests.set(task.id, request);
            }
            update((s) => {
              s.busy = true;
            });
            try {
              const row = await portalApi.save({
                requestId: request.id,
                task,
                center: task.center_code,
                title: task.title,
                date: task.work_date,
                endDate: taskEnd(task),
                inputs,
                status: 'in_progress',
              });
              if (row?.id !== task.id || !Number.isInteger(row.version))
                throw Error(
                  '업무 저장 결과를 확인하지 못했습니다. 다시 시도하세요.',
                );
              update((s) => {
                s.tasks = s.tasks.map((task) =>
                  task.id === row.id ? row : task,
                );
                if (s.selected?.row.id === task.id)
                  s.selected = { type: 'task', row };
              });
              taskDrafts.delete(task.id);
              workflowRequests.delete(task.id);
            } finally {
              update((s) => {
                s.busy = false;
              });
            }
          }}
        >
          {entry}
        </PortalCoupang>
      ) : (
        entry
      )}
      {writable && !finished(task) ? (
        <div
          className="task-secondary-actions"
          role="group"
          aria-label="추가 업무 처리"
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => setHandlerRequest((v) => v + 1)}
          >
            담당자 변경
          </button>
          <button type="button" disabled={busy} onClick={changeDeadline}>
            마감시간 변경
          </button>
          {!coupang ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save('not_applicable')}
            >
              해당 없음
            </button>
          ) : null}
          {allowed('incidents', 'edit', task.center_code) ? (
            <button
              type="button"
              className="task-exception"
              disabled={busy}
              onClick={() => {
                stash();
                update((s) => {
                  s.ticketMode = 'incident-create';
                  s.ticketParent = task;
                  s.ticket = true;
                });
              }}
            >
              특이사항 발생
            </button>
          ) : null}
        </div>
      ) : null}
      {children.length ? (
        <>
          <h3>이 업무의 특이사항</h3>
          {children.map((row) => (
            <PortalTaskRow
              key={row.id}
              row={row}
              type="incident"
              extra={portalStamp(row.created_at)}
              centerName={centerName}
              onChoose={choose}
            />
          ))}
        </>
      ) : null}
      <PortalRecordHistory kind="task" id={task.id} version={task.version} />
      {!coupang && !readOnly ? (
        <PortalFiles
          kind="task"
          subjectId={task.id}
          center={task.center_code}
        />
      ) : null}
      {deadline ? (
        <form
          ref={deadlineForm}
          className="portal-form task-deadline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = {
              due_at: deadline.due
                ? new Date(deadline.due + ':00+09:00').toISOString()
                : null,
              cj_share_due_at: task.cj_share_due_at ?? null,
              reason: deadline.reason,
            };
            void mutate(
              JSON.stringify(['deadline', task.id, task.version, data]),
              (requestId) =>
                portalApi.taskAction({
                  requestId,
                  task,
                  action: 'deadline',
                  data,
                }),
            );
          }}
        >
          <h3>마감시간 변경</h3>
          <label>
            업무 마감 (한국시간)
            <input
              name="due"
              type="datetime-local"
              disabled={busy}
              value={deadline.due}
              onChange={(e) =>
                setDeadline((s) => (s ? { ...s, due: e.target.value } : s))
              }
            />
          </label>
          <PortalField>
            기존 마감 변경 사유
            <PortalInput
              name="reason"
              disabled={busy}
              value={deadline.reason}
              onValue={(mentionValue) =>
                setDeadline((s) => (s ? { ...s, reason: mentionValue } : s))
              }
            />
          </PortalField>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              마감시간 저장
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDeadline(null)}
            >
              취소
            </button>
          </div>
        </form>
      ) : null}
      {relationships}
    </>
  );
  return (
    <PortalStore.Provider value={{ ...portal, state: { ...state, busy } }}>
      {popup ? <div className="task-detail-content">{body}</div> : body}
      {!task.deleted_at && writable ? (
        <div
          className="task-primary-actions"
          role="group"
          aria-label="업무 처리"
        >
          {finished(task) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void mutate(
                  'reopen:' + task.id + ':' + task.version,
                  (requestId) => portalApi.reopen({ requestId, task }),
                )
              }
            >
              업무 다시 열기
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => save('in_progress')}
              >
                저장
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => save('completed')}
              >
                업무 완료
              </button>
            </>
          )}
        </div>
      ) : null}
    </PortalStore.Provider>
  );
}
