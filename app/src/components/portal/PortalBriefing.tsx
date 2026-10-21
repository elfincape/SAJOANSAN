import { MentionText } from './PortalMentions';
import { Fragment } from 'react';
import { usePortal } from './PortalStore';
import { PortalIncidentList } from './PortalIncidents';
import { PortalRecordDetail } from './PortalRecordDetail';
import { portalBriefing } from '../../lib/portal-ai';
import { portalRecord } from '../../lib/portal';
import { portalStamp } from '../../domain/portal-types';
import { actionLabels } from '../../domain/operations';
export function PortalBriefing() {
  const { state, update, message, loadData, choose } = usePortal(),
    entry = state.briefing,
    body = entry?.body;
  async function generate() {
    if (state.busy) return;
    update((s) => {
      s.busy = true;
    });
    message('실제 운영 기록으로 브리핑을 만드는 중입니다…');
    try {
      const result = await portalBriefing.generate(true),
        briefing = await portalBriefing.cached();
      update((s) => {
        s.briefing = briefing;
      });
      await loadData();
      message(
        result.pending
          ? (result.message ?? '')
          : result.cached
            ? '저장된 결과를 표시했습니다. 새 생성 요청은 1분 간격으로 처리합니다.'
            : '브리핑을 생성했습니다.',
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
  }
  async function open(kind: string, id: string) {
    try {
      if (kind === 'task')
        choose({ type: 'task', row: await portalRecord('task', id) });
      else
        choose({ type: 'incident', row: await portalRecord('incident', id) });
    } catch (error) {
      message(
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error),
        true,
      );
    }
  }
  return (
    <>
      <section id="quick-actions" className="quick-actions">
        <button
          className="primary"
          disabled={state.busy}
          onClick={() => void generate()}
        >
          브리핑 생성·새로고침
        </button>
      </section>
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">확인할 운영 기록</strong>
            <span id="count">
              특이사항<MentionText> </MentionText>
              <MentionText>
                {state.incidents.filter((i) => i.task_id).length}
              </MentionText>
              건 · AI 요약 <MentionText>{body?.items?.length ?? 0}</MentionText>
              건
            </span>
          </div>
          <div id="items" className="portal-items">
            <h3>센터 업무 특이사항 · 현재 상태</h3>
            <PortalIncidentList />
            {!body ? (
              <p>오늘 저장된 AI 요약이 없습니다.</p>
            ) : (
              <>
                {body.items?.map((item, index) => {
                  const current =
                    item.kind === 'incident'
                      ? state.incidents.find((i) => i.id === item.id)
                      : null;
                  return (
                    <div
                      key={item.kind + item.id + index}
                      className="history-entry"
                    >
                      <p>
                        <MentionText>
                          {item.title +
                            (current
                              ? ' · ' +
                                (current.status === 'resolved'
                                  ? '처리완료'
                                  : '처리중')
                              : '')}
                        </MentionText>
                      </p>
                      <small>
                        <MentionText>
                          {(body.centers.find((c) => c.code === item.center)
                            ?.name ??
                            item.center ??
                            '센터 확인 필요') +
                            ' · ' +
                            (item.reason_label ?? '운영 기록') +
                            (item.action
                              ? ' · ' +
                                (actionLabels[item.action] ?? item.action)
                              : '')}
                        </MentionText>
                      </small>
                      {['task', 'incident'].includes(item.kind) ? (
                        <button
                          disabled={state.busy}
                          onClick={() => void open(item.kind, item.id)}
                        >
                          {item.kind === 'task' ? '업무 열기' : '특이사항 열기'}
                        </button>
                      ) : (
                        <a
                          href={
                            '/admin/' +
                            (
                              {
                                drivers: 'drivers.html',
                                vehicles: 'vehicles.html',
                                routes: 'route-edit.html',
                              } as Record<string, string>
                            )[item.kind] +
                            '?id=' +
                            encodeURIComponent(item.id) +
                            (item.center
                              ? '&center=' + encodeURIComponent(item.center)
                              : '')
                          }
                        >
                          원본 운영정보 열기
                        </a>
                      )}
                    </div>
                  );
                })}
                {!body.items?.length ? (
                  <p>
                    브리핑에 포함할 업무·특이사항·전일 변경 기록이 없습니다.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {state.selected ? (
            <PortalRecordDetail />
          ) : (
            <>
              <h2>오늘의 운영 브리핑</h2>
              <p>
                매일 오전 08:00에 생성합니다. 각 항목에서 실제 업무 기록을
                확인하세요.
              </p>
              {entry?.last_error ? (
                <p className="error">
                  <MentionText>{entry.last_error}</MentionText>
                </p>
              ) : null}
              {entry?.dispatch_error ? (
                <p className="error">
                  <MentionText>{entry.dispatch_error}</MentionText>
                </p>
              ) : null}
              {entry?.status === 'running' ? (
                <p>새 브리핑을 생성 중입니다. 잠시 후 새로고침하세요.</p>
              ) : null}
              <p>
                특이사항 처리중·처리완료는 현재 원본 기준입니다. 아래 AI 요약은
                생성 시점 기준입니다.
              </p>
              {body ? (
                <>
                  <p>
                    기준일 <MentionText>{body.date}</MentionText> · 생성
                    <MentionText> </MentionText>
                    <MentionText>
                      {portalStamp(entry?.generated_at)}
                    </MentionText>
                  </p>
                  {Object.entries({
                    pending_tasks: '미완료 업무',
                    open_incidents: '생성 당시 처리중 특이사항',
                    yesterday_events: '전일 처리 기록',
                    master_changes: '전일 차량·기사·코스 변경',
                  }).map(([key, label]) => (
                    <Fragment key={key}>
                      <p>
                        <MentionText>{label}</MentionText> ·
                        <MentionText> </MentionText>
                        <MentionText>{body.counts?.[key] ?? 0}</MentionText>건
                      </p>
                    </Fragment>
                  ))}
                  {body.limited ? (
                    <p>
                      주요 기록 일부를 요약했습니다. 전체 내용은 센터 업무와
                      처리 기록에서 확인하세요.
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
