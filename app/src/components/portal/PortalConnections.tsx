import { MentionText } from './PortalMentions';
import { useEffect, useState } from 'react';
import { usePortal } from './PortalStore';
import { operationsFiles } from '../../lib/portal-files';
import { connectOneDrive } from '../../lib/onedrive';
export function PortalConnections() {
  const { state, message } = usePortal(),
    [url, setUrl] = useState(''),
    [status, setStatus] = useState('');
  function error(error: unknown) {
    message(
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error),
      true,
    );
  }
  useEffect(() => {
    let active = true;
    void operationsFiles
      .settings()
      .then((result) => {
        if (active) {
          setUrl(result.folderUrl ?? '');
          setStatus(
            result.connected
              ? result.folderConfigured
                ? '계정 연결됨 · 저장 폴더 설정 완료'
                : '계정 연결됨 · 지정 폴더를 저장해 주세요.'
              : '계정 연결 필요',
          );
        }
      })
      .catch(error);
    return () => {
      active = false;
    };
  }, [state.refreshVersion]);
  return (
    <>
      <section id="quick-actions" className="quick-actions" />
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">저장소 관리</strong>
            <span id="count" />
          </div>
          <div id="items" className="portal-items" />
        </section>
        <aside id="detail" aria-label="업무 처리">
          <h2>업무자료 저장 폴더</h2>
          <form
            className="portal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await operationsFiles.configure(url);
                message('폴더 접근을 확인하고 저장했습니다.');
              } catch (e) {
                error(e);
              }
            }}
          >
            <label>
              저장 폴더 공유 링크
              <input
                type="url"
                name="url"
                required
                disabled={state.busy}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <button className="primary" disabled={state.busy}>
              폴더 설정 저장
            </button>
          </form>
          <button
            disabled={state.busy}
            onClick={async () => {
              try {
                const result = await operationsFiles.health();
                message(
                  result.rootAccessible
                    ? 'OneDrive 연결과 저장 폴더가 정상입니다.'
                    : '연결을 확인해 주세요.',
                );
              } catch (e) {
                error(e);
              }
            }}
          >
            OneDrive 연결 확인
          </button>
          <button
            disabled={state.busy}
            onClick={() => void connectOneDrive().catch(error)}
          >
            OneDrive 계정 연결
          </button>
          {status ? (
            <p>
              <MentionText>{status}</MentionText>
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
