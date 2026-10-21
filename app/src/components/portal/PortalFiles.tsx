import { MentionText } from './PortalMentions';
import { useEffect, useRef, useState } from 'react';
import { usePortal } from './PortalStore';
import { operationsFiles } from '../../lib/portal-files';
import type { PortalFile } from '../../lib/portal-files';
import { portalStamp } from '../../domain/portal-types';
import { useDownload } from '../useDownload';
import { FileArea } from '../FileArea';
export function PortalFiles({
  kind,
  subjectId,
  center,
  allowUpload = true,
}: {
  kind: string;
  subjectId: string;
  center: string;
  allowUpload?: boolean;
}) {
  const { state, profile, canWrite, update, message } = usePortal(),
    [files, setFiles] = useState<PortalFile[]>([]),
    [error, setError] = useState(''),
    [hint, setHint] = useState(''),
    [selected, setSelected] = useState<File | null>(null),
    input = useRef<HTMLInputElement>(null),
    pending = useRef<{
      requestId: string;
      file: File | null;
      expectedRow?: PortalFile;
    } | null>(null),
    { download, downloadLink } = useDownload(),
    active = useRef(0);
  const writable =
      allowUpload &&
      canWrite(
        center,
        (
          { task: 'tasks', incident: 'incidents', survey: 'forms' } as Record<
            string,
            string
          >
        )[kind],
      ),
    accept = '.xlsx,.xls,.pdf,.docx,.doc,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp';
  async function load() {
    const generation = active.current;
    try {
      const files = await operationsFiles.list(kind, subjectId);
      if (active.current === generation) {
        setFiles(files);
        setError('');
      }
    } catch (error) {
      if (active.current === generation)
        setError(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    active.current++;
    void load();
    return () => {
      active.current++;
    };
  }, [kind, subjectId]);
  function choose(file: File) {
    setSelected(file);
    if (pending.current?.expectedRow) pending.current.file = file;
    else pending.current = null;
  }
  async function upload() {
    if (state.busy || !selected) return;
    const file = selected;
    if (file.size < 1 || file.size > 10 * 1024 * 1024) {
      message('10MB 이하의 파일을 선택해 주세요.', true);
      return;
    }
    if (
      !pending.current ||
      (!pending.current.expectedRow && pending.current.file !== file)
    )
      pending.current = { file, requestId: crypto.randomUUID() };
    const expected = pending.current.expectedRow;
    if (
      expected &&
      (file.name !== expected.original_name || file.size !== expected.byte_size)
    ) {
      message(
        '이전에 선택한 파일과 다릅니다. 같은 파일을 선택해 주세요.',
        true,
      );
      return;
    }
    update((s) => {
      s.busy = true;
    });
    message('파일을 저장하는 중입니다…');
    try {
      await operationsFiles.upload({
        kind,
        subjectId,
        requestId: pending.current.requestId,
        file,
      });
      pending.current = null;
      setSelected(null);
      if (input.current) input.current.value = '';
      setHint('');
      await load();
      message('파일을 저장했습니다.');
    } catch (error) {
      await load();
      message(
        error instanceof Error
          ? error.message
          : '첨부를 저장하지 못했습니다. 선택한 파일을 유지했습니다.',
        true,
      );
    } finally {
      update((s) => {
        s.busy = false;
      });
    }
  }
  return (
    <section className="attachments">
      <div>
        {error ? (
          <p className="error">
            <MentionText>{error}</MentionText>
          </p>
        ) : !files.length ? (
          <p>첨부된 파일이 없습니다.</p>
        ) : (
          files.map((file) => (
            <div key={file.id} className="history-entry">
              <p>
                <MentionText>{file.file_name}</MentionText>
              </p>
              <small>
                <MentionText>{file.original_name}</MentionText> ·
                <MentionText> </MentionText>
                <MentionText>{(file.byte_size / 1024).toFixed(1)}</MentionText>
                KB ·<MentionText> </MentionText>
                <MentionText>{portalStamp(file.created_at)}</MentionText>
              </small>
              {file.status === 'saved' ? (
                <button
                  type="button"
                  disabled={state.busy}
                  onClick={async () => {
                    if (state.busy) return;
                    update((s) => {
                      s.busy = true;
                    });
                    try {
                      download(
                        await operationsFiles.download(file.id),
                        file.file_name,
                      );
                      message('파일을 다운로드했습니다.');
                    } catch (error) {
                      message(
                        error instanceof Error ? error.message : String(error),
                        true,
                      );
                    } finally {
                      update((s) => {
                        s.busy = false;
                      });
                    }
                  }}
                >
                  다운로드
                </button>
              ) : (
                <>
                  <p>
                    <MentionText>
                      {file.status === 'failed'
                        ? '저장 실패 · ' +
                          (file.last_error ?? '다시 시도해 주세요.')
                        : '저장 확인 중'}
                    </MentionText>
                  </p>
                  {writable && file.uploaded_by === profile.id ? (
                    <button
                      type="button"
                      disabled={state.busy}
                      onClick={() => {
                        pending.current = {
                          requestId: file.request_id,
                          file: null,
                          expectedRow: file,
                        };
                        setSelected(null);
                        if (input.current) {
                          input.current.value = '';
                          input.current.focus();
                        }
                        setHint(
                          file.original_name + ' 파일을 다시 선택하세요.',
                        );
                      }}
                    >
                      같은 파일로 재시도
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ))
        )}
      </div>
      {writable ? (
        <FileArea
          accept={accept}
          disabled={state.busy}
          onFiles={(files) => {
            if (files[0]) choose(files[0]);
          }}
        >
          <form
            className="portal-form"
            onSubmit={(e) => {
              e.preventDefault();
              void upload();
            }}
          >
            <label>
              파일 선택
              <input
                ref={input}
                name="file"
                type="file"
                required={!selected}
                accept={accept}
                disabled={state.busy}
                onChange={(e) => {
                  if (e.target.files?.[0]) choose(e.target.files[0]);
                }}
              />
            </label>
            <p>
              <MentionText>{hint}</MentionText>
            </p>
            <button className="primary" disabled={state.busy}>
              파일 올리기
            </button>
          </form>
        </FileArea>
      ) : null}
      {downloadLink}
    </section>
  );
}
