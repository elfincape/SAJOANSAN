import { useRef, useState } from 'react';
import { usePortal } from './PortalStore';
import { PortalDesigner } from './PortalDesigner';
import { PortalSurveyForm } from './PortalSurveyForm';
import { PortalRecordDetail } from './PortalRecordDetail';
import type { PortalTemplate, PortalSurvey } from '../../domain/portal-types';
import { currentTemplates, surveyStages } from '../../domain/portal-model';
import { taskScheduleLabel } from '../../domain/portal-calendar';
import { cadenceLabels } from './PortalTaskList';
import { portalApi } from '../../lib/portal';
export function PortalRegistration() {
  const { state, update, canWrite, centerName, mutate, choose } = usePortal(),
    [designer, setDesigner] = useState<{
      template: PortalTemplate | null;
    } | null>(null),
    [form, setForm] = useState<{ survey: PortalSurvey | null } | null>(null),
    tab = state.registrationTab === 'surveys' ? 'surveys' : 'templates',
    registered = currentTemplates(state.templates),
    writable = canWrite(state.center, 'forms'),
    tabs = useRef<(HTMLButtonElement | null)[]>([]),
    choices = [
      ['templates', '등록된 업무', registered.length],
      ['surveys', '업무조사', state.surveys.length],
    ] as const;
  function switchTab(index: number) {
    if (state.busy) return;
    update((s) => {
      s.registrationTab = choices[index][0];
      s.selected = null;
    });
    setForm(null);
    tabs.current[index]?.focus();
  }
  return (
    <>
      <section id="quick-actions" className="quick-actions">
        <div
          className="registration-tabs"
          role="tablist"
          aria-label="업무 등록과 조사 구분"
        >
          {choices.map(([value, title, count], index) => (
            <button
              ref={(el) => {
                tabs.current[index] = el;
              }}
              key={value}
              id={'registration-tab-' + value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              aria-controls="items"
              tabIndex={tab === value ? 0 : -1}
              disabled={state.busy}
              onClick={() => switchTab(index)}
              onKeyDown={(e) => {
                const target =
                  e.key === 'ArrowRight'
                    ? (index + 1) % 2
                    : e.key === 'ArrowLeft'
                      ? (index + 1) % 2
                      : e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? 1
                          : null;
                if (target !== null) {
                  e.preventDefault();
                  switchTab(target);
                }
              }}
            >
              {title} · {count}
            </button>
          ))}
        </div>
        {writable ? (
          <button
            className="primary"
            disabled={state.busy}
            onClick={() => {
              if (tab === 'templates') setDesigner({ template: null });
              else {
                update((s) => {
                  s.selected = null;
                });
                setForm({ survey: null });
              }
            }}
          >
            {tab === 'templates' ? '센터 업무등록' : '업무조사 등록'}
          </button>
        ) : null}
      </section>
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">
              {tab === 'templates' ? '등록된 업무' : '업무조사'}
            </strong>
            <span id="count">
              {tab === 'templates' ? registered.length : state.surveys.length}건
            </span>
          </div>
          <div
            id="items"
            className="portal-items"
            role="tabpanel"
            aria-labelledby={'registration-tab-' + tab}
          >
            {tab === 'templates' ? (
              <>
                {registered.map((t) => (
                  <div key={t.id} className="registered-task-row">
                    <div className="registered-task-info">
                      {writable ? (
                        <button
                          className="registered-task-title"
                          disabled={state.busy}
                          onClick={() => setDesigner({ template: t })}
                        >
                          {t.title}
                        </button>
                      ) : (
                        <strong className="registered-task-title">
                          {t.title}
                        </strong>
                      )}
                      <small>
                        {(cadenceLabels[t.spec.ui_cadence ?? ''] ??
                          '기존 업무') +
                          taskScheduleLabel(t) +
                          ' · 입력 ' +
                          (t.spec.fields?.length ?? 0) +
                          '개'}
                      </small>
                    </div>
                    <div className="registered-task-actions">
                      {writable ? (
                        <>
                          <button
                            className="registered-task-edit"
                            aria-label={t.title + ' 수정'}
                            disabled={state.busy}
                            onClick={() => setDesigner({ template: t })}
                          >
                            수정
                          </button>
                          <button
                            className="registered-task-delete"
                            aria-label={t.title + ' 삭제'}
                            disabled={state.busy}
                            onClick={() => {
                              if (
                                confirm(
                                  '등록 업무를 삭제할까요? 이미 발행한 티켓과 기록은 유지됩니다.',
                                )
                              )
                                void mutate('retire:' + t.id, (requestId) =>
                                  portalApi.retireCustom({
                                    requestId,
                                    template: t,
                                  }),
                                );
                            }}
                          >
                            삭제
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!registered.length ? <p>등록된 업무가 없습니다.</p> : null}
              </>
            ) : (
              <>
                {state.surveys.map((row) => (
                  <div key={row.id} className="survey-list-row">
                    <div className="survey-list-info">
                      <button
                        className={
                          'task-row' +
                          (state.selected?.row.id === row.id ? ' selected' : '')
                        }
                        disabled={state.busy}
                        onClick={() => {
                          setForm(null);
                          choose({ type: 'survey', row });
                        }}
                      >
                        <span className="task-row-copy">
                          <strong className="task-row-name">{row.title}</strong>
                          <small>{centerName(row.center_code)}</small>
                        </span>
                        <span className="badge status-other">
                          {surveyStages[row.stage]}
                        </span>
                      </button>
                    </div>
                    {writable ? (
                      <button
                        className="registered-task-delete"
                        aria-label={row.title + ' 업무조사 삭제'}
                        disabled={state.busy}
                        onClick={() => {
                          if (confirm('이 업무조사를 삭제할까요?'))
                            void mutate(
                              'survey-delete:' + row.id,
                              (requestId) =>
                                portalApi.deleteSurvey({
                                  requestId,
                                  survey: row,
                                }),
                              () => {
                                if (
                                  state.selected?.type === 'survey' &&
                                  state.selected.row.id === row.id
                                )
                                  update((s) => {
                                    s.selected = null;
                                  });
                              },
                            );
                        }}
                      >
                        삭제
                      </button>
                    ) : null}
                  </div>
                ))}
                {!state.surveys.length ? (
                  <p>등록된 업무조사가 없습니다.</p>
                ) : null}
              </>
            )}
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {state.selected ? (
            <PortalRecordDetail />
          ) : form ? (
            <PortalSurveyForm
              key={form.survey?.id ?? 'new'}
              survey={form.survey}
            />
          ) : (
            <p>목록에서 항목을 선택하세요.</p>
          )}
        </aside>
      </div>
      {designer ? (
        <PortalDesigner
          key={designer.template?.id ?? 'new'}
          template={designer.template}
          onClose={() => setDesigner(null)}
        />
      ) : null}
    </>
  );
}
