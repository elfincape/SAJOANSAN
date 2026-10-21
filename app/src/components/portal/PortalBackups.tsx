import { MentionText } from './PortalMentions';
import { Fragment, useEffect, useRef, useState } from 'react';
import { usePortal } from './PortalStore';
import { portalStamp } from '../../domain/portal-types';
import { portalBackups } from '../../lib/portal-backups';
import type { PortalBackup, BackupComparison } from '../../lib/portal-backups';
import { useDownload } from '../useDownload';
const labels: Record<string, string> = {
    centers: '센터',
    companies: '운수사',
    drivers: '기사',
    vehicles: '차량',
    routes: '코스',
    delivery_points: '납품처',
    route_stops: '코스별 납품처',
  },
  actions: Record<string, string> = {
    added: '추가',
    removed: '삭제',
    changed: '변경',
  };
function BackupDetail({
  row,
  reload,
}: {
  row: PortalBackup;
  reload: () => Promise<void>;
}) {
  const { message } = usePortal(),
    [retrying, setRetrying] = useState(false),
    [comparing, setComparing] = useState(false),
    [comparison, setComparison] = useState<BackupComparison | null>(null),
    active = useRef(true),
    { download, downloadLink } = useDownload();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function error(error: unknown) {
    if (active.current)
      message(
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error),
        true,
      );
  }
  return (
    <>
      <h2>
        <MentionText>{row.file_name}</MentionText>
      </h2>
      <p>
        원본 보관 시각 ·<MentionText> </MentionText>
        <MentionText>{portalStamp(row.captured_at)}</MentionText>
      </p>
      {row.period === 'baseline' ? (
        <p>
          기능 적용 시점의 실제 운영 원본입니다. 월말 원본과 별도로
          보관했습니다.
        </p>
      ) : null}
      {Object.entries(row.counts).map(([key, count]) => (
        <p key={key}>
          <MentionText>{labels[key] ?? key}</MentionText> ·
          <MentionText> </MentionText>
          <MentionText>{count}</MentionText>건
        </p>
      ))}
      {row.last_error ? (
        <p className="error">
          <MentionText>{row.last_error}</MentionText>
        </p>
      ) : null}
      <p>
        저장 시도 · <MentionText>{row.attempts}</MentionText>회
        <MentionText>
          {row.verified_at
            ? ' · 검증 완료 ' + portalStamp(row.verified_at)
            : ' · DB 원본 보관, OneDrive 저장 대기'}
        </MentionText>
      </p>
      {row.status === 'saved' ? (
        <button
          className="primary"
          onClick={async () => {
            message('OneDrive 원본 내용을 확인하는 중입니다…');
            try {
              const blob = await portalBackups.download(row.id);
              if (active.current) {
                download(blob, row.file_name);
                message('다운로드를 시작했습니다.');
              }
            } catch (e) {
              error(e);
            }
          }}
        >
          원본 엑셀 다운로드
        </button>
      ) : (
        <button
          className="primary"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            message('보관된 원본을 저장하는 중입니다…');
            try {
              await portalBackups.retry(row.id);
              if (active.current) {
                await reload();
                message('원본 저장과 내용 검증을 완료했습니다.');
              }
            } catch (e) {
              error(e);
            } finally {
              setRetrying(false);
            }
          }}
        >
          같은 원본으로 OneDrive 저장 재시도
        </button>
      )}
      <section>
        {comparison ? (
          <>
            <h3>
              보관 이후 변경 · <MentionText>{comparison.total}</MentionText>건
            </h3>
            {comparison.counts.map((summary) => (
              <p key={summary.table_name}>
                <MentionText>
                  {labels[summary.table_name] ?? summary.table_name}
                </MentionText>
                <MentionText> </MentionText>· 추가<MentionText> </MentionText>
                <MentionText>{summary.added}</MentionText> · 삭제
                <MentionText> </MentionText>
                <MentionText>{summary.removed}</MentionText> · 변경
                <MentionText> </MentionText>
                <MentionText>{summary.changed}</MentionText>
              </p>
            ))}
            {comparison.items.map((item, i) => (
              <Fragment key={i}>
                <h4>
                  <MentionText>
                    {labels[item.table_name] ?? item.table_name}
                  </MentionText>
                  <MentionText> </MentionText>·{' '}
                  <MentionText>{item.title}</MentionText> ·
                  <MentionText> </MentionText>
                  <MentionText>{actions[item.action]}</MentionText>
                </h4>
                <p>
                  변경 항목 ·<MentionText> </MentionText>
                  <MentionText>{item.fields.join(', ')}</MentionText>
                </p>
              </Fragment>
            ))}
            {comparison.limited ? (
              <p>
                변경 기록 200건을 표시했습니다. 전체 원본은 엑셀에서 확인하세요.
              </p>
            ) : null}
            {!comparison.total ? (
              <p>보관 원본과 현재 운영정보가 같습니다.</p>
            ) : null}
          </>
        ) : null}
      </section>
      <button
        disabled={comparing}
        onClick={async () => {
          setComparing(true);
          message('변경 내용을 비교하는 중입니다…');
          try {
            const result = await portalBackups.compare(row.id);
            if (active.current) {
              setComparison(result);
              message('');
            }
          } catch (e) {
            error(e);
          } finally {
            setComparing(false);
          }
        }}
      >
        현재 운영정보와 비교
      </button>
      {downloadLink}
    </>
  );
}
export function PortalBackups() {
  const { state, message } = usePortal(),
    [rows, setRows] = useState<PortalBackup[] | null>(null),
    [selected, setSelected] = useState<PortalBackup | null>(null),
    generation = useRef(0);
  async function load() {
    const run = ++generation.current;
    try {
      const rows = await portalBackups.list();
      if (run !== generation.current) return;
      setRows(rows);
      setSelected(null);
    } catch (error) {
      if (run === generation.current)
        message(
          error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : String(error),
          true,
        );
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [state.refreshVersion]);
  return (
    <>
      <section id="quick-actions" className="quick-actions" />
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">보관된 운영 원본</strong>
            <span id="count">
              <MentionText>{rows ? rows.length + '건' : ''}</MentionText>
            </span>
          </div>
          <div id="items" className="portal-items">
            {rows ? (
              rows.length ? (
                rows.map((row) => (
                  <button
                    key={row.id}
                    className="task-row"
                    disabled={state.busy}
                    onClick={() => setSelected(row)}
                  >
                    {(row.period === 'baseline'
                      ? '현재 원본'
                      : row.period + ' 월말 원본') +
                      ' · ' +
                      (
                        {
                          saved: 'OneDrive 저장 완료',
                          pending: '저장 대기',
                          failed: '저장 실패',
                        } as Record<string, string>
                      )[row.status]}
                  </button>
                ))
              ) : (
                <p>아직 보관된 운영 원본이 없습니다.</p>
              )
            ) : (
              <p>보관 원본을 불러오는 중입니다…</p>
            )}
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {selected ? (
            <BackupDetail key={selected.id} row={selected} reload={load} />
          ) : (
            <>
              <h2>운영 원본 보관</h2>
              <p>
                매월 마지막 날 23:59 (한국시간)에 전체 운영 마스터를 보관합니다.
                OneDrive 저장이 실패하면 같은 원본으로 5분 간격으로
                재시도합니다.
              </p>
              <p>
                저장 위치: SAJOANSAN 업무자료 / 시스템 백업. 현재 원본은 월말
                원본과 구분합니다.
              </p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
