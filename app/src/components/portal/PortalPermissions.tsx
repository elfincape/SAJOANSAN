import { useEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { FEATURE_CATEGORIES } from '../../domain/feature-catalog';
import type {
  MemberPermission,
  MemberPermissionChange,
  PermissionConfig,
  PortalMember,
} from '../../domain/portal-types';
import { memberRoleLabels } from '../../domain/portal-permissions';
import {
  employeePermissionSummary,
  permissionCategory,
  permissionTitle,
} from '../../domain/employee-permissions';
import { usePortal } from './PortalStore';
import { useFeedback } from '../useFeedback';
import { portalApi } from '../../lib/portal';
import { registerWorkspaceNavigationGuard } from '../../lib/workspace-navigation';
import '../../styles/portal-permissions.css';

type EditSession = {
  person: PortalMember;
  rules: PermissionConfig[];
  drafts: Record<string, MemberPermission | null>;
};

function EmployeePermissions({
  person,
  onDirty,
}: {
  person: PortalMember;
  onDirty: (dirty: boolean) => void;
}) {
  const { state, mutate, centerName, viewState, refresh, update } = usePortal();
  const draftKey = `employee-permission-draft:${person.id}`;
  const [session, setSession] = useState<EditSession | null>(
    () => (viewState.get(draftKey) as EditSession | undefined) ?? null,
  );
  const [category, setCategory] = useState(() =>
    String(viewState.get('permissionCategory') ?? 'dispatch'),
  );
  const [search, setSearch] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const saving = useRef(false);
  const rules = state.permissions.rules;
  const drafts = session?.drafts ?? {};
  const changes: MemberPermissionChange[] = (session?.rules ?? rules)
    .filter((rule) => Object.hasOwn(drafts, rule.resource))
    .map((rule) => ({
      resource: rule.resource,
      version: rule.version,
      permission: drafts[rule.resource],
    }));
  const memberChanged =
    session &&
    JSON.stringify([
      session.person.display_name,
      session.person.role,
      [...session.person.centers].sort(),
    ]) !==
      JSON.stringify([
        person.display_name,
        person.role,
        [...person.centers].sort(),
      ]);
  const stale =
    !!memberChanged ||
    changes.some(
      (change) =>
        rules.find((rule) => rule.resource === change.resource)?.version !==
        change.version,
    );
  const categories = Object.entries(FEATURE_CATEGORIES).filter(([key]) =>
    rules.some((rule) => permissionCategory(rule) === key),
  );
  const selectedCategory = categories.some(([key]) => key === category)
    ? category
    : (categories[0]?.[0] ?? '');
  useEffect(() => {
    onDirty(changes.length > 0);
    if (session) viewState.set(draftKey, session);
    else viewState.delete(draftKey);
  }, [session, draftKey, viewState, changes.length, onDirty]);
  useEffect(() => {
    if (!changes.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changes.length]);
  function permissionFor(config: PermissionConfig) {
    return Object.hasOwn(drafts, config.resource)
      ? drafts[config.resource]
      : (config.member_overrides?.[person.id] ?? null);
  }
  function preview(config: PermissionConfig) {
    const base =
      session?.rules.find((rule) => rule.resource === config.resource) ??
      config;
    const member_overrides = { ...base.member_overrides };
    const permission = permissionFor(config);
    if (permission) member_overrides[person.id] = permission;
    else delete member_overrides[person.id];
    return employeePermissionSummary(
      { ...base, member_overrides },
      person,
      state.context?.centers ?? [],
      centerName,
    );
  }
  function change(
    config: PermissionConfig,
    permission: MemberPermission | null,
  ) {
    setSession((previous) => {
      const next = previous ?? {
        person: structuredClone(person),
        rules: structuredClone(rules),
        drafts: {},
      };
      const drafts = { ...next.drafts };
      const saved =
        next.rules.find((rule) => rule.resource === config.resource)
          ?.member_overrides?.[person.id] ?? null;
      if (
        saved === null
          ? permission === null
          : permission?.level === saved.level &&
            permission?.scope === saved.scope
      )
        delete drafts[config.resource];
      else drafts[config.resource] = permission;
      return Object.keys(drafts).length ? { ...next, drafts } : null;
    });
  }
  async function save() {
    if (
      !session ||
      !changes.length ||
      state.busy ||
      saving.current ||
      stale ||
      person.role === 'admin'
    )
      return;
    saving.current = true;
    try {
      const saved = await mutate(
        JSON.stringify([
          'member-permissions',
          person.id,
          session.person,
          changes,
        ]),
        (requestId) =>
          portalApi.updateMemberPermissions({
            requestId,
            person: session.person,
            changes,
          }),
        (result) =>
          update((s) => {
            s.permissions = {
              ...s.permissions,
              rules: s.permissions.rules.map(
                (rule) =>
                  result.rules.find(
                    (saved) => saved.resource === rule.resource,
                  ) ?? rule,
              ),
            };
          }),
      );
      if (saved) {
        setSession(null);
        viewState.delete(draftKey);
      }
    } finally {
      saving.current = false;
    }
  }
  const shown = rules.filter(
    (rule) =>
      (search.trim()
        ? permissionTitle(rule)
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        : changedOnly || permissionCategory(rule) === selectedCategory) &&
      (!changedOnly || Object.hasOwn(drafts, rule.resource)),
  );
  return (
    <section
      className="employee-permission-editor"
      aria-labelledby="employee-permission-title"
    >
      <header className="employee-permission-heading">
        <div>
          <h2 id="employee-permission-title">{person.name}</h2>
          <div className="employee-permission-meta">
            <span>{memberRoleLabels[person.role] ?? person.role}</span>
            <span>{person.active ? '활성' : '비활성 · 접근 불가'}</span>
          </div>
          <a
            href={`/portal/?view=members&user=${encodeURIComponent(person.id)}`}
          >
            역할·담당 범위 설정
          </a>
        </div>
        <div className="employee-permission-save">
          <span role="status">
            {changes.length
              ? `${changes.length}개 업무 변경 · 저장 전`
              : '저장된 권한'}
          </span>
          <div className="employee-permission-save-actions">
            {changes.length > 0 && (
              <button
                type="button"
                disabled={state.busy}
                onClick={() => setSession(null)}
              >
                변경 취소
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={
                state.busy ||
                !changes.length ||
                stale ||
                person.role === 'admin'
              }
              onClick={() => void save()}
            >
              {state.busy ? '처리 중…' : '변경사항 저장'}
            </button>
          </div>
        </div>
      </header>
      {person.role === 'admin' && (
        <p className="employee-permission-notice">
          관리자 기본 권한 · 지정 사용자 전용 기능은 별도 제한
        </p>
      )}
      {!person.active && (
        <p className="employee-permission-notice">
          비활성 계정은 저장한 권한과 관계없이 접근할 수 없습니다.
        </p>
      )}
      {stale && (
        <p role="alert" className="employee-permission-notice">
          직원 정보 또는 저장된 권한이 변경됐습니다. 입력은 보존했습니다. 변경
          취소 후 최신 권한을 확인하고 다시 설정하세요.
        </p>
      )}
      <div className="employee-permission-toolbar">
        <label>
          <span className="sr-only">업무 검색</span>
          <input
            type="search"
            name="permission-work-search"
            placeholder="업무 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(event) => setChangedOnly(event.target.checked)}
          />
          변경한 업무만
        </label>
        <button
          type="button"
          disabled={state.busy}
          onClick={() => void refresh()}
        >
          최신 권한 확인
        </button>
      </div>
      <Tabs.Root
        value={selectedCategory}
        onValueChange={(value) => {
          setCategory(value);
          setSearch('');
          viewState.set('permissionCategory', value);
        }}
      >
        <Tabs.List
          aria-label="업무 분류"
          className="employee-permission-categories"
        >
          {categories.map(([key, title]) => (
            <Tabs.Trigger
              key={key}
              value={key}
              className="employee-permission-category"
            >
              {title}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value={selectedCategory}>
          <div
            className="employee-permission-table"
            role="region"
            aria-label="직원 업무 권한"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">업무</th>
                  <th scope="col">허용 동작</th>
                  <th scope="col">자료 범위</th>
                  <th scope="col">
                    {changes.length ? '저장 후 적용' : '실제 적용'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((config) => {
                  const permission = permissionFor(config);
                  const summary = preview(config);
                  const original = employeePermissionSummary(
                    config,
                    person,
                    state.context?.centers ?? [],
                    centerName,
                  );
                  const changed = Object.hasOwn(drafts, config.resource);
                  const editAllowed =
                    person.role === 'editor' ||
                    ['incidents', 'notifications'].includes(config.resource);
                  return (
                    <tr
                      key={config.resource}
                      data-resource={config.resource}
                      data-changed={changed}
                    >
                      <th scope="row">
                        <strong>{permissionTitle(config)}</strong>
                        <small>
                          {changed
                            ? '변경됨'
                            : permission
                              ? '직원별 지정'
                              : '기본 권한'}
                        </small>
                      </th>
                      <td data-label="허용 동작">
                        {summary.fixed ? (
                          <span>{summary.label}</span>
                        ) : (
                          <label>
                            <span className="sr-only">
                              {permissionTitle(config)} 허용 동작
                            </span>
                            <select
                              data-permission-level={config.resource}
                              value={permission?.level ?? 'inherit'}
                              disabled={state.busy || stale}
                              onChange={(event) =>
                                change(
                                  config,
                                  event.target.value === 'inherit'
                                    ? null
                                    : {
                                        level: event.target
                                          .value as MemberPermission['level'],
                                        scope:
                                          permission?.scope ??
                                          (config.read_rule.scope === 'all' &&
                                          config.write_rule.scope === 'all'
                                            ? 'all'
                                            : 'own'),
                                      },
                                )
                              }
                            >
                              <option value="inherit">기본 권한 사용</option>
                              <option value="none">접근 불가</option>
                              <option value="read">
                                {summary.actions.read}
                              </option>
                              <option value="edit" disabled={!editAllowed}>
                                {summary.actions.edit}
                              </option>
                            </select>
                          </label>
                        )}
                        {summary.reason && (
                          <small>
                            {summary.reason === '본인 전용'
                              ? '지정 사용자 전용'
                              : summary.reason}
                          </small>
                        )}
                        {!editAllowed && !summary.fixed && (
                          <small>조회 전용 역할</small>
                        )}
                      </td>
                      <td data-label="자료 범위">
                        {!summary.fixed &&
                        permission &&
                        permission.level !== 'none' ? (
                          <label>
                            <span className="sr-only">
                              {permissionTitle(config)} 자료 범위
                            </span>
                            <select
                              data-permission-scope={config.resource}
                              value={permission.scope}
                              disabled={state.busy || stale}
                              onChange={(event) =>
                                change(config, {
                                  ...permission,
                                  scope: event.target
                                    .value as MemberPermission['scope'],
                                })
                              }
                            >
                              <option value="all">
                                {summary.shared
                                  ? '센터 배정 무관'
                                  : '전체 자료'}
                              </option>
                              <option value="own">
                                {summary.shared
                                  ? '센터 배정된 직원'
                                  : '담당 센터 자료'}
                              </option>
                            </select>
                          </label>
                        ) : (
                          <span>{summary.read ? summary.readScope : '—'}</span>
                        )}
                        {summary.edit &&
                          summary.editScope !== summary.readScope && (
                            <small>수정: {summary.editScope}</small>
                          )}
                      </td>
                      <td data-label="실제 적용">
                        <span
                          className="employee-permission-effective"
                          data-level={
                            summary.edit
                              ? 'edit'
                              : summary.read
                                ? 'read'
                                : 'none'
                          }
                        >
                          {summary.label}
                        </span>
                        {summary.read && <small>{summary.readScope}</small>}
                        {changed && (
                          <small>
                            현재: {original.label} · {original.readScope}
                            {original.edit &&
                            original.editScope !== original.readScope
                              ? ` / 수정 ${original.editScope}`
                              : ''}
                          </small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!shown.length && (
              <p className="employee-permission-notice">
                {changedOnly
                  ? '선택한 분류에 변경한 업무가 없습니다.'
                  : '일치하는 업무가 없습니다.'}
              </p>
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </section>
  );
}

export function PortalPermissions() {
  const { state, centerName, viewState } = usePortal();
  const [selected, setSelected] = useState(
    () =>
      new URLSearchParams(location.search).get('user') ??
      String(viewState.get('permissionMemberId') ?? ''),
  );
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const { confirm, feedback } = useFeedback();
  useEffect(
    () =>
      registerWorkspaceNavigationGuard((recheck) => {
        if (state.busy) return false;
        if (recheck || !dirty) return true;
        return confirm(
          '저장하지 않은 업무 권한이 있습니다. 저장하지 않고 이동할까요?',
          { okText: '이동', cancelText: '계속 편집' },
        );
      }),
    [state.busy, dirty, confirm],
  );
  const members = state.members.filter((person) =>
    [person.name, person.email, ...person.centers.map(centerName)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const person =
    state.members.find((person) => person.id === selected) ??
    state.members.find((person) => person.active && person.role !== 'admin') ??
    state.members[0];
  async function select(userId: string) {
    if (userId === person?.id || state.busy) return;
    if (
      dirty &&
      !(await confirm(
        '변경사항은 저장하지 않고 보관합니다. 다른 직원을 선택할까요?',
        { okText: '직원 변경', cancelText: '계속 편집' },
      ))
    )
      return;
    setDirty(false);
    setSelected(userId);
    viewState.set('permissionMemberId', userId);
    const url = new URL(location.href);
    url.searchParams.set('user', userId);
    history.replaceState(history.state, '', url);
  }
  return (
    <>
      <div className="employee-permission-workspace">
        <section
          className="employee-permission-directory"
          aria-label="직원 목록"
        >
          <div className="employee-permission-list-heading">
            <h2>직원</h2>
            <span>{members.length}명</span>
          </div>
          <label className="employee-permission-search">
            <span className="sr-only">직원 검색</span>
            <input
              type="search"
              name="permission_member_search"
              placeholder="직원 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="employee-permission-people">
            {members.map((member) => (
              <button
                type="button"
                key={member.id}
                data-permission-member={member.id}
                aria-pressed={person?.id === member.id}
                disabled={state.busy}
                onClick={() => void select(member.id)}
              >
                <strong>{member.name}</strong>
                <span>
                  {member.active
                    ? (memberRoleLabels[member.role] ?? member.role)
                    : '비활성'}
                </span>
              </button>
            ))}
          </div>
          {!members.length && (
            <p className="employee-permission-notice">검색 결과 없음</p>
          )}
        </section>
        {person ? (
          <EmployeePermissions
            key={person.id}
            person={person}
            onDirty={setDirty}
          />
        ) : (
          <section className="employee-permission-editor">
            <h2>등록된 직원 없음</h2>
          </section>
        )}
      </div>
      {feedback}
    </>
  );
}
