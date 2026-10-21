import { PortalInput, PortalField, MentionText } from './PortalMentions';
import { useEffect, useRef, useState } from 'react';
import type { PortalTask, ParticipantSubject } from '../../domain/portal-types';
import { portalApi } from '../../lib/portal';
import { usePortal } from './PortalStore';
import { subjectLabel } from './PortalTaskList';
interface Data {
  handler: string | null;
  from: string | null;
  to: string | null;
  memo: string;
}
function SubjectChoice({
  name,
  title,
  choices,
  initial,
  onChange,
}: {
  name: string;
  title: string;
  choices: ParticipantSubject[];
  initial: string | null;
  onChange: (id: string | null) => void;
}) {
  const [kind, setKind] = useState(
      () => choices.find((s) => s.id === initial)?.kind ?? 'person',
    ),
    [value, setValue] = useState(initial),
    { centerName, state } = usePortal(),
    visible = choices.filter((s) => s.kind === kind && s.eligible);
  return (
    <fieldset>
      <legend>
        <MentionText>{title}</MentionText>
      </legend>
      <div className="view-buttons">
        {[
          ['person', '사람'],
          ['center', '센터'],
          ['role', '역할'],
        ].map(([key, text]) => (
          <button
            key={key}
            type="button"
            data-kind={key}
            aria-pressed={kind === key}
            disabled={state.busy}
            onClick={() => {
              if (kind !== key) {
                setValue(null);
                onChange(null);
              }
              setKind(key);
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="subject-options">
        {visible.length ? (
          visible.map((s) => (
            <label key={s.id} className="member-choice">
              <input
                type="radio"
                name={name}
                value={s.id}
                checked={value === s.id}
                disabled={state.busy}
                onChange={() => {
                  setValue(s.id);
                  onChange(s.id);
                }}
              />
              {subjectLabel(s, centerName)}
            </label>
          ))
        ) : (
          <p>선택할 수 있는 대상이 없습니다.</p>
        )}
      </div>
    </fieldset>
  );
}
export function PortalParticipants({
  task,
  writable,
  stash,
  onSave,
  requestEdit = 0,
}: {
  task: PortalTask;
  writable: boolean;
  stash: () => void;
  onSave: (data: Data) => void;
  requestEdit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { state, centerName } = usePortal(),
    [editing, setEditing] = useState(false),
    [handoff, setHandoff] = useState(false),
    [choices, setChoices] = useState<ParticipantSubject[] | null>(null),
    [error, setError] = useState(''),
    [data, setData] = useState<Data>({
      handler: null,
      from: null,
      to: null,
      memo: '',
    }),
    [serial, setSerial] = useState(0),
    section = useRef<HTMLDetailsElement>(null),
    options = state.participants;
  const person = (id: string | null | undefined) =>
      options.find((s) => s.user_id === id),
    subject = (id: string | null | undefined) =>
      options.find((s) => s.id === id),
    relations: [string, ParticipantSubject | undefined][] = [
      ['발행자', person(task.created_by)],
      ['처리 담당', subject(task.handler_subject_id) ?? person(task.owner_id)],
    ];
  if (task.completed_by)
    relations.push(['완료 처리자', person(task.completed_by)]);
  if (task.handoff_from_subject_id)
    relations.push(
      ['인계자', subject(task.handoff_from_subject_id)],
      ['인계받는 담당', subject(task.handoff_to_subject_id)],
      ['인계 기록자', person(task.handoff_actor_id)],
    );
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [task.id],
  );
  async function edit(handoff: boolean) {
    const run = ++generation.current;
    if (!writable) return;
    stash();
    setEditing(true);
    setHandoff(handoff);
    setChoices(null);
    setError('');
    setSerial((value) => value + 1);
    if (section.current) {
      setExpanded(true);
      section.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    try {
      const choices = await portalApi.participantOptions(task.center_code);
      if (run !== generation.current) return;
      setChoices(choices);
      const current =
        task.handler_subject_id ??
        choices.find((s) => s.user_id === task.owner_id)?.id ??
        null;
      setData({
        handler: handoff ? (task.handler_subject_id ?? null) : current,
        from: handoff ? current : null,
        to: null,
        memo: '',
      });
    } catch (error) {
      if (run !== generation.current) return;
      setError(
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error),
      );
    }
  }
  const lastRequest = useRef(0);
  useEffect(() => {
    if (requestEdit && requestEdit !== lastRequest.current) {
      lastRequest.current = requestEdit;
      void edit(!!(task.handler_subject_id || task.owner_id));
    }
  }, [requestEdit]);
  return (
    <details
      ref={section}
      className="task-participants"
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>업무 관계</summary>
      <dl>
        {relations.map(([name, value]) => (
          <span key={name} style={{ display: 'contents' }}>
            <dt>
              <MentionText>{name}</MentionText>
            </dt>
            <dd>
              <MentionText>{subjectLabel(value, centerName)}</MentionText>
            </dd>
          </span>
        ))}
      </dl>
      {writable ? (
        <div className="participant-actions">
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void edit(false)}
          >
            처리 담당 지정
          </button>
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void edit(true)}
          >
            인계
          </button>
        </div>
      ) : null}
      {editing ? (
        <form
          className="portal-form participant-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              (!data.handler && !data.to) ||
              (handoff && (!data.from || !data.to))
            ) {
              setError('대상을 선택하세요.');
              return;
            }
            onSave(data);
          }}
        >
          {!choices && !error ? <p>대상을 불러오는 중입니다…</p> : null}
          {choices ? (
            <>
              {handoff ? (
                <>
                  <SubjectChoice
                    key={'from' + serial}
                    name="from"
                    title="인계하는 담당"
                    choices={choices}
                    initial={data.from}
                    onChange={(from) => setData((s) => ({ ...s, from }))}
                  />
                  <SubjectChoice
                    key={'to' + serial}
                    name="to"
                    title="인계받는 담당"
                    choices={choices}
                    initial={data.to}
                    onChange={(to) => setData((s) => ({ ...s, to }))}
                  />
                  <PortalField>
                    인계 메모
                    <PortalInput
                      name="memo"
                      disabled={state.busy}
                      value={data.memo}
                      onValue={(mentionValue) =>
                        setData((s) => ({ ...s, memo: mentionValue }))
                      }
                      multiline
                    />
                  </PortalField>
                </>
              ) : (
                <SubjectChoice
                  key={'handler' + serial}
                  name="handler"
                  title="처리 담당"
                  choices={choices}
                  initial={data.handler}
                  onChange={(handler) => setData((s) => ({ ...s, handler }))}
                />
              )}
              <button className="primary" disabled={state.busy}>
                {handoff ? '인계 저장' : '처리 담당 저장'}
              </button>
            </>
          ) : null}
          {error ? (
            <p className="error">
              <MentionText>{error}</MentionText>
            </p>
          ) : null}
        </form>
      ) : null}
    </details>
  );
}
