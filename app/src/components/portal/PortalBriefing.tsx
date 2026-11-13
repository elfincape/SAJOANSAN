import { MentionText } from './PortalMentions';
import { Fragment, useEffect, useRef, useState } from 'react';
import { usePortal } from './PortalStore';
import { PortalIncidentList } from './PortalIncidents';
import { PortalRecordDetail } from './PortalRecordDetail';
import type { BriefingCache } from '../../lib/portal-ai';
import { koreaDate, statusLabels } from '../../domain/operations';
import { portalBriefing } from '../../lib/portal-ai';
import { portalRecord } from '../../lib/portal';
import { portalStamp } from '../../domain/portal-types';
import { actionLabels } from '../../domain/operations';
export function PortalBriefing() {
  const { state, update, message, loadData, choose, viewState } = usePortal(),
    today = koreaDate(),
    [day, setDay] = useState(() => String(viewState.get('briefing-date') || today)),
    [archive, setArchive] = useState<{ day: string; entry?: BriefingCache; error?: string } | null>(null),
    openRequest = useRef(0),
    generating = useRef(false),
    archived = day !== today,
    loading = archived && archive?.day !== day,
    error = archived && archive?.day === day ? archive.error : '',
    entry = archived ? (archive?.day === day ? archive.entry : undefined) : state.briefing,
    body = entry?.body;
  useEffect(() => {
    let active = true;
    openRequest.current++;
    if (archived) void portalBriefing.cached(day).then(entry => {
      if (active) setArchive({ day, entry });
    }).catch(error => {
      if (active) setArchive({ day, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; openRequest.current++; };
  }, [day, archived]);
  async function generate() {
    if (state.busy || generating.current || day !== koreaDate()) return;
    generating.current = true;
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
      generating.current = false;
      update((s) => {
        s.busy = false;
      });
    }
  }
  async function open(kind: string, id: string) {
    const request = ++openRequest.current;
    try {
      if (kind === 'task') {
        const row = await portalRecord('task', id);
        if (request === openRequest.current) choose({ type: 'task', row });
      } else {
        const row = await portalRecord('incident', id);
        if (request === openRequest.current) choose({ type: 'incident', row });
      }
    } catch (error) {
      if (request !== openRequest.current) return;
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
        <label>브리핑 기준일<input type="date" name="briefing-date" aria-label="브리핑 기준일" value={day} max={today} disabled={state.busy} onChange={event => {
          const next = event.target.value;
          if (!next || next > today) return;
          openRequest.current++;
          setDay(next); viewState.set('briefing-date', next);
        }}/></label>
        <button
          className="primary"
          disabled={state.busy || archived}
          onClick={() => void generate()}
        >
          브리핑 생성·새로고침
        </button>
      </section>
      <p role="status">{loading ? '저장된 브리핑을 불러오는 중…' : error || (archived ? '과거 보관본 조회 · 다시 생성하지 않습니다.' : '브리핑 생성은 업무를 완료하지 않습니다.')}</p>
      {body ? <p>보고 기준일 {body.date} · 생성 {portalStamp(entry?.generated_at)}</p> : null}
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
              <p>{loading || error ? '조회가 완료되면 보관 내용을 표시합니다.' : `${day}에 저장된 AI 요약이 없습니다.`}</p>
            ) : (
              <>
                {body.items?.map((item, index) => {
                  const current = (state.selected?.type === 'task' || state.selected?.type === 'incident') && state.selected.type === item.kind && state.selected.row.id === item.id
                    ? state.selected.row
                    : item.kind === 'task' ? state.tasks.find(task => task.id === item.id)
                    : item.kind === 'incident' ? state.incidents.find(incident => incident.id === item.id) : null;
                  return (
                    <div
                      key={item.kind + item.id + index}
                      className="history-entry"
                    >
                      <p>
                        <MentionText>
                          {item.title}
                        </MentionText>
                      </p>
                      {['task', 'incident'].includes(item.kind) ? <p>현재 원본 · <MentionText>{current ? current.title + ' · ' + (statusLabels[current.status] ?? current.status) : '상세에서 조회 필요'}</MentionText></p> : null}
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
              <h2>{archived ? '보관된 운영 브리핑' : '오늘의 운영 브리핑'}</h2>
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
                    pending_tasks: '생성 당시 미완료 업무',
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
