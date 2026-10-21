import { useEffect, useRef, useState } from 'react';
import { PortalDialog } from './PortalDialog';
import { PortalIncidentDetail } from './PortalIncidents';
import { PortalTaskDetail } from './PortalTaskDetail';
import { usePortal } from './PortalStore';
import { portalApi, portalRecord } from '../../lib/portal';
import { koreaDate } from '../../domain/operations';
import { currentTemplates } from '../../domain/portal-model';
import {
  taskRunsOnDate,
  taskScheduleLabel,
} from '../../domain/portal-calendar';
import { cadenceLabels } from './PortalTaskList';
import type { PortalTask } from '../../domain/portal-types';
export const incidentKinds = [
  '차량 대차',
  '차량 섭외 지연',
  '납품처 문제',
  '기사 문제',
  '차량 문제',
  '기타 특이사항',
];
function TaskCreate({ issue = false }: { issue?: boolean }) {
  const { state, mutate, choose } = usePortal(),
    [date, setDate] = useState(koreaDate),
    [endDate, setEndDate] = useState(koreaDate),
    [title, setTitle] = useState(''),
    [note, setNote] = useState(''),
    form = useRef<HTMLFormElement>(null),
    templates = currentTemplates(state.templates);
  const periods = (
    <>
      <label>
        시작일
        <input
          type="date"
          name="date"
          value={date}
          required
          disabled={state.busy}
          onChange={(e) => {
            setDate(e.target.value);
            if (endDate < e.target.value) setEndDate(e.target.value);
          }}
        />
      </label>
      <label>
        종료일
        <input
          type="date"
          name="endDate"
          value={endDate}
          min={date}
          required
          disabled={state.busy}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </label>
    </>
  );
  return (
    <>
      <form
        ref={form}
        className="portal-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (issue) return;
          const data = {
            center: state.center,
            title,
            date,
            endDate,
            inputs: { work_note: note },
          };
          void mutate(
            JSON.stringify(['create', data]),
            (requestId) => portalApi.save({ requestId, ...data }),
            (row) => choose({ type: 'task', row }),
          );
        }}
      >
        {!issue ? (
          <label>
            업무명
            <input
              name="title"
              required
              maxLength={200}
              value={title}
              disabled={state.busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        ) : null}
        {periods}
        {!issue ? (
          <>
            <label>
              필요한 내용
              <textarea
                name="note"
                value={note}
                disabled={state.busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="primary" disabled={state.busy}>
              등록
            </button>
          </>
        ) : null}
      </form>
      {issue ? (
        <>
          <div className="issue-template-list">
            {templates.map((t) => {
              const runs = taskRunsOnDate(t, date);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="primary"
                  disabled={state.busy || !runs}
                  title={
                    runs
                      ? ''
                      : '설정한 실행 요일이 아닙니다. 시작일을 변경하세요.'
                  }
                  onClick={() => {
                    if (!form.current?.reportValidity()) return;
                    void mutate(
                      JSON.stringify(['template', t.id, date, endDate]),
                      (requestId) =>
                        portalApi.issuePeriod({
                          requestId,
                          templateId: t.id,
                          date,
                          endDate,
                        }),
                      (row) => choose({ type: 'task', row }),
                    );
                  }}
                >
                  {t.title +
                    ' · ' +
                    (cadenceLabels[t.spec.ui_cadence ?? ''] ?? '업무') +
                    taskScheduleLabel(t)}
                </button>
              );
            })}
          </div>
          {!templates.length ? (
            <p>업무 등록·조사에서 센터 업무 양식을 먼저 등록하세요.</p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
function IncidentCreate({ task }: { task: PortalTask }) {
  const { state, mutate, update } = usePortal(),
    [kind, setKind] = useState(incidentKinds[0]),
    [title, setTitle] = useState(''),
    [note, setNote] = useState('');
  return (
    <>
      <h2>특이사항 발생</h2>
      <p>상위 업무 · {task.title}</p>
      <form
        className="portal-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = {
            task_id: task.id,
            title,
            kind,
            inputs: { 발생내용: note },
          };
          void mutate(
            JSON.stringify(['incident', data]),
            (requestId) =>
              portalApi.incidentAction({ requestId, action: 'create', data }),
            (row) =>
              update((s) => {
                s.ticket = false;
                s.view = 'incidents';
                s.center = task.center_code;
                s.selected = { type: 'incident', row };
              }),
          );
        }}
      >
        <label>
          유형
          <select
            name="kind"
            value={kind}
            disabled={state.busy}
            onChange={(e) => setKind(e.target.value)}
          >
            {incidentKinds.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          제목
          <input
            name="title"
            required
            value={title}
            disabled={state.busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          발생 내용
          <textarea
            name="note"
            required
            value={note}
            disabled={state.busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button className="primary" disabled={state.busy}>
          처리중으로 등록
        </button>
      </form>
    </>
  );
}
function ParentTask({ id }: { id: string }) {
  const { update } = usePortal(),
    [task, setTask] = useState<PortalTask | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void portalRecord('task', id)
      .then((row) => {
        if (active) setTask(row);
      })
      .catch((error) => {
        if (active)
          setError(error?.message || '상위 업무를 불러오지 못했습니다.');
      });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <PortalDialog
      id="parent-task-dialog"
      label="상위 업무"
      onClose={() =>
        update((s) => {
          s.parentTaskId = null;
        })
      }
    >
      <div className="parent-dialog-heading">
        <strong>상위 업무</strong>
        <button
          type="button"
          onClick={() =>
            update((s) => {
              s.parentTaskId = null;
            })
          }
        >
          닫기
        </button>
      </div>
      <div id="parent-task-detail">
        {task ? (
          <PortalTaskDetail key={task.id} task={task} readOnly />
        ) : (
          <p>{error || '상위 업무를 불러오는 중입니다…'}</p>
        )}
      </div>
    </PortalDialog>
  );
}
export function PortalTickets() {
  const { state, update } = usePortal(),
    selected = state.selected,
    close = () =>
      update((s) => {
        s.ticket = false;
      });
  return (
    <>
      {state.ticket ? (
        <PortalDialog
          id="task-ticket-dialog"
          label="업무 티켓"
          className="task-ticket-dialog"
          onClose={close}
        >
          {state.ticketMode !== 'incident-create' ? (
            <div className="parent-dialog-heading">
              <strong>
                {state.ticketMode === 'create'
                  ? '일회성 업무등록'
                  : state.ticketMode === 'issue'
                    ? '업무 발행'
                    : '업무 티켓'}
              </strong>
              <button type="button" disabled={state.busy} onClick={close}>
                닫기
              </button>
            </div>
          ) : null}
          {state.ticketMode === 'create' || state.ticketMode === 'issue' ? (
            <TaskCreate
              key={state.ticketMode}
              issue={state.ticketMode === 'issue'}
            />
          ) : state.ticketMode === 'incident-create' && state.ticketParent ? (
            <IncidentCreate
              key={state.ticketParent.id}
              task={state.ticketParent}
            />
          ) : selected?.type === 'incident' ? (
            <div className="task-detail-content">
              <PortalIncidentDetail
                key={selected.row.id + ':' + selected.row.version}
                row={selected.row}
              />
            </div>
          ) : selected?.type === 'task' ? (
            <PortalTaskDetail key={selected.row.id} task={selected.row} popup />
          ) : null}
        </PortalDialog>
      ) : null}
      {state.parentTaskId ? (
        <ParentTask key={state.parentTaskId} id={state.parentTaskId} />
      ) : null}
    </>
  );
}
