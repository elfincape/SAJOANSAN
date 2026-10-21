import { useEffect, useState } from 'react';
import type { PortalMember } from '../../domain/portal-types';
import { memberRoleLabels } from '../../domain/portal-permissions';
import { usePortal } from './PortalStore';
import { portalApi } from '../../lib/portal';
import { PortalPermissionPreview } from './PortalPermissionPreview';
function MemberEditor({ person }: { person: PortalMember }) {
  const { state, profile, centerName, mutate } = usePortal(),
    [name, setName] = useState(person.display_name ?? ''),
    [role, setRole] = useState(person.role),
    [centers, setCenters] = useState(person.centers),
    draft = { ...person, role, centers },
    guidance =
      role === 'admin'
        ? '관리자는 페이지 조건과 관계없이 모든 센터에 접근합니다. 센터 선택은 관리자 권한을 제한하지 않습니다.'
        : role === 'viewer'
          ? '조회 전용은 허용된 페이지를 열람합니다. 담당 센터는 본인 센터 자료 조건에 사용됩니다. 특이사항 처리 상태·알림 확인은 별도 페이지 조건을 따릅니다.'
          : centers.length
            ? '담당 센터의 업무를 페이지 수정 조건 안에서 처리할 수 있습니다. 담당 밖 자료는 열람 조건에 따라 표시됩니다.'
            : '담당 센터가 없어 센터 업무·기초자료를 수정할 수 없습니다. 센터를 선택하세요.';
  return (
    <>
      <h2>{person.name} · 역할·센터 설정</h2>
      <p>
        {person.active
          ? '활성 계정'
          : '비활성 계정 · 설정을 저장해도 활성화 전에는 접근할 수 없습니다.'}
      </p>
      <form
        className="portal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = { name, role, centers: [...centers].sort() },
            saved = await mutate(
              JSON.stringify(['member', person.id, data]),
              (requestId) =>
                portalApi.updateMember({ requestId, person, ...data }),
              () => {},
            );
          if (saved && person.id === profile.id) location.reload();
        }}
      >
        <label>
          표시이름
          <input
            name="name"
            required
            maxLength={100}
            value={name}
            disabled={state.busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>사용자 역할</legend>
          {Object.entries(memberRoleLabels).map(([value, label]) => (
            <label key={value} className="member-choice">
              <input
                type="radio"
                name="role"
                value={value}
                checked={role === value}
                disabled={state.busy}
                onChange={() => setRole(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>담당 센터 · 여러 센터 선택 가능</legend>
          {state.context?.centers.map((c) => (
            <label key={c.code} className="member-choice">
              {centerName(c.code)}
              <input
                type="checkbox"
                name={'center_' + c.code}
                checked={centers.includes(c.code)}
                disabled={state.busy || role === 'admin'}
                onChange={(e) =>
                  setCenters((s) =>
                    e.target.checked
                      ? [...s, c.code].sort()
                      : s.filter((code) => code !== c.code),
                  )
                }
              />
            </label>
          ))}
        </fieldset>
        <p>{guidance}</p>
        <button className="primary" disabled={state.busy}>
          역할·담당 센터 저장
        </button>
      </form>
      <a href="/portal/?view=permissions">페이지별 허용 조건 설정</a>
      <section className="permission-simulation">
        <PortalPermissionPreview
          rules={state.permissions.rules}
          person={draft}
        />
      </section>
    </>
  );
}
export function PortalMembers() {
  const { state, centerName, viewState } = usePortal(),
    [selected, setSelected] = useState(() =>
      String(
        viewState.get('memberId') ??
          new URLSearchParams(location.search).get('user') ??
          '',
      ),
    ),
    [serial, setSerial] = useState(0),
    [search, setSearch] = useState(''),
    person = state.members.find((p) => p.id === selected),
    members = state.members.filter((p) =>
      [p.name, p.email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    );
  useEffect(() => setSearch(''), [state.members]);
  return (
    <>
      <section id="quick-actions" className="quick-actions" />
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">사용자 권한·센터</strong>
            <span id="count">{state.members.length}명</span>
          </div>
          <div id="items" className="portal-items">
            <p>
              역할은 가능한 업무 수준, 담당 센터는 자료 수정 범위를 정합니다.
              페이지 권한 조건을 만족해야 해당 업무에 접근할 수 있습니다.
            </p>
            <label>
              사용자 검색
              <input
                name="member_search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div>
              {members.map((p) => (
                <button
                  key={p.id}
                  className="task-row member-row"
                  data-member-id={p.id}
                  aria-pressed={p.id === selected}
                  disabled={state.busy}
                  onClick={() => {
                    setSelected(p.id);
                    viewState.set('memberId', p.id);
                    setSerial((s) => s + 1);
                  }}
                >
                  <strong>{p.name}</strong>
                  <small>
                    {memberRoleLabels[p.role] ?? p.role}
                    {p.active ? '' : ' · 비활성'}
                  </small>
                  <small>
                    {p.role === 'admin'
                      ? '전체 센터 관리'
                      : p.centers.map(centerName).join(', ') ||
                        '담당 센터 없음'}
                  </small>
                </button>
              ))}
              {!members.length ? <p>일치하는 사용자가 없습니다.</p> : null}
            </div>
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {person ? (
            <MemberEditor
              key={person.id + JSON.stringify(person) + serial}
              person={person}
            />
          ) : (
            <p>
              사용자를 선택하면 역할·담당 센터와 적용될 페이지 권한을 함께
              확인할 수 있습니다.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
