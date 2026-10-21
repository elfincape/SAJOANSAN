import { PortalInput, PortalField, MentionText } from './PortalMentions';
import { useRef, useState } from 'react';
import type { PortalIncident } from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
import { portalApi } from '../../lib/portal';
import { usePortal } from './PortalStore';
import { PortalTaskRow } from './PortalTaskList';
import { PortalRecordHistory } from './PortalHistory';
import { PortalFiles } from './PortalFiles';
export function PortalIncidentList() {
  const { state, choose, centerName, update } = usePortal(),
    rows = [...state.incidents].sort(
      (a, b) =>
        Number(a.status === 'resolved') - Number(b.status === 'resolved') ||
        b.created_at.localeCompare(a.created_at) ||
        a.id.localeCompare(b.id),
    );
  return (
    <>
      {rows.map((row) => (
        <div key={row.id} className="incident-record">
          <PortalTaskRow
            row={{
              ...row,
              center_code:
                state.parents.find((t) => t.id === row.task_id)?.center_code ??
                row.center_code,
            }}
            type="incident"
            centerName={centerName}
            onChoose={() => choose({ type: 'incident', row })}
            extra={
              row.kind +
              ' · 발생 ' +
              portalStamp(row.created_at) +
              (row.resolved_at
                ? ' · 처리완료 ' + portalStamp(row.resolved_at)
                : '')
            }
          />
          {row.task_id ? (
            <button
              className="parent-mention"
              disabled={state.busy}
              onClick={() =>
                update((s) => {
                  s.parentTaskId = row.task_id;
                })
              }
            >
              ↳ 상위 업무 ·{' '}
              {state.parents.find((t) => t.id === row.task_id)?.title ??
                state.tasks.find((t) => t.id === row.task_id)?.title ??
                '상위 업무 확인'}
            </button>
          ) : null}
        </div>
      ))}
    </>
  );
}
export function PortalIncidentDetail({ row }: { row: PortalIncident }) {
  const { state, centerName, canWrite, allowed, mutate, update } = usePortal(),
    [title, setTitle] = useState(row.title),
    [note, setNote] = useState(String(row.inputs?.발생내용 ?? '')),
    [progress, setProgress] = useState(String(row.inputs?.처리내용 ?? '')),
    [support, setSupport] = useState(''),
    form = useRef<HTMLFormElement>(null),
    writable = canWrite(row.center_code, 'incidents'),
    editable = allowed('incidents', 'edit', row.center_code),
    center =
      state.parents.find((t) => t.id === row.task_id)?.center_code ??
      row.center_code;
  function action(action: string, data: Record<string, unknown> = {}) {
    void mutate(
      JSON.stringify([row.id, row.version, action, data]),
      (requestId) =>
        portalApi.incidentAction({ requestId, incident: row, action, data }),
    );
  }
  return (
    <>
      <h2>
        <MentionText>{row.title}</MentionText>
      </h2>
      <p>
        <MentionText>
          {centerName(center) +
            ' · ' +
            row.kind +
            ' · ' +
            (row.status === 'resolved' ? '처리완료' : '처리중')}
        </MentionText>
      </p>
      <p>
        발생 <MentionText>{portalStamp(row.created_at)}</MentionText>
        <MentionText>
          {row.resolved_at ? ' · 처리완료 ' + portalStamp(row.resolved_at) : ''}
        </MentionText>
      </p>
      {row.task_id ? (
        <button
          className="parent-mention"
          disabled={state.busy}
          onClick={() =>
            update((s) => {
              s.parentTaskId = row.task_id;
            })
          }
        >
          상위 업무 ·{' '}
          {state.parents.find((t) => t.id === row.task_id)?.title ??
            state.tasks.find((t) => t.id === row.task_id)?.title ??
            '상위 업무 확인'}
        </button>
      ) : null}
      {row.status === 'open' && writable ? (
        <form
          ref={form}
          className="portal-form"
          onSubmit={(e) => e.preventDefault()}
        >
          <PortalField>
            특이사항 제목
            <PortalInput
              name="title"
              required
              disabled={state.busy}
              value={title}
              onValue={(mentionValue) => setTitle(mentionValue)}
            />
          </PortalField>
          <PortalField>
            발생 내용
            <PortalInput
              name="note"
              required
              disabled={state.busy}
              value={note}
              onValue={(mentionValue) => setNote(mentionValue)}
              multiline
            />
          </PortalField>
          <PortalField>
            처리 내용
            <PortalInput
              name="progress"
              disabled={state.busy}
              value={progress}
              onValue={(mentionValue) => setProgress(mentionValue)}
              multiline
            />
          </PortalField>
          <div className="actions">
            <button
              type="button"
              disabled={state.busy}
              onClick={() => {
                if (form.current?.reportValidity())
                  action('edit', {
                    title,
                    inputs: {
                      ...row.inputs,
                      발생내용: note,
                      처리내용: progress,
                    },
                  });
              }}
            >
              내용 저장
            </button>
            <button
              type="button"
              className="primary"
              disabled={state.busy}
              onClick={() => {
                if (form.current?.reportValidity())
                  action('resolve', {
                    title,
                    inputs: {
                      ...row.inputs,
                      발생내용: note,
                      처리내용: progress,
                    },
                    note: progress,
                  });
              }}
            >
              처리완료
            </button>
          </div>
        </form>
      ) : (
        <>
          <h3>발생 내용</h3>
          <p>
            <MentionText>{String(row.inputs?.발생내용 ?? '')}</MentionText>
          </p>
          <h3>처리 내용</h3>
          <p>
            <MentionText>
              {String(row.inputs?.처리내용 ?? '처리 내용 기록 없음')}
            </MentionText>
          </p>
          {row.status === 'resolved' && editable ? (
            <button disabled={state.busy} onClick={() => action('reopen')}>
              다시 처리중으로 열기
            </button>
          ) : row.status === 'open' && editable ? (
            <form
              className="portal-form"
              onSubmit={(e) => {
                e.preventDefault();
                action('resolve', { note: progress });
              }}
            >
              <PortalField>
                처리 내용
                <PortalInput
                  name="note"
                  disabled={state.busy}
                  value={progress}
                  onValue={(mentionValue) => setProgress(mentionValue)}
                  multiline
                />
              </PortalField>
              <button className="primary" disabled={state.busy}>
                처리완료
              </button>
            </form>
          ) : null}
        </>
      )}
      {writable && row.status === 'open' ? (
        <button disabled={state.busy} onClick={() => action('request_support')}>
          배송팀 지원 요청
        </button>
      ) : null}
      {state.view === 'hq' && editable && row.status === 'open' ? (
        <form
          className="portal-form"
          onSubmit={(e) => {
            e.preventDefault();
            action('support', { note: support.trim(), done: false });
          }}
        >
          <PortalField>
            배송팀 조치 내용
            <PortalInput
              name="note"
              required
              disabled={state.busy}
              value={support}
              onValue={(mentionValue) => setSupport(mentionValue)}
              multiline
            />
          </PortalField>
          <button disabled={state.busy}>조치 기록</button>
        </form>
      ) : null}
      <PortalRecordHistory kind="incident" id={row.id} version={row.version} />
      <PortalFiles
        kind="incident"
        subjectId={row.id}
        center={row.center_code}
      />
    </>
  );
}
