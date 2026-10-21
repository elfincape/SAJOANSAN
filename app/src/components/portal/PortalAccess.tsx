import { MentionText } from './PortalMentions';
import { useState } from 'react';
import { usePortal } from './PortalStore';
import { portalApi } from '../../lib/portal';
export function PortalAccess() {
  const { state, centerName, mutate } = usePortal(),
    [id, setId] = useState(''),
    person = state.staff.find((p) => p.id === id);
  return (
    <>
      <section id="quick-actions" className="quick-actions" />
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">활성 직원</strong>
            <span id="count">
              <MentionText>{state.staff.length}</MentionText>건
            </span>
          </div>
          <div id="items" className="portal-items">
            {state.staff.map((p) => (
              <button
                key={p.id}
                className="task-row"
                disabled={state.busy}
                onClick={() => setId(p.id)}
              >
                {p.name +
                  ' · ' +
                  (p.role === 'admin'
                    ? '배송팀 (모든 센터)'
                    : p.centers.map(centerName).join(', ') || '센터 미배정')}
              </button>
            ))}
            {!state.staff.length ? (
              <div className="portal-empty">
                <strong>표시할 항목이 없습니다.</strong>
                <p>등록된 항목이 있으면 여기에 표시됩니다.</p>
              </div>
            ) : null}
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {person ? (
            <>
              <h2>
                <MentionText>{person.name}</MentionText>
              </h2>
              {person.role === 'admin' ? (
                <p>배송팀은 모든 센터 업무를 처리할 수 있습니다.</p>
              ) : (
                <>
                  <p>
                    실제 소속 센터를 배정하세요. 다른 센터 자료는 조회할 수
                    있으며, 배정된 센터 업무만 수정할 수 있습니다.
                  </p>
                  <div className="portal-form">
                    {state.context?.centers.map((center) => {
                      const assigned = person.centers.includes(center.code);
                      return (
                        <div key={center.code} className="actions">
                          <span>
                            <MentionText>{center.name}</MentionText> ·
                            <MentionText> </MentionText>
                            <MentionText>
                              {assigned ? '배정됨' : '미배정'}
                            </MentionText>
                          </span>
                          <button
                            disabled={state.busy}
                            onClick={() =>
                              void mutate(
                                JSON.stringify([
                                  'membership',
                                  person.id,
                                  center.code,
                                  assigned,
                                ]),
                                (requestId) =>
                                  portalApi.setMembership({
                                    requestId,
                                    userId: person.id,
                                    center: center.code,
                                    expected: assigned,
                                    enabled: !assigned,
                                  }),
                              )
                            }
                          >
                            {assigned ? '배정 해제' : '배정'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          ) : (
            <p>목록에서 항목을 선택하세요.</p>
          )}
        </aside>
      </div>
    </>
  );
}
