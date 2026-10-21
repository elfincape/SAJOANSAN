import { Fragment, useRef, useState } from 'react';
import type { PortalSurvey } from '../../domain/portal-types';
import { surveyFields } from '../../domain/portal-model';
import { portalApi } from '../../lib/portal';
import { operationsFiles } from '../../lib/portal-files';
import { usePortal } from './PortalStore';
import { PortalFiles } from './PortalFiles';
import { FileArea } from '../FileArea';
export function PortalSurveyForm({
  survey = null,
}: {
  survey?: PortalSurvey | null;
}) {
  const { state, update, message, loadData } = usePortal(),
    [title, setTitle] = useState(survey?.title ?? ''),
    [details, setDetails] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        surveyFields.map(([key]) => [key, survey?.details?.[key] ?? '']),
      ),
    ),
    [files, setFiles] = useState<File[]>([]),
    [hint, setHint] = useState(''),
    saved = useRef(survey),
    retry = useRef<{ key: string; id: string } | null>(null),
    uploads = useRef(new Map<File, { id: string; saved: boolean }>()).current;
  async function save() {
    if (state.busy) return;
    if (files.some((file) => file.size < 1 || file.size > 10 * 1024 * 1024)) {
      message('첨부파일은 각각 10MB 이하로 선택해 주세요.', true);
      return;
    }
    const names = [
        survey?.details?.files,
        ...files.map((file) => file.name),
      ].filter(Boolean),
      data = {
        center_code: saved.current?.center_code ?? state.center,
        title,
        details: {
          ...details,
          ...(names.length ? { files: [...new Set(names)].join('\n') } : {}),
        },
      },
      key = JSON.stringify([saved.current?.id, saved.current?.version, data]);
    if (retry.current?.key !== key)
      retry.current = { key, id: crypto.randomUUID() };
    update((s) => {
      s.busy = true;
    });
    message('조사 내용과 첨부파일을 저장하는 중입니다…');
    let contentSaved = false;
    try {
      saved.current = await portalApi.surveyAction({
        requestId: retry.current.id,
        survey: saved.current,
        action: saved.current ? 'edit' : 'submit',
        data,
      });
      retry.current = null;
      contentSaved = true;
      for (const file of files) {
        let pending = uploads.get(file);
        if (!pending) {
          pending = { id: crypto.randomUUID(), saved: false };
          uploads.set(file, pending);
        }
        if (pending.saved) continue;
        setHint(file.name + ' 저장 중…');
        await operationsFiles.upload({
          kind: 'survey',
          subjectId: saved.current.id,
          requestId: pending.id,
          file,
        });
        pending.saved = true;
      }
      update((s) => {
        s.selected = { type: 'survey', row: saved.current! };
      });
      let refreshFailed = false;
      try {
        await loadData();
      } catch {
        refreshFailed = true;
      }
      message(
        '업무조사와 첨부파일을 저장했습니다.' +
          (refreshFailed ? ' 목록은 새로고침해 주세요.' : ''),
      );
    } catch (error) {
      setHint(
        contentSaved
          ? '조사 내용은 저장되었습니다. 선택한 파일을 유지했으니 다시 저장하면 남은 첨부파일을 이어서 올립니다.'
          : '입력과 선택한 파일을 유지했습니다.',
      );
      message(
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : '저장하지 못했습니다. 다시 시도해 주세요.',
        true,
      );
    } finally {
      update((s) => {
        s.busy = false;
      });
    }
  }
  return (
    <>
      <h2>{survey ? '업무조사 수정' : '업무조사 등록'}</h2>
      <form
        className="portal-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          업무명
          <input
            name="title"
            required
            value={title}
            disabled={state.busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {surveyFields.map(([key, label]) => (
          <Fragment key={key}>
            <label>
              {label}
              {key === 'sequence' || key === 'problems' ? (
                <textarea
                  name={key}
                  disabled={state.busy}
                  value={details[key]}
                  onChange={(e) =>
                    setDetails((s) => ({ ...s, [key]: e.target.value }))
                  }
                />
              ) : (
                <input
                  name={key}
                  disabled={state.busy}
                  value={details[key]}
                  onChange={(e) =>
                    setDetails((s) => ({ ...s, [key]: e.target.value }))
                  }
                />
              )}
            </label>
            {key === 'handoff' ? (
              <div className="survey-files">
                <FileArea
                  accept=".xlsx,.xls,.pdf,.docx,.doc,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"
                  disabled={state.busy}
                  onFiles={setFiles}
                >
                  <label>
                    사용하는 파일
                    <input
                      name="survey_attachments"
                      type="file"
                      multiple
                      accept=".xlsx,.xls,.pdf,.docx,.doc,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp"
                      disabled={state.busy}
                      onChange={(e) =>
                        setFiles(Array.from(e.target.files ?? []))
                      }
                    />
                  </label>
                </FileArea>
                {survey ? (
                  <PortalFiles
                    kind="survey"
                    subjectId={survey.id}
                    center={survey.center_code}
                    allowUpload={false}
                  />
                ) : null}
              </div>
            ) : null}
          </Fragment>
        ))}
        <p>{hint}</p>
        <button className="primary" disabled={state.busy}>
          조사 내용·첨부파일 저장
        </button>
      </form>
    </>
  );
}
