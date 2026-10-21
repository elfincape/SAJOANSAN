import { PortalInput, PortalField, MentionText } from './PortalMentions';
import { Fragment, useEffect, useState } from 'react';
import type { PortalSpec, PortalSurvey } from '../../domain/portal-types';
import { surveyFields, surveyStages } from '../../domain/portal-model';
import { designerLines } from '../../domain/portal-designer';
import { koreaDate } from '../../domain/operations';
import { portalApi } from '../../lib/portal';
import { portalAi } from '../../lib/portal-ai';
import type { PortalAiDraft } from '../../lib/portal-ai';
import { usePortal } from './PortalStore';
import { PortalSurveyForm } from './PortalSurveyForm';
import { PortalFiles } from './PortalFiles';
function TemplateReview({
  survey,
  draft = null,
}: {
  survey: PortalSurvey;
  draft?: PortalAiDraft | null;
}) {
  const { state, message, mutate } = usePortal(),
    [steps, setSteps] = useState(
      draft
        ? draft.steps.map((item) => item.label).join('\n')
        : (survey.details.sequence ?? ''),
    ),
    [fields, setFields] = useState(
      draft ? draft.fields.map((item) => item.label).join('\n') : '',
    ),
    [completion, setCompletion] = useState(
      draft?.completion?.text ?? survey.details.completion ?? '',
    ),
    [required, setRequired] = useState(false),
    [repeat, setRepeat] = useState('none'),
    [days, setDays] = useState<number[]>([]),
    [month, setMonth] = useState(''),
    [once, setOnce] = useState(koreaDate),
    [owner, setOwner] = useState(''),
    [people, setPeople] = useState<
      {
        id: string;
        name: string;
      }[]
    >([]),
    [due, setDue] = useState(''),
    [effective, setEffective] = useState(koreaDate);
  useEffect(() => {
    let active = true;
    void portalApi
      .people(survey.center_code)
      .then((rows) => {
        if (active) {
          setPeople(rows);
          setOwner((s) => s || rows[0]?.id || '');
        }
      })
      .catch((error) => {
        if (active) message(error?.message || String(error), true);
      });
    return () => {
      active = false;
    };
  }, [survey.center_code]);
  return (
    <form
      className="portal-form"
      data-template-review="true"
      onSubmit={(e) => {
        e.preventDefault();
        const rule: NonNullable<PortalSpec['repeat']> = { kind: repeat };
        if (repeat === 'weekdays') rule.days = days;
        if (repeat === 'monthly') rule.day = Number(month);
        if (repeat === 'once') rule.date = once;
        const spec: PortalSpec = {
          effective_from: effective,
          fields: designerLines(fields).map((label, index) => ({
            key: 'field_' + index,
            label,
            type: 'string',
            required_on_complete: required,
          })),
          steps: designerLines(steps).map((label, index) => ({
            key: 'step_' + index,
            label,
          })),
          repeat: rule,
        };
        if (completion.trim()) spec.completion_condition = completion.trim();
        if (repeat !== 'none') spec.owner_ids = [owner];
        if (due) spec.due_time = due;
        void mutate(
          JSON.stringify([
            'survey',
            survey.id,
            survey.version,
            'template',
            { spec },
          ]),
          (requestId) =>
            portalApi.surveyAction({
              requestId,
              survey,
              action: 'template',
              data: { spec },
            }),
        );
      }}
    >
      <h3>배송팀 양식 검토</h3>
      <PortalField>
        처리 단계 (한 줄에 하나)
        <PortalInput
          name="steps"
          value={steps}
          disabled={state.busy}
          onValue={(mentionValue) => setSteps(mentionValue)}
          multiline
        />
      </PortalField>
      <PortalField>
        필요한 입력 항목 (한 줄에 하나)
        <PortalInput
          name="fields"
          value={fields}
          disabled={state.busy}
          onValue={(mentionValue) => setFields(mentionValue)}
          multiline
        />
      </PortalField>
      <PortalField>
        완료 조건 (직접 확인)
        <PortalInput
          name="completion_condition"
          value={completion}
          disabled={state.busy}
          onValue={(mentionValue) => setCompletion(mentionValue)}
          multiline
        />
      </PortalField>
      <label>
        모든 입력 항목을 완료 시 필수로 지정
        <input
          name="required"
          type="checkbox"
          checked={required}
          disabled={state.busy}
          onChange={(e) => setRequired(e.target.checked)}
        />
      </label>
      <label>
        반복 주기
        <select
          name="repeat"
          value={repeat}
          disabled={state.busy}
          onChange={(e) => setRepeat(e.target.value)}
        >
          {Object.entries({
            none: '필요할 때 등록',
            daily: '매일',
            weekdays: '지정 요일',
            monthly: '매월',
            once: '지정 날짜 1회',
          }).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset hidden={repeat !== 'weekdays'}>
        <legend>반복 요일</legend>
        {['월', '화', '수', '목', '금', '토', '일'].map((label, i) => (
          <label key={label}>
            {label}
            <input
              type="checkbox"
              name={'day_' + (i + 1)}
              checked={days.includes(i + 1)}
              disabled={state.busy}
              onChange={(e) =>
                setDays((s) =>
                  e.target.checked
                    ? [...s, i + 1].sort((a, b) => a - b)
                    : s.filter((d) => d !== i + 1),
                )
              }
            />
          </label>
        ))}
      </fieldset>
      <label hidden={repeat !== 'monthly'}>
        매월 날짜
        <input
          name="month_day"
          type="number"
          min={1}
          max={31}
          value={month}
          disabled={state.busy}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      <label hidden={repeat !== 'once'}>
        실행 날짜
        <input
          name="once_date"
          type="date"
          value={once}
          disabled={state.busy}
          onChange={(e) => setOnce(e.target.value)}
        />
      </label>
      <label hidden={repeat === 'none'}>
        반복 업무 담당자
        <select
          name="owner"
          required={repeat !== 'none'}
          value={owner}
          disabled={state.busy}
          onChange={(e) => setOwner(e.target.value)}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        업무 마감 (한국시간, 선택)
        <input
          name="due_time"
          type="time"
          value={due}
          disabled={state.busy}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <label>
        적용 시작일
        <input
          name="effective_from"
          type="date"
          required
          value={effective}
          disabled={state.busy}
          onChange={(e) => setEffective(e.target.value)}
        />
      </label>
      <p>
        조사 내용을 확인한 뒤 승인하세요. 양식 승인은 구축 완료 기록과
        별개입니다.
      </p>
      <button className="primary" disabled={state.busy}>
        정식 업무 양식 승인
      </button>
    </form>
  );
}
export function PortalSurveyDetail({ survey }: { survey: PortalSurvey }) {
  const { state, profile, centerName, canWrite, mutate, message, update } =
      usePortal(),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<PortalAiDraft | null>(null),
    [review, setReview] = useState<PortalAiDraft | null | undefined>(undefined),
    hq = state.view === 'hq',
    stages = Object.keys(surveyStages),
    next = stages[stages.indexOf(survey.stage) + 1],
    canDraft =
      profile.active === true &&
      profile.role === 'admin' &&
      String(profile.email ?? '')
        .trim()
        .toLowerCase() === 'elfincape@gmail.com';
  if (editing) return <PortalSurveyForm survey={survey} />;
  return (
    <>
      <h2>
        <MentionText>{survey.title}</MentionText>
      </h2>
      <p>
        <MentionText>{centerName(survey.center_code)}</MentionText> ·
        <MentionText> </MentionText>
        <MentionText>{surveyStages[survey.stage]}</MentionText>
      </p>
      <dl>
        {surveyFields
          .filter(([key]) => survey.details[key])
          .map(([key, label]) => (
            <Fragment key={key}>
              <dt>
                <MentionText>{label}</MentionText>
              </dt>
              <dd>
                <MentionText>{survey.details[key]}</MentionText>
              </dd>
            </Fragment>
          ))}
      </dl>
      {canWrite(survey.center_code, 'forms') && !survey.template_id ? (
        <button disabled={state.busy} onClick={() => setEditing(true)}>
          조사 수정
        </button>
      ) : null}
      {canDraft ? (
        <button
          disabled={state.busy}
          onClick={async () => {
            if (state.busy) return;
            update((s) => {
              s.busy = true;
            });
            message('조사 원문으로 배송팀 검토 초안을 만드는 중입니다…');
            try {
              const result = await portalAi.draft(survey.id);
              if (result.pending) {
                message(result.message ?? '');
                return;
              }
              setDraft(result);
              message(
                'AI 검토 초안을 표시했습니다. 업무 양식은 아직 변경하지 않았습니다.',
              );
            } catch (error) {
              message(
                error && typeof error === 'object' && 'message' in error
                  ? String(error.message)
                  : String(error),
                true,
              );
            } finally {
              update((s) => {
                s.busy = false;
              });
            }
          }}
        >
          AI 양식 초안 생성
        </button>
      ) : null}
      {hq && next ? (
        <button
          disabled={state.busy}
          onClick={() =>
            void mutate(
              JSON.stringify([
                'survey',
                survey.id,
                survey.version,
                'stage',
                { stage: next },
              ]),
              (requestId) =>
                portalApi.surveyAction({
                  requestId,
                  survey,
                  action: 'stage',
                  data: { stage: next },
                }),
            )
          }
        >
          {surveyStages[next]} 기록
        </button>
      ) : null}
      {(hq && survey.stage === 'designed' && !survey.template_id) ||
      review !== undefined ? (
        <TemplateReview
          key={review ? JSON.stringify(review) : 'default'}
          survey={survey}
          draft={review ?? null}
        />
      ) : null}
      {survey.template_id ? (
        <p>
          승인 양식이 연결되었습니다. 구축·운영 검증 단계는 실제 확인 후
          기록하세요.
        </p>
      ) : null}
      {draft ? (
        <section data-ai-draft="true">
          <h3>AI 검토 초안</h3>
          <p>조사 원문 근거를 확인하고 수정한 뒤 승인하세요.</p>
          {!draft.fresh || draft.survey_version !== survey.version ? (
            <p className="warning">
              이전 조사 버전의 초안입니다. 수정된 조사 내용을 먼저 확인하세요.
            </p>
          ) : null}
          {[
            ['steps', '체크리스트'],
            ['fields', '입력 항목'],
            ['automation', '개선 제안'],
          ].map(([key, label]) => (
            <Fragment key={key}>
              <h4>
                <MentionText>{label}</MentionText>
              </h4>
              {draft[key as 'steps' | 'fields' | 'automation'].map(
                (item, i) => (
                  <Fragment key={i}>
                    <p>
                      <MentionText>{item.label ?? item.text}</MentionText>
                    </p>
                    <small>
                      근거 · <MentionText>{item.evidence}</MentionText>
                    </small>
                  </Fragment>
                ),
              )}
            </Fragment>
          ))}
          {[
            ['completion', '완료 조건 제안'],
            ['repeat', '반복 규칙 제안'],
          ].map(([key, label]) => {
            const item = draft[key as 'completion' | 'repeat'];
            return item ? (
              <Fragment key={key}>
                <h4>
                  <MentionText>{label}</MentionText>
                </h4>
                <p>
                  <MentionText>{item.text}</MentionText>
                </p>
                <small>
                  근거 · <MentionText>{item.evidence}</MentionText>
                </small>
              </Fragment>
            ) : null;
          })}
          {draft.questions.length ? (
            <>
              <h4>추가 확인할 내용</h4>
              {draft.questions.map((q, i) => (
                <p key={i}>
                  <MentionText>{q}</MentionText>
                </p>
              ))}
            </>
          ) : null}
          {survey.stage === 'designed' &&
          !survey.template_id &&
          draft.survey_version === survey.version ? (
            <button disabled={state.busy} onClick={() => setReview(draft)}>
              초안을 배송팀 검토 양식에 옮기기
            </button>
          ) : null}
        </section>
      ) : null}
      <section className="survey-files">
        <h3>사용하는 파일</h3>
        <PortalFiles
          kind="survey"
          subjectId={survey.id}
          center={survey.center_code}
        />
      </section>
    </>
  );
}
